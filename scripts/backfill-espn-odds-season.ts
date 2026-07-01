// Season-wide ESPN ML odds backfill — independent of daily_predictions.
//
// The original scripts/backfill-espn-odds.ts joins ESPN games to
// daily_predictions to discover game_pk. That only works for dates
// where production has snapshotted predictions (June 2026 onward).
//
// This script joins ESPN games to the schedule embedded in daily_raw
// payloads — which exists for the whole season — so we can backfill
// odds for March, April, May too. After this runs, the full-season
// backtest in scripts/backtest-season.ts has odds for every dated
// game it grades.
//
// Run:
//   npx tsx --env-file=.env.local scripts/backfill-espn-odds-season.ts
//   npx tsx --env-file=.env.local scripts/backfill-espn-odds-season.ts 2026-03-26 2026-05-31

import { supabaseAdmin } from "../lib/supabase";
import { fetchEspnOddsForDate } from "../lib/sports/mlb/odds-espn";
import { findTeamByMlbApiId } from "../lib/teams";

type ScheduleGame = {
  gamePk?: number;
  teams?: {
    away?: { team?: { id?: number } };
    home?: { team?: { id?: number } };
  };
};
type Schedule = { dates?: Array<{ games?: ScheduleGame[] }> };
type Payload = { schedule?: Schedule };

function isoNext(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) throw new Error(`bad iso ${iso}`);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}
function todayInEt(): string {
  const now = new Date();
  const et = new Date(now.getTime() - 4 * 60 * 60 * 1000);
  return et.toISOString().slice(0, 10);
}

/** Reads the schedule from a date's daily_raw payload and builds a
 *  map of (away_abbr, home_abbr) → gamePk. ESPN's abbr → MLB-team-id
 *  conversion happens in odds-espn.ts via ESPN_TO_CANONICAL_ABBR. */
function scheduleByMatchup(payload: Payload): Map<string, { gamePk: number; awayAbbr: string; homeAbbr: string }> {
  const out = new Map<string, { gamePk: number; awayAbbr: string; homeAbbr: string }>();
  for (const d of payload.schedule?.dates ?? []) {
    for (const g of d.games ?? []) {
      const awayId = g.teams?.away?.team?.id;
      const homeId = g.teams?.home?.team?.id;
      if (typeof awayId !== "number" || typeof homeId !== "number" || typeof g.gamePk !== "number") continue;
      const a = findTeamByMlbApiId(awayId);
      const h = findTeamByMlbApiId(homeId);
      if (!a || !h) continue;
      out.set(`${a.abbreviation}|${h.abbreviation}`, {
        gamePk: g.gamePk,
        awayAbbr: a.abbreviation,
        homeAbbr: h.abbreviation,
      });
    }
  }
  return out;
}

async function backfillDate(date: string): Promise<{ matched: number; upserted: number; espn: number; scheduled: number; unmatched: string[] }> {
  const sb = supabaseAdmin();

  // Pull this date's schedule. We use daily_raw because it's the
  // canonical "what was on the slate" source even when no predictions
  // were generated yet.
  const { data: rawRow, error: rawErr } = await sb
    .from("daily_raw")
    .select("payload")
    .eq("sport", "mlb")
    .eq("date", date)
    .maybeSingle();
  if (rawErr) throw new Error(`daily_raw(${date}): ${rawErr.message}`);
  if (!rawRow) return { matched: 0, upserted: 0, espn: 0, scheduled: 0, unmatched: [] };

  const matchups = scheduleByMatchup(rawRow.payload as Payload);
  if (matchups.size === 0) return { matched: 0, upserted: 0, espn: 0, scheduled: 0, unmatched: [] };

  const espn = await fetchEspnOddsForDate(date);
  const rows: Array<{
    sport: string; date: string; game_pk: number;
    book: string; source: string;
    away_ml_odds: number | null; home_ml_odds: number | null;
    nrfi_odds: number | null; yrfi_odds: number | null;
    raw: Record<string, unknown>;
  }> = [];
  const unmatched: string[] = [];
  for (const e of espn) {
    const sched = matchups.get(`${e.awayAbbr}|${e.homeAbbr}`);
    if (!sched) { unmatched.push(`${e.awayAbbr}@${e.homeAbbr}`); continue; }
    rows.push({
      sport: "mlb",
      date,
      game_pk: sched.gamePk,
      book: e.book,
      source: "espn-core",
      away_ml_odds: e.awayMl,
      home_ml_odds: e.homeMl,
      nrfi_odds: null,
      yrfi_odds: null,
      raw: e.raw,
    });
  }
  if (rows.length > 0) {
    const { error } = await sb
      .from("daily_odds")
      .upsert(rows, { onConflict: "sport,date,game_pk,book" });
    if (error) throw new Error(`upsert(${date}): ${error.message}`);
  }
  return {
    matched: rows.length,
    upserted: rows.length,
    espn: espn.length,
    scheduled: matchups.size,
    unmatched,
  };
}

async function main() {
  const start = process.argv[2] ?? "2026-03-26";
  const end   = process.argv[3] ?? todayInEt();
  console.log(`season ESPN ML odds backfill: ${start} → ${end}`);

  let totUpserted = 0, totMatched = 0, totUnmatched = 0;
  for (let d = start; d <= end; d = isoNext(d)) {
    try {
      const r = await backfillDate(d);
      totUpserted += r.upserted;
      totMatched += r.matched;
      totUnmatched += r.unmatched.length;
      const flag = r.unmatched.length ? ` UNMATCHED: ${r.unmatched.join(",")}` : "";
      console.log(`  ${d}: sched=${r.scheduled} espn=${r.espn} matched=${r.matched}${flag}`);
    } catch (e) {
      console.error(`  ${d}: ERROR ${(e as Error).message}`);
    }
  }
  console.log(`done. matched=${totMatched} upserted=${totUpserted} unmatched=${totUnmatched}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
