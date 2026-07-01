// Populate prediction_results.linescore from daily_raw for every graded
// game in the given date range. Idempotent — safe to re-run.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/backfill-prediction-linescore.ts
//   npx tsx --env-file=.env.local scripts/backfill-prediction-linescore.ts 2026-06-01 2026-06-30

import { supabaseAdmin } from "../lib/supabase";

const START_DEFAULT = "2026-03-01";
const END_DEFAULT   = "2026-06-30";

type RawInning = { num?: number; away?: { runs?: number }; home?: { runs?: number } };
type RawLineTeam = { runs?: number; hits?: number; errors?: number };
type RawLinescore = { innings?: RawInning[]; teams?: { away?: RawLineTeam; home?: RawLineTeam } };
type RawGame = { gamePk?: number; linescore?: RawLinescore };
type RawPayload = { schedule?: { dates?: Array<{ games?: RawGame[] }> } };

type LineInning = { a: number | null; h: number | null };
type LineTotals = { r: number | null; h: number | null; e: number | null };
type Linescore  = { innings: LineInning[]; away: LineTotals; home: LineTotals };

function extractLinescore(g: RawGame): Linescore | null {
  const ls = g.linescore;
  if (!ls) return null;
  const innings: LineInning[] = (ls.innings ?? []).map((i) => ({
    a: typeof i.away?.runs === "number" ? i.away.runs : null,
    h: typeof i.home?.runs === "number" ? i.home.runs : null,
  }));
  const away: LineTotals = {
    r: ls.teams?.away?.runs   ?? null,
    h: ls.teams?.away?.hits   ?? null,
    e: ls.teams?.away?.errors ?? null,
  };
  const home: LineTotals = {
    r: ls.teams?.home?.runs   ?? null,
    h: ls.teams?.home?.hits   ?? null,
    e: ls.teams?.home?.errors ?? null,
  };
  if (innings.length === 0 && away.r === null && home.r === null) return null;
  return { innings, away, home };
}

function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  const d = new Date(start + "T00:00:00Z");
  const stop = new Date(end + "T00:00:00Z").getTime();
  while (d.getTime() <= stop) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

async function main() {
  const [, , startArg, endArg] = process.argv;
  const start = startArg ?? START_DEFAULT;
  const end   = endArg   ?? END_DEFAULT;
  const sb = supabaseAdmin();

  // Fetch daily_raw one date at a time — payloads are ~1MB each, so a
  // full-range fetch triggers Cloudflare 520s on the pooler.
  let totalGames = 0, totalUpdates = 0, totalMissing = 0;
  for (const date of dateRange(start, end)) {
    const { data: rawRow, error: rawErr } = await sb.from("daily_raw")
      .select("payload").eq("sport", "mlb").eq("date", date).maybeSingle();
    if (rawErr) { console.log(`${date}  fetch error: ${rawErr.message}`); continue; }
    if (!rawRow) { console.log(`${date}  no daily_raw row`); continue; }
    const payload = (rawRow.payload ?? {}) as RawPayload;
    const games = (payload.schedule?.dates ?? []).flatMap((d) => d.games ?? []);
    const rowsToUpdate: Array<{ sport: string; date: string; game_pk: number; linescore: Linescore }> = [];
    for (const g of games) {
      if (typeof g.gamePk !== "number") continue;
      totalGames++;
      const ls = extractLinescore(g);
      if (!ls) { totalMissing++; continue; }
      rowsToUpdate.push({ sport: "mlb", date, game_pk: g.gamePk, linescore: ls });
    }

    if (rowsToUpdate.length === 0) {
      console.log(`${date}  ${String(games.length).padStart(2)} games — no linescores`);
      continue;
    }

    // We can't upsert onto prediction_results because model_version is
    // part of its PK. Instead, update rows that already exist for the
    // current model. Do them individually so a missing row (unmapped
    // game_pk) doesn't fail the whole batch.
    let updated = 0;
    for (const r of rowsToUpdate) {
      const { error, count } = await sb.from("prediction_results")
        .update({ linescore: r.linescore }, { count: "exact" })
        .eq("sport", r.sport)
        .eq("date", r.date)
        .eq("game_pk", r.game_pk);
      if (error) throw new Error(`update ${r.date} ${r.game_pk}: ${error.message}`);
      updated += count ?? 0;
    }
    totalUpdates += updated;
    console.log(`${date}  ${String(rowsToUpdate.length).padStart(2)} games w/ ls, updated ${updated} pred rows`);
  }

  console.log(`\nTotal daily_raw games seen: ${totalGames}`);
  console.log(`Games without linescore:    ${totalMissing}`);
  console.log(`prediction_results updated: ${totalUpdates}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
