// Backfill historical DraftKings moneyline OPEN + CLOSE into daily_odds
// from ESPN's core API.
//
// Why: the 30-min odds poller only captures odds from the day it runs,
// and it was dead in prod from ~2026-07-08 until migration 0074 restored
// the append-only PK. That left the season's ML ROI / CLV story full of
// holes. ESPN's core feed, however, carries the opening AND closing
// DraftKings moneyline on COMPLETED games — so we can reconstruct both
// prices for every past date, for free, after the fact. (NRFI is not in
// the ESPN feed and has no historical source; this script is ML-only.)
//
// How it maps into the append-only daily_odds table:
//   * open  → one row at ${date}T11:00:00Z (before any first pitch, so
//             the daily_odds_first view — "earliest capture" — surfaces
//             the authoritative ESPN opening line season-wide).
//   * close → one row at (first pitch − 60s), so the comparator's
//             "latest capture before first pitch" closing logic picks it
//             up for CLV.
// Idempotent: upsert on the full PK with ignoreDuplicates, so re-runs are
// no-ops (same synthetic captured_at each time).
//
// Run:
//   npx tsx --env-file=.env.local scripts/backfill-espn-ml-odds.ts
//   npx tsx --env-file=.env.local scripts/backfill-espn-ml-odds.ts 2026-06-01 2026-06-30

import { supabaseAdmin } from "../lib/supabase";
import { findTeamByMlbApiId } from "../lib/teams";
import { fetchEspnOddsForDate, indexOddsByMatchup } from "../lib/sports/mlb/odds-espn";

const BOOK = "DraftKings";
const SOURCE = "espn-core-backfill";

function isoNext(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) throw new Error(`bad iso ${iso}`);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

type DailyOddsRow = {
  sport: string; date: string; game_pk: number;
  book: string; source: string; captured_at: string;
  away_ml_odds: number | null; home_ml_odds: number | null;
  nrfi_odds: number | null; yrfi_odds: number | null;
  raw: Record<string, unknown>;
};

async function main() {
  const [, , startArg, endArg] = process.argv;
  const start = startArg ?? "2026-03-26";
  const end = endArg ?? "2026-07-22";
  const sb = supabaseAdmin();

  // Game map for the whole window: (date, awayAbbr|homeAbbr) → game_pk.
  // Team IDs are model-agnostic; v6 daily_predictions covers the season.
  const gameByMatchup = new Map<string, number>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("daily_predictions")
      .select("date, game_pk, away_team_id, home_team_id")
      .eq("sport", "mlb").eq("model_version", "v6-nrfi-rebased")
      .gte("date", start).lte("date", end)
      .range(from, from + 999);
    if (error) throw new Error(`daily_predictions read: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data as Array<{ date: string; game_pk: number; away_team_id: number; home_team_id: number }>) {
      const a = findTeamByMlbApiId(r.away_team_id)?.abbreviation;
      const h = findTeamByMlbApiId(r.home_team_id)?.abbreviation;
      if (a && h) gameByMatchup.set(`${r.date}|${a}|${h}`, r.game_pk);
    }
    if (data.length < 1000) break;
  }

  let dates = 0, openRows = 0, closeRows = 0, unmatched = 0, noOdds = 0;
  for (let d = start; d <= end; d = isoNext(d)) {
    let espn;
    try {
      espn = await fetchEspnOddsForDate(d);
    } catch (e) {
      console.warn(`  ${d}: ESPN fetch failed: ${(e as Error).message}`);
      continue;
    }
    if (espn.length === 0) continue; // off day (e.g. All-Star break)
    dates++;
    const byMatchup = indexOddsByMatchup(espn);
    const rows: DailyOddsRow[] = [];
    for (const [matchup, gamePk] of gameByMatchup) {
      const [rowDate, a, h] = matchup.split("|");
      if (rowDate !== d) continue;
      const o = byMatchup.get(`${a}|${h}`);
      if (!o) { unmatched++; continue; }
      const hasOpen = o.awayMlOpen != null && o.homeMlOpen != null;
      const hasClose = o.awayMlClose != null && o.homeMlClose != null;
      if (!hasOpen && !hasClose) { noOdds++; continue; }
      if (hasOpen) {
        rows.push({
          sport: "mlb", date: d, game_pk: gamePk, book: BOOK, source: SOURCE,
          captured_at: `${d}T11:00:00.000Z`,
          away_ml_odds: o.awayMlOpen, home_ml_odds: o.homeMlOpen,
          nrfi_odds: null, yrfi_odds: null,
          raw: { kind: "open", eventId: o.eventId },
        });
      }
      if (hasClose) {
        // Close row lands just before first pitch so the comparator's
        // "latest capture before first pitch" logic selects it. Fall back
        // to a fixed late-day stamp if ESPN's start time is unparseable.
        const pitchMs = Date.parse(o.startTimeUtc);
        const closeAt = Number.isFinite(pitchMs)
          ? new Date(pitchMs - 60_000).toISOString()
          : `${d}T23:59:00.000Z`;
        rows.push({
          sport: "mlb", date: d, game_pk: gamePk, book: BOOK, source: SOURCE,
          captured_at: closeAt,
          away_ml_odds: o.awayMlClose, home_ml_odds: o.homeMlClose,
          nrfi_odds: null, yrfi_odds: null,
          raw: { kind: "close", eventId: o.eventId },
        });
      }
    }
    if (rows.length > 0) {
      const { error } = await sb.from("daily_odds")
        .upsert(rows, { onConflict: "sport,date,game_pk,book,captured_at", ignoreDuplicates: true });
      if (error) throw new Error(`${d}: daily_odds upsert: ${error.message}`);
      openRows += rows.filter((r) => (r.raw as { kind?: string }).kind === "open").length;
      closeRows += rows.filter((r) => (r.raw as { kind?: string }).kind === "close").length;
    }
    process.stdout.write(`  ${d}: +${rows.length} rows\r`);
  }

  console.log(`\n\nBackfill complete.`);
  console.log(`  dates with games : ${dates}`);
  console.log(`  open rows written : ${openRows}`);
  console.log(`  close rows written: ${closeRows}`);
  console.log(`  unmatched games   : ${unmatched}`);
  console.log(`  games w/o odds    : ${noOdds}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
