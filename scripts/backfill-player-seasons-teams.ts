// Fill team_abbr on player_seasons by deriving the most-played team
// per (player_id, season) from historical_player_lines. The MLB
// yearByYear endpoint returned null for the season-total split for
// most rows, so we backfill from data we already have.
//
// Strategy: walk player_seasons in chunks where team_abbr is null,
// for each row pull all historical_player_lines for that
// (player_id, season), tally by team_abbr, write the modal team. Ties
// broken by earliest game_pk so the result is deterministic.
//
// Resumable via cursor on id. Re-running is a no-op for rows that
// already have team_abbr filled.

import { supabaseAdmin } from "../lib/supabase";

const PAGE = 200;

async function main() {
  const db = supabaseAdmin();
  let cursor = 0;
  let scanned = 0;
  let filled = 0;
  let skippedNoData = 0;
  const startedAt = Date.now();

  for (;;) {
    const { data: rows, error } = await db
      .from("player_seasons")
      .select("id, player_id, season")
      .is("team_abbr", null)
      .gt("id", cursor)
      .order("id", { ascending: true })
      .limit(PAGE);
    if (error) throw new Error(`page: ${error.message}`);
    if (!rows || rows.length === 0) break;

    for (const row of rows as Array<{ id: number; player_id: number; season: number }>) {
      scanned++;
      const { data: lines, error: lerr } = await db
        .from("historical_player_lines")
        .select("team_abbr, game_pk")
        .eq("player_id", row.player_id)
        .eq("season", row.season)
        .not("team_abbr", "is", null)
        .order("game_pk", { ascending: true });
      if (lerr) { console.error(`  lines (${row.player_id}, ${row.season}): ${lerr.message}`); continue; }
      if (!lines || lines.length === 0) { skippedNoData++; continue; }

      // Tally by team_abbr; tiebreak by earliest game_pk encountered.
      const counts = new Map<string, { count: number; firstPk: number }>();
      for (const l of lines as Array<{ team_abbr: string; game_pk: number }>) {
        const cur = counts.get(l.team_abbr);
        if (cur) { cur.count++; } else { counts.set(l.team_abbr, { count: 1, firstPk: l.game_pk }); }
      }
      let bestTeam: string | null = null;
      let bestCount = -1;
      let bestFirstPk = Number.MAX_SAFE_INTEGER;
      for (const [team, info] of counts) {
        if (info.count > bestCount || (info.count === bestCount && info.firstPk < bestFirstPk)) {
          bestTeam = team;
          bestCount = info.count;
          bestFirstPk = info.firstPk;
        }
      }
      if (!bestTeam) { skippedNoData++; continue; }

      const { error: uerr } = await db
        .from("player_seasons")
        .update({ team_abbr: bestTeam })
        .eq("id", row.id);
      if (uerr) { console.error(`  update id=${row.id}: ${uerr.message}`); continue; }
      filled++;
    }
    cursor = (rows[rows.length - 1] as { id: number }).id;
    const elapsedMin = (Date.now() - startedAt) / 60000;
    const rate = scanned / Math.max(0.0001, elapsedMin);
    console.log(`  scanned=${scanned.toLocaleString()} filled=${filled.toLocaleString()} no_lines=${skippedNoData.toLocaleString()} cursor=${cursor}  ~${rate.toFixed(0)} rows/min`);
    if (rows.length < PAGE) break;
  }

  console.log(`\nDone. scanned=${scanned.toLocaleString()} filled=${filled.toLocaleString()} no_lines=${skippedNoData.toLocaleString()}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
