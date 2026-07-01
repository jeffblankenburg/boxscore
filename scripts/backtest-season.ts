// Full-season backtest harness.
//
// Why this exists separate from backtest-model.ts:
//   - backtest-model.ts reads prediction_results (the comparator's
//     graded snapshots). That table only has rows from when the
//     production cron started writing (June 2026). It's a 29-day window.
//   - This script regenerates predictions for the WHOLE 2026 season by
//     calling the deterministic model against historical daily_raw
//     payloads, then derives actuals from the same payloads (no
//     dependence on prediction_results).
//
// Strategy: load all 2026 daily_raw rows ONCE upfront (paginated to
// avoid Cloudflare's response-size cap), then iterate dates in memory.
// Per date:
//   1. Inputs come from prevDay's payload (standings, SP stats, slate)
//   2. Aggregates computed in-memory by filtering loaded rows to
//      date < D (via computeSeasonAggregatesFromRows)
//   3. predictGames runs
//   4. Actuals derived from THIS date's daily_raw (final scores +
//      1st-inning runs from the schedule's linescore)
//   5. Odds joined from daily_odds (must be backfilled first for
//      pre-June dates — see scripts/backfill-espn-odds-season.ts)
//
// Run:
//   npx tsx --env-file=.env.local scripts/backtest-season.ts
//   npx tsx --env-file=.env.local scripts/backtest-season.ts --variant cap-160

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { supabaseAdmin } from "../lib/supabase";
import { parseSlate, type SlateGame } from "../lib/mlb";
import { prevDay } from "../lib/dates";
import { findTeamByMlbApiId } from "../lib/teams";
import {
  predictGames,
  type GamePrediction,
  type TeamSeasonRecord,
  type ProbableSpStats,
} from "../lib/sports/mlb/predictions";
import {
  computeSeasonAggregatesFromRows,
} from "../lib/sports/mlb/season-aggregates";

// Local cache — daily_raw payloads are ~1MB each and repeatedly pulling
// them for backtest iterations blew through our Supabase IO budget once.
// After the first fetch, subsequent backtest runs read from disk. Force
// re-fetch with --refresh-cache.
const CACHE_DIR = "/tmp/boxscore-daily-raw-cache";
const CACHE_MANIFEST = join(CACHE_DIR, "manifest.json");

// ─── Types ─────────────────────────────────────────────────────────────

type RawRow = { date: string; payload: Record<string, unknown> };

type Outcome = {
  awayScore: number | null;
  homeScore: number | null;
  awayFirstInning: number | null;
  homeFirstInning: number | null;
  status: string;
};

type GradedPick = {
  date: string;
  gamePk: number;
  awayWinPct: number;
  homeWinPct: number;
  nrfiPct: number;
  outcome: Outcome;
};

type GameOdds = {
  awayMl: number | null;
  homeMl: number | null;
  nrfi: number | null;
  yrfi: number | null;
};

// ─── Bulk daily_raw loader ─────────────────────────────────────────────

/** Loads all 2026 daily_raw rows. Cache-first: reads from local disk if
 *  present, otherwise pulls from Supabase and writes the cache. Force
 *  re-fetch by passing refresh=true.
 *
 *  Rows are pulled one date at a time — each payload is ~1MB and
 *  bulk-pulling 100+ blows past Supabase's response-size cap. */
async function loadAllPayloads(
  season: number,
  throughDate: string,
  refresh: boolean,
): Promise<RawRow[]> {
  if (!refresh && existsSync(CACHE_MANIFEST)) {
    const manifest = JSON.parse(await readFile(CACHE_MANIFEST, "utf8")) as {
      season: number; throughDate: string; dates: string[];
    };
    if (manifest.season === season && manifest.throughDate >= throughDate) {
      console.log(`  cache hit: ${manifest.dates.length} rows from ${CACHE_DIR}`);
      const rows: RawRow[] = [];
      for (const d of manifest.dates) {
        if (d > throughDate) continue;
        const payload = JSON.parse(await readFile(join(CACHE_DIR, `${d}.json`), "utf8"));
        rows.push({ date: d, payload });
      }
      return rows;
    }
  }

  console.log(`  cache miss — fetching from Supabase`);
  const sb = supabaseAdmin();
  const { data: dateRows, error: datesErr } = await sb
    .from("daily_raw")
    .select("date")
    .eq("sport", "mlb")
    .gte("date", `${season}-03-01`)
    .lte("date", throughDate)
    .order("date", { ascending: true });
  if (datesErr) throw new Error(`loadAllPayloads dates: ${datesErr.message}`);

  await mkdir(CACHE_DIR, { recursive: true });
  console.log(`  fetching ${(dateRows ?? []).length} daily_raw rows...`);
  const rows: RawRow[] = [];
  const dates: string[] = [];
  let i = 0;
  for (const d of (dateRows ?? []) as Array<{ date: string }>) {
    const { data, error } = await sb
      .from("daily_raw")
      .select("date, payload")
      .eq("sport", "mlb")
      .eq("date", d.date)
      .maybeSingle();
    if (error) throw new Error(`loadAllPayloads row(${d.date}): ${error.message}`);
    if (data) {
      const row = data as RawRow;
      rows.push(row);
      dates.push(row.date);
      await writeFile(join(CACHE_DIR, `${row.date}.json`), JSON.stringify(row.payload));
    }
    if (++i % 20 === 0) console.log(`    ... ${i}/${dateRows?.length}`);
  }
  await writeFile(CACHE_MANIFEST, JSON.stringify({ season, throughDate, dates }, null, 2));
  console.log(`  wrote cache: ${dates.length} files in ${CACHE_DIR}`);
  return rows;
}

// ─── Outcome extraction from a date's payload ──────────────────────────

type ScheduleEnvelope = {
  dates?: Array<{
    games?: Array<{
      gamePk?: number;
      status?: { detailedState?: string; abstractGameState?: string };
      teams?: {
        away?: { score?: number; team?: { id?: number } };
        home?: { score?: number; team?: { id?: number } };
      };
      linescore?: {
        innings?: Array<{ num?: number; away?: { runs?: number }; home?: { runs?: number } }>;
      };
    }>;
  }>;
};

/** Walks a daily_raw payload's schedule.dates.games array, extracting
 *  final score + first-inning runs per gamePk. Same shape the
 *  predictions-comparator cron uses to grade. */
function outcomesFromPayload(payload: Record<string, unknown>): Map<number, Outcome> {
  const sched = (payload.schedule as ScheduleEnvelope | undefined) ?? {};
  const out = new Map<number, Outcome>();
  for (const day of sched.dates ?? []) {
    for (const g of day.games ?? []) {
      if (typeof g.gamePk !== "number") continue;
      const status = g.status?.detailedState ?? g.status?.abstractGameState ?? "unknown";
      const awayScore = g.teams?.away?.score ?? null;
      const homeScore = g.teams?.home?.score ?? null;
      let inning1Away: number | null = null;
      let inning1Home: number | null = null;
      const innings = g.linescore?.innings;
      if (Array.isArray(innings)) {
        const first = innings.find((i) => i.num === 1);
        if (first) {
          inning1Away = typeof first.away?.runs === "number" ? first.away.runs : null;
          inning1Home = typeof first.home?.runs === "number" ? first.home.runs : null;
        }
      }
      out.set(g.gamePk, {
        awayScore, homeScore,
        awayFirstInning: inning1Away,
        homeFirstInning: inning1Home,
        status,
      });
    }
  }
  return out;
}

// ─── Per-date input assembly (mirrors production's loadPredictionInputsForDate) ──

function buildInputsFromPayload(date: string, payload: Record<string, unknown>) {
  let slate: SlateGame[] = [];
  try { slate = parseSlate(payload.nextDaySchedule); } catch { slate = []; }

  type StandingsEnv = {
    records?: Array<{ teamRecords?: Array<{
      team?: { id?: number };
      wins?: number; losses?: number;
      runsScored?: number; runsAllowed?: number; gamesPlayed?: number;
    }> }>;
  };
  const recordsByTeamId = new Map<number, TeamSeasonRecord>();
  const standings = (payload.standings as StandingsEnv | undefined) ?? {};
  for (const rec of standings.records ?? []) {
    for (const tr of rec.teamRecords ?? []) {
      if (typeof tr.team?.id !== "number") continue;
      recordsByTeamId.set(tr.team.id, {
        teamId: tr.team.id,
        wins: tr.wins ?? 0,
        losses: tr.losses ?? 0,
        runsScored: tr.runsScored ?? 0,
        runsAllowed: tr.runsAllowed ?? 0,
        gamesPlayed: tr.gamesPlayed ?? 0,
      });
    }
  }

  const spStatsById = new Map<number, ProbableSpStats>();
  const pps = (payload.probablePitcherStats as Record<string, {
    era?: string | number; wins?: number; losses?: number;
  }>) ?? {};
  for (const [pidStr, st] of Object.entries(pps)) {
    const pid = Number(pidStr);
    if (!Number.isFinite(pid)) continue;
    const eraNum = typeof st.era === "number" ? st.era
                 : typeof st.era === "string" && Number.isFinite(Number(st.era)) ? Number(st.era)
                 : null;
    spStatsById.set(pid, {
      era: eraNum,
      wins: st.wins ?? null,
      losses: st.losses ?? null,
    });
  }
  for (const g of slate) {
    for (const pp of [g.away.probablePitcher, g.home.probablePitcher]) {
      if (pp && !spStatsById.has(pp.id)) {
        spStatsById.set(pp.id, { era: 4.20, wins: null, losses: null });
      }
    }
  }

  return { date, slate, recordsByTeamId, spStatsById };
}

// ─── Grader + pick rules (subset from backtest-model.ts) ──────────────

function americanToProfitMultiplier(odds: number): number {
  if (odds >= 0) return odds / 100;
  return 100 / Math.abs(odds);
}

const ML_PLAY_THRESHOLD = 0.545;
const STAKE = 10;

type MlPick = { gamePk: number; side: "away" | "home"; ourProb: number };

function bestFavoriteCapped(picks: GamePrediction[], oddsByPk: Map<number, GameOdds>, maxJuiceNeg: number): MlPick[] {
  let best: { gamePk: number; favPct: number; side: "away" | "home" } | null = null;
  for (const g of picks) {
    const fav = Math.max(g.away.winProbability, g.home.winProbability);
    const side: "away" | "home" = g.away.winProbability >= g.home.winProbability ? "away" : "home";
    if (!best || fav > best.favPct) best = { gamePk: g.gamePk, favPct: fav, side };
  }
  if (!best) return [];
  const o = oddsByPk.get(best.gamePk);
  if (!o) return [];
  const odds = best.side === "away" ? o.awayMl : o.homeMl;
  if (odds == null || odds < maxJuiceNeg) return [];
  return [{ gamePk: best.gamePk, side: best.side, ourProb: best.favPct }];
}
function oneBestFavorite(picks: GamePrediction[]): MlPick[] {
  let best: { gamePk: number; favPct: number; side: "away" | "home" } | null = null;
  for (const g of picks) {
    const fav = Math.max(g.away.winProbability, g.home.winProbability);
    const side: "away" | "home" = g.away.winProbability >= g.home.winProbability ? "away" : "home";
    if (!best || fav > best.favPct) best = { gamePk: g.gamePk, favPct: fav, side };
  }
  return best ? [{ gamePk: best.gamePk, side: best.side, ourProb: best.favPct }] : [];
}
function allThresholdFavorites(picks: GamePrediction[]): MlPick[] {
  const out: MlPick[] = [];
  for (const g of picks) {
    if (g.away.winProbability >= ML_PLAY_THRESHOLD) {
      out.push({ gamePk: g.gamePk, side: "away", ourProb: g.away.winProbability });
    } else if (g.home.winProbability >= ML_PLAY_THRESHOLD) {
      out.push({ gamePk: g.gamePk, side: "home", ourProb: g.home.winProbability });
    }
  }
  return out;
}

// ─── Main backtest loop ───────────────────────────────────────────────

type Metrics = {
  plays: number; hits: number; hitRate: number | null;
  brier: number | null; withOdds: number;
  staked: number; profit: number; roi: number | null;
};

function gradeMl(allPicks: Array<{ pick: MlPick; outcome: Outcome; odds: GameOdds | undefined }>): Metrics {
  let plays = 0, hits = 0, withOdds = 0, staked = 0, profit = 0, brierSum = 0;
  for (const { pick, outcome, odds } of allPicks) {
    if (outcome.awayScore == null || outcome.homeScore == null
        || outcome.awayScore === outcome.homeScore) continue; // no decision
    const actualWinner: "away" | "home" = outcome.homeScore > outcome.awayScore ? "home" : "away";
    plays++;
    const hit = pick.side === actualWinner;
    if (hit) hits++;
    brierSum += Math.pow(pick.ourProb - (hit ? 1 : 0), 2);
    if (odds) {
      const sideOdds = pick.side === "away" ? odds.awayMl : odds.homeMl;
      if (sideOdds != null) {
        withOdds++;
        staked += STAKE;
        profit += hit ? STAKE * americanToProfitMultiplier(sideOdds) : -STAKE;
      }
    }
  }
  return {
    plays, hits,
    hitRate: plays > 0 ? hits / plays : null,
    brier:   plays > 0 ? brierSum / plays : null,
    withOdds, staked, profit,
    roi: staked > 0 ? profit / staked : null,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const start = args.includes("--start") ? args[args.indexOf("--start") + 1]! : "2026-03-26";
  const end   = args.includes("--end")   ? args[args.indexOf("--end")   + 1]! : new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const refresh = args.includes("--refresh-cache");

  console.log(`backtest-season: window ${start} → ${end}`);
  console.log(`cache: ${CACHE_DIR}${refresh ? " (refresh)" : ""}`);
  console.log();

  console.log("phase 1: load all daily_raw...");
  const t0 = Date.now();
  const rows = await loadAllPayloads(2026, end, refresh);
  console.log(`  loaded ${rows.length} rows in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log();

  // Index by date.
  const rowByDate = new Map<string, RawRow>();
  for (const r of rows) rowByDate.set(r.date, r);

  // Load odds (full season). Falls back gracefully on missing dates.
  console.log("phase 2: load odds...");
  const sb = supabaseAdmin();
  const { data: oddsRows, error: oddsErr } = await sb
    .from("daily_odds")
    .select("date, game_pk, book, away_ml_odds, home_ml_odds, nrfi_odds, yrfi_odds")
    .eq("sport", "mlb")
    .in("book", ["DraftKings", "FanDuel"])
    .gte("date", start)
    .lte("date", end);
  if (oddsErr) throw new Error(`load odds: ${oddsErr.message}`);
  const oddsByKey = new Map<string, GameOdds>();
  for (const o of oddsRows ?? []) {
    const k = `${o.date}|${o.game_pk}`;
    const prev = oddsByKey.get(k) ?? { awayMl: null, homeMl: null, nrfi: null, yrfi: null };
    if (o.book === "DraftKings") {
      prev.awayMl = o.away_ml_odds;
      prev.homeMl = o.home_ml_odds;
    }
    if (o.book === "FanDuel") {
      prev.nrfi = o.nrfi_odds;
      prev.yrfi = o.yrfi_odds;
    }
    oddsByKey.set(k, prev);
  }
  console.log(`  ${oddsRows?.length ?? 0} odds rows`);
  console.log();

  // Iterate dates.
  console.log("phase 3: regenerate predictions per date...");
  type DayPicks = { date: string; picks: GamePrediction[]; outcomes: Map<number, Outcome> };
  const days: DayPicks[] = [];
  let cursor = start;
  while (cursor <= end) {
    const prev = prevDay(cursor);
    const prevPayload = rowByDate.get(prev)?.payload;
    const todayPayload = rowByDate.get(cursor)?.payload;
    if (!prevPayload || !todayPayload) {
      cursor = nextDay(cursor); continue;
    }

    // Inputs from prevDay (model knows nothing about today).
    const inputs = buildInputsFromPayload(cursor, prevPayload);
    if (inputs.slate.length === 0) {
      cursor = nextDay(cursor); continue;
    }

    // Aggregates: filter loaded rows to date < prevDay+1 (i.e. ≤ prev).
    const aggRows = rows.filter((r) => r.date <= prev);
    const aggregates = computeSeasonAggregatesFromRows(aggRows, prev);

    const result = predictGames({ ...inputs, aggregates });
    const outcomes = outcomesFromPayload(todayPayload);

    days.push({ date: cursor, picks: result.games, outcomes });
    cursor = nextDay(cursor);
  }
  console.log(`  ${days.length} graded days`);
  console.log();

  // Grade each variant.
  console.log("phase 4: grade variants...");
  const variants = [
    { key: "current",  label: "all threshold favorites",       rule: allThresholdFavorites },
    { key: "one-fav",  label: "1 best favorite/day",            rule: (g: GamePrediction[]) => oneBestFavorite(g) },
    { key: "cap-200",  label: "best fav/day, odds ≥ -200",      rule: (g: GamePrediction[], o: Map<number, GameOdds>) => bestFavoriteCapped(g, o, -200) },
    { key: "cap-180",  label: "best fav/day, odds ≥ -180",      rule: (g: GamePrediction[], o: Map<number, GameOdds>) => bestFavoriteCapped(g, o, -180) },
    { key: "cap-160",  label: "best fav/day, odds ≥ -160",      rule: (g: GamePrediction[], o: Map<number, GameOdds>) => bestFavoriteCapped(g, o, -160) },
    { key: "cap-150",  label: "best fav/day, odds ≥ -150",      rule: (g: GamePrediction[], o: Map<number, GameOdds>) => bestFavoriteCapped(g, o, -150) },
    { key: "cap-140",  label: "best fav/day, odds ≥ -140",      rule: (g: GamePrediction[], o: Map<number, GameOdds>) => bestFavoriteCapped(g, o, -140) },
  ];

  console.log();
  for (const v of variants) {
    const allPicks: Array<{ pick: MlPick; outcome: Outcome; odds: GameOdds | undefined }> = [];
    for (const d of days) {
      const dayOdds = new Map<number, GameOdds>();
      for (const g of d.picks) {
        const o = oddsByKey.get(`${d.date}|${g.gamePk}`);
        if (o) dayOdds.set(g.gamePk, o);
      }
      const picks = v.rule(d.picks, dayOdds);
      for (const p of picks) {
        const outcome = d.outcomes.get(p.gamePk);
        if (!outcome) continue;
        const odds = dayOdds.get(p.gamePk);
        allPicks.push({ pick: p, outcome, odds });
      }
    }
    const m = gradeMl(allPicks);
    printRow(v.key, v.label, m);
  }
}

function nextDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) throw new Error(`bad iso ${iso}`);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

function fmtPct(v: number | null, digits = 1): string {
  return v == null ? "  —  " : `${(v * 100).toFixed(digits)}%`;
}
function fmtDollar(v: number): string {
  const s = v >= 0 ? "+" : "−";
  return `${s}$${Math.abs(v).toFixed(2)}`;
}
function printRow(key: string, label: string, m: Metrics) {
  const fields = [
    `plays=${String(m.plays).padStart(4)}`,
    `hit%=${fmtPct(m.hitRate).padStart(6)}`,
    `brier=${m.brier == null ? "  —  " : m.brier.toFixed(4)}`,
    `wOdds=${String(m.withOdds).padStart(4)}`,
    `staked=$${String(m.staked).padStart(5)}`,
    `pl=${fmtDollar(m.profit).padStart(10)}`,
    `roi=${fmtPct(m.roi, 2).padStart(8)}`,
  ];
  console.log(`  ${key.padEnd(10)} ${label.padEnd(35)} ${fields.join("  ")}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
