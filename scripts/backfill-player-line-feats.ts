// Player-line feat backfill (#56). Walks historical_boxscores in
// cursor-paged chunks, extracts every batter and pitcher line, scores
// it via lib/historical/feat.ts, and writes a row into
// historical_player_lines.
//
// Pure transformation — no MLB API calls. Re-runs as data evolves:
// `--rescore` re-walks every existing row and recomputes the score
// without re-extracting (cheap, useful for tuning weight constants).
//
// Identity: player_id is the internal players.id, looked up by mlb_id
// from the box-score payload. We pre-load the full mlb_id → id
// mapping into a Map once at startup (~25k rows from players, cheap)
// and never round-trip the DB per line.

import { supabaseAdmin } from "../lib/supabase";
import { scoreFeat, type BattingInput, type PitchingInput } from "../lib/historical/feat";

const JOB = "player-line-feats";
const PROGRESS_SENTINEL_SEASON = 0;

// Per-game extraction batch size. boxscore_raw is ~50KB per row so
// 200 rows ≈ 10MB of jsonb shipped per page, which periodically times
// out under DB load. 100 stays reliable.
// Boxscores carry heavy jsonb. Larger pages tripped the 8s statement
// timeout:
//   100/page → failed at pk 237k (1985 era)
//    50/page → failed at pk 748k (2024 era — modern boxes are larger)
//    25/page → stable for the modern range
const GAME_PAGE = 25;

// ─── Args ─────────────────────────────────────────────────────────────

type Args = {
  rescore: boolean;
  limit: number | null;
};

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const get = (k: string) => {
    const a = args.find((x) => x.startsWith(`--${k}=`));
    return a?.split("=")[1];
  };
  const limit = get("limit");
  return {
    rescore: args.includes("--rescore"),
    limit: limit ? Number(limit) : null,
  };
}

// ─── Player-id mapping ────────────────────────────────────────────────

export async function loadPlayerIdMap(): Promise<Map<number, number>> {
  const db = supabaseAdmin();
  const map = new Map<number, number>();
  const PAGE = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await db
      .from("players")
      .select("id, mlb_id")
      .not("mlb_id", "is", null)
      .order("mlb_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`loadPlayerIdMap: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data) {
      const row = r as { id: number; mlb_id: number };
      map.set(row.mlb_id, row.id);
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return map;
}

// ─── Box-score traversal ──────────────────────────────────────────────
//
// boxscore_raw shape (from MLB Stats API):
//   teams: {
//     away: { team: {id, name, abbreviation}, players: {ID12345: {...}}, ... },
//     home: { team: {...}, players: {...}, ... }
//   }
// Each player has: stats: { batting: {...}, pitching: {...}, fielding: {...} }
// Empty stat blocks just have nulls — we filter via atBats>0 or outs>0.

type BoxPlayer = {
  person?: { id?: number; fullName?: string };
  stats?: {
    batting?: BattingInput & { atBats?: number };
    pitching?: PitchingInput & { outs?: number };
  };
};

type BoxTeam = {
  team?: { id?: number; abbreviation?: string };
  players?: Record<string, BoxPlayer>;
  // Team-level stats are referenced for game context (no-hitter etc).
  teamStats?: {
    batting?: { hits?: number };
    pitching?: { hits?: number };
    fielding?: { errors?: number };
  };
  pitchers?: number[];
};

type Boxscore = {
  teams?: { away?: BoxTeam; home?: BoxTeam };
};

type GameMeta = {
  game_pk: number;
  game_date: string;          // YYYY-MM-DD
  season: number;
  game_type: string | null;
};

type RowToInsert = {
  game_pk: number;
  game_date: string;
  season: number;
  game_type: string | null;
  player_id: number;
  mlb_id: number;
  player_name: string;
  team_id: number | null;
  team_abbr: string | null;
  opp_team_id: number | null;
  opp_team_abbr: string | null;
  line_type: "batting" | "pitching";
  batting_stats: BattingInput | null;
  pitching_stats: PitchingInput | null;
  feat_score: number;
  feat_notes: Record<string, number>;
  scored_at: string;
};

export function extractLines(
  meta: GameMeta,
  box: Boxscore,
  playerIdMap: Map<number, number>,
): RowToInsert[] {
  const rows: RowToInsert[] = [];
  if (!box.teams) return rows;
  const scoredAt = new Date().toISOString();

  // Game context for pitching feats — we need the opposing team's
  // hits, the pitching team's defensive errors, and the staff size of
  // the pitching team.
  const awayHits = box.teams.away?.teamStats?.batting?.hits;
  const homeHits = box.teams.home?.teamStats?.batting?.hits;
  const awayErrors = (box.teams.away?.teamStats?.fielding?.errors as number | undefined) ?? 0;
  const homeErrors = (box.teams.home?.teamStats?.fielding?.errors as number | undefined) ?? 0;
  const awayStaffSize = box.teams.away?.pitchers?.length ?? 0;
  const homeStaffSize = box.teams.home?.pitchers?.length ?? 0;

  for (const side of ["away", "home"] as const) {
    const team = box.teams[side];
    if (!team) continue;
    const oppSide = side === "away" ? "home" : "away";
    const opp = box.teams[oppSide];
    const teamId = team.team?.id ?? null;
    const teamAbbr = team.team?.abbreviation ?? null;
    const oppTeamId = opp?.team?.id ?? null;
    const oppTeamAbbr = opp?.team?.abbreviation ?? null;

    // For pitching feats: side="away" means this pitcher pitched
    // against the home team; opponentTotalHits is the home team's hits.
    const opponentTotalHits = side === "away" ? homeHits : awayHits;
    const pitchingTeamErrors = side === "away" ? awayErrors : homeErrors;
    const pitchingStaffSize = side === "away" ? awayStaffSize : homeStaffSize;

    const players = team.players ?? {};
    for (const key of Object.keys(players)) {
      const p = players[key];
      if (!p) continue;
      const mlbId = p.person?.id;
      const name = p.person?.fullName;
      if (typeof mlbId !== "number" || !name) continue;
      const playerId = playerIdMap.get(mlbId);
      if (playerId == null) continue;     // missing from players cache — skip

      // Batting line: only meaningful if the player actually batted.
      const b = p.stats?.batting;
      if (b && (b.atBats ?? 0) > 0) {
        const { atBats: _ab, ...batting } = b as BattingInput & { atBats?: number };
        const battingStats: BattingInput = { atBats: _ab, ...batting };
        const scored = scoreFeat({ lineType: "batting", batting: battingStats });
        rows.push({
          game_pk: meta.game_pk,
          game_date: meta.game_date,
          season: meta.season,
          game_type: meta.game_type,
          player_id: playerId,
          mlb_id: mlbId,
          player_name: name,
          team_id: teamId,
          team_abbr: teamAbbr,
          opp_team_id: oppTeamId,
          opp_team_abbr: oppTeamAbbr,
          line_type: "batting",
          batting_stats: battingStats,
          pitching_stats: null,
          feat_score: scored.total,
          feat_notes: scored.notes,
          scored_at: scoredAt,
        });
      }

      // Pitching line: only meaningful if they recorded outs. MLB
      // tracks outs (integer) and inningsPitched (string "8.2") side
      // by side; we use outs to gate.
      const pi = p.stats?.pitching;
      const outs = (pi as { outs?: number } | undefined)?.outs ?? 0;
      if (pi && outs > 0) {
        const { outs: _outs, ...pitching } = pi as PitchingInput & { outs?: number };
        const pitchingStats: PitchingInput = pitching;
        const scored = scoreFeat({
          lineType: "pitching",
          pitching: pitchingStats,
          gameContext: {
            opponentTotalHits,
            pitchingStaffSize,
            pitchingTeamErrors,
          },
        });
        rows.push({
          game_pk: meta.game_pk,
          game_date: meta.game_date,
          season: meta.season,
          game_type: meta.game_type,
          player_id: playerId,
          mlb_id: mlbId,
          player_name: name,
          team_id: teamId,
          team_abbr: teamAbbr,
          opp_team_id: oppTeamId,
          opp_team_abbr: oppTeamAbbr,
          line_type: "pitching",
          batting_stats: null,
          pitching_stats: pitchingStats,
          feat_score: scored.total,
          feat_notes: scored.notes,
          scored_at: scoredAt,
        });
      }
    }
  }

  return rows;
}

// ─── Resume + iteration ───────────────────────────────────────────────

async function getCursor(): Promise<number> {
  const db = supabaseAdmin();
  const { data } = await db
    .from("backfill_progress")
    .select("last_date_done, games_seen")
    .eq("job", JOB)
    .eq("season", PROGRESS_SENTINEL_SEASON)
    .maybeSingle<{ last_date_done: string | null; games_seen: number }>();
  // We stash the last processed game_pk in games_seen since
  // last_date_done is a date column. games_seen is an int so it works.
  return data?.games_seen ?? 0;
}

async function saveCursor(maxGamePk: number, inserted: number): Promise<void> {
  await supabaseAdmin().from("backfill_progress").upsert({
    job: JOB,
    season: PROGRESS_SENTINEL_SEASON,
    last_date_done: null,
    games_seen: maxGamePk,
    games_ingested: inserted,
    failed_game_pks: [],
    finished_at: new Date().toISOString(),
  }, { onConflict: "job,season" });
}

// ─── Rescore mode ─────────────────────────────────────────────────────
//
// Walks historical_player_lines in chunks, re-runs the scorer against
// the stored batting/pitching stats jsonb, updates feat_score +
// feat_notes. No box-score traversal needed.

async function rescore(): Promise<void> {
  const db = supabaseAdmin();
  const PAGE = 1000;
  let cursor = 0;
  let updated = 0;
  for (;;) {
    const { data, error } = await db
      .from("historical_player_lines")
      .select("id, line_type, batting_stats, pitching_stats")
      .gt("id", cursor)
      .order("id", { ascending: true })
      .limit(PAGE);
    if (error) throw new Error(`rescore page: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) {
      const r = row as { id: number; line_type: "batting" | "pitching"; batting_stats: BattingInput | null; pitching_stats: PitchingInput | null };
      const scored = scoreFeat({
        lineType: r.line_type,
        batting: r.batting_stats ?? undefined,
        pitching: r.pitching_stats ?? undefined,
        // Game context isn't replayed in rescore — pitcher feats that
        // depend on it (no-hitter, X-hitter) will be recomputed
        // without it. For weight tuning that's fine; for a full
        // re-extraction, run a fresh backfill without --rescore.
      });
      const { error: uerr } = await db
        .from("historical_player_lines")
        .update({
          feat_score: scored.total,
          feat_notes: scored.notes,
          scored_at: new Date().toISOString(),
        })
        .eq("id", r.id);
      if (uerr) { console.error(`rescore row ${r.id}: ${uerr.message}`); continue; }
      updated++;
    }
    cursor = (data[data.length - 1] as { id: number }).id;
    if (updated % 5000 < PAGE) console.log(`  rescored ${updated.toLocaleString()}`);
    if (data.length < PAGE) break;
  }
  console.log(`Rescored ${updated.toLocaleString()} lines.`);
}

// ─── Entry ────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();

  if (args.rescore) {
    console.log("--rescore: recomputing feat_score for every existing row...");
    await rescore();
    return;
  }

  console.log("Loading player-id mapping...");
  const playerIdMap = await loadPlayerIdMap();
  console.log(`  ${playerIdMap.size.toLocaleString()} players in cache.`);

  let cursor = await getCursor();
  if (cursor > 0) console.log(`Resuming after game_pk ${cursor}.`);

  const db = supabaseAdmin();
  let processed = 0;
  let inserted = 0;
  const startedAt = Date.now();

  for (;;) {
    // Two-step: fetch boxscores (heavy jsonb) and game metadata (light)
    // separately. Joining them inside Postgres was timing out on
    // medium-sized pages.
    const { data: boxes, error: berr } = await db
      .from("historical_boxscores")
      .select("game_pk, boxscore_raw")
      .gt("game_pk", cursor)
      .order("game_pk", { ascending: true })
      .limit(GAME_PAGE);
    if (berr) throw new Error(`page boxes: ${berr.message}`);
    if (!boxes || boxes.length === 0) break;
    const gamePks = (boxes as Array<{ game_pk: number; boxscore_raw: Boxscore }>).map((b) => b.game_pk);
    const { data: gamesData, error: gerr } = await db
      .from("historical_games")
      .select("game_pk, game_date, season, game_type")
      .in("game_pk", gamePks);
    if (gerr) throw new Error(`page games: ${gerr.message}`);
    const metaByPk = new Map<number, { game_date: string; season: number; game_type: string | null }>();
    for (const g of (gamesData ?? []) as Array<{ game_pk: number; game_date: string; season: number; game_type: string | null }>) {
      metaByPk.set(g.game_pk, { game_date: g.game_date, season: g.season, game_type: g.game_type });
    }

    const rowsToInsert: RowToInsert[] = [];
    let maxGamePk = cursor;
    for (const row of boxes as Array<{ game_pk: number; boxscore_raw: Boxscore }>) {
      const meta_ = metaByPk.get(row.game_pk);
      if (!meta_) continue;
      const meta: GameMeta = {
        game_pk: row.game_pk,
        game_date: meta_.game_date,
        season: meta_.season,
        game_type: meta_.game_type,
      };
      const lines = extractLines(meta, row.boxscore_raw, playerIdMap);
      rowsToInsert.push(...lines);
      if (row.game_pk > maxGamePk) maxGamePk = row.game_pk;
      processed++;
    }
    const data = boxes;

    if (rowsToInsert.length > 0) {
      // Upsert on (game_pk, player_id, line_type) — added in migration
      // 0044 to make resume idempotent. If the same game gets processed
      // twice (e.g. cursor resumed across a partial run), we overwrite
      // the existing row with the freshly-scored one instead of
      // duplicating.
      const CHUNK = 500;
      for (let i = 0; i < rowsToInsert.length; i += CHUNK) {
        const slice = rowsToInsert.slice(i, i + CHUNK);
        const { error: ierr } = await db
          .from("historical_player_lines")
          .upsert(slice, { onConflict: "game_pk,player_id,line_type" });
        if (ierr) {
          console.error(`upsert chunk @ ${i}: ${ierr.message}`);
          continue;
        }
        inserted += slice.length;
      }
    }

    cursor = maxGamePk;
    await saveCursor(cursor, inserted);

    const elapsedSec = (Date.now() - startedAt) / 1000;
    const rate = processed / elapsedSec;
    console.log(
      `  processed=${processed.toLocaleString()} games  ` +
      `inserted=${inserted.toLocaleString()} lines  ` +
      `cursor=${cursor}  ~${rate.toFixed(1)} games/s`,
    );

    if (data.length < GAME_PAGE) break;
    if (args.limit && processed >= args.limit) break;
  }

  console.log(`\nDone. processed=${processed.toLocaleString()} games  inserted=${inserted.toLocaleString()} lines`);
}

// Run only when invoked as the entry point so other scripts can
// `import { extractLines, ... }` without kicking off a full backfill.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
