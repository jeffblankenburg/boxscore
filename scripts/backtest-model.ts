// Backtest harness for the prediction system.
//
// Modes:
//   pick-rule  — Read prediction_results + daily_odds, swap the play
//                rule (which game is picked + which side), regrade.
//                Fast — no model regeneration. Use this for any
//                variant that only changes pick selection, not the
//                underlying probabilities.
//   model      — Regenerate predictions per-date via loadPredictionsForDate
//                with a substituted feature set, then apply pick rule.
//                Slow — ~10s per date. Use only when changing model
//                inputs (nrfi-central features, blend weights, etc.).
//
// All evaluation uses captured odds (DraftKings ML from ESPN backfill,
// FanDuel NRFI from the scraper). Pick rules and metrics are pure
// functions over the same input bundle so variants are 1:1 comparable.
//
// Run:
//   npx tsx --env-file=.env.local scripts/backtest-model.ts
//   npx tsx --env-file=.env.local scripts/backtest-model.ts --variant ev
//   npx tsx --env-file=.env.local scripts/backtest-model.ts --variant ev-pos --start 2026-06-01

import { supabaseAdmin } from "../lib/supabase";
import {
  PREDICTIONS_MODEL_VERSION,
  loadPredictionInputsForDate,
} from "../lib/sports/mlb/predictions-data";
import {
  predictGames,
  type PredictionInputs,
  type PredictionsResult,
  type PredictionConfig,
} from "../lib/sports/mlb/predictions";

function isoNext(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) throw new Error(`bad iso ${iso}`);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

// ─── Types ─────────────────────────────────────────────────────────────

type GradedPrediction = {
  date: string;
  gamePk: number;
  awayWinPct: number;     // model's prediction for away win
  homeWinPct: number;
  nrfiPct: number;        // model's prediction for NRFI
  actualWinner: "away" | "home" | null;
  actualNrfi: boolean | null;
  winCorrect: boolean | null;     // already-computed by comparator
  nrfiCorrect: boolean | null;
};

type GameOdds = {
  awayMl: number | null;
  homeMl: number | null;
  nrfi: number | null;     // Under 0.5 runs in 1st inning
  yrfi: number | null;     // Over 0.5 runs in 1st inning
};

type MlPick = {
  gamePk: number;
  side: "away" | "home";
  ourProb: number;
};
type NrfiPick = {
  gamePk: number;
  side: "NRFI" | "YRFI";
  ourProb: number;
};

/** A pick rule sees the whole day's slate + odds. Can pick 0, 1, or
 *  many games. */
type MlPickRule = (
  games: GradedPrediction[],
  oddsByPk: Map<number, GameOdds>,
) => MlPick[];

type NrfiPickRule = (
  games: GradedPrediction[],
  oddsByPk: Map<number, GameOdds>,
) => NrfiPick[];

type MarketMetrics = {
  plays: number;
  hits: number;
  hitRate: number | null;
  brier: number | null;       // mean squared error of probability vs actual
  withOdds: number;
  staked: number;
  profit: number;
  roi: number | null;          // profit / staked
};

export type BacktestResult = {
  startDate: string;
  endDate: string;
  days: number;
  variant: string;
  ml: MarketMetrics;
  nrfi: MarketMetrics;
};

// ─── Odds math ─────────────────────────────────────────────────────────

function americanToProfitMultiplier(odds: number): number {
  if (odds >= 0) return odds / 100;
  return 100 / Math.abs(odds);
}

/** Implied probability that an American moneyline assigns to a side.
 *  For +X: 100 / (X+100). For -X: |X| / (|X|+100). Used by EV-aware
 *  pick rules to compare our_prob vs book's prob. */
function americanToImpliedProb(odds: number): number {
  if (odds >= 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

// ─── Data loading ──────────────────────────────────────────────────────

async function loadGradedSeason(startIso: string, endIso: string): Promise<GradedPrediction[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("prediction_results")
    .select("date, game_pk, away_win_pct, home_win_pct, nrfi_pct, actual_winner, actual_nrfi, win_correct, nrfi_correct")
    .eq("sport", "mlb")
    .eq("model_version", PREDICTIONS_MODEL_VERSION)
    .gte("date", startIso)
    .lte("date", endIso);
  if (error) throw new Error(`loadGradedSeason: ${error.message}`);
  return (data ?? []).map((r) => ({
    date: r.date,
    gamePk: r.game_pk,
    awayWinPct: Number(r.away_win_pct),
    homeWinPct: Number(r.home_win_pct),
    nrfiPct: Number(r.nrfi_pct),
    actualWinner: r.actual_winner as "away" | "home" | null,
    actualNrfi: r.actual_nrfi,
    winCorrect: r.win_correct,
    nrfiCorrect: r.nrfi_correct,
  }));
}

async function loadOdds(startIso: string, endIso: string): Promise<Map<string, GameOdds>> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("daily_odds")
    .select("date, game_pk, book, away_ml_odds, home_ml_odds, nrfi_odds, yrfi_odds")
    .eq("sport", "mlb")
    .in("book", ["DraftKings", "FanDuel"])
    .gte("date", startIso)
    .lte("date", endIso);
  if (error) throw new Error(`loadOdds: ${error.message}`);
  // For each (date, game_pk) merge ML from DraftKings + NRFI from FanDuel
  // into one GameOdds. Either side may be null if that book's row is
  // missing.
  const out = new Map<string, GameOdds>();
  for (const o of data ?? []) {
    const k = `${o.date}|${o.game_pk}`;
    const prev = out.get(k) ?? { awayMl: null, homeMl: null, nrfi: null, yrfi: null };
    if (o.book === "DraftKings") {
      prev.awayMl = o.away_ml_odds;
      prev.homeMl = o.home_ml_odds;
    }
    if (o.book === "FanDuel") {
      prev.nrfi = o.nrfi_odds;
      prev.yrfi = o.yrfi_odds;
    }
    out.set(k, prev);
  }
  return out;
}

// ─── Pick rules ────────────────────────────────────────────────────────

const ML_PLAY_THRESHOLD = 0.545;
const NRFI_PLAY_THRESHOLD = 0.545;

/** v4-current: pick every game that clears 54.5% ML, plus a strongest-
 *  favorite fallback if none qualify. Picks home/away based on which
 *  side has higher predicted probability. */
function alwaysFavoriteMl(games: GradedPrediction[]): MlPick[] {
  const picks: MlPick[] = [];
  let best: { gamePk: number; favPct: number; side: "away" | "home" } | null = null;
  for (const g of games) {
    if (g.actualWinner === null) continue; // skip non-final
    let picked: "away" | "home" | null = null;
    if (g.awayWinPct >= ML_PLAY_THRESHOLD) picked = "away";
    else if (g.homeWinPct >= ML_PLAY_THRESHOLD) picked = "home";
    if (picked) {
      picks.push({ gamePk: g.gamePk, side: picked, ourProb: picked === "away" ? g.awayWinPct : g.homeWinPct });
    }
    const fav = g.awayWinPct >= g.homeWinPct ? g.awayWinPct : g.homeWinPct;
    const side: "away" | "home" = g.awayWinPct >= g.homeWinPct ? "away" : "home";
    if (!best || fav > best.favPct) best = { gamePk: g.gamePk, favPct: fav, side };
  }
  if (picks.length === 0 && best) {
    picks.push({ gamePk: best.gamePk, side: best.side, ourProb: best.favPct });
  }
  return picks;
}

function alwaysFavoriteNrfi(games: GradedPrediction[]): NrfiPick[] {
  const picks: NrfiPick[] = [];
  let best: { gamePk: number; dev: number; pickNrfi: boolean } | null = null;
  for (const g of games) {
    if (g.actualNrfi === null) continue;
    let pickNrfi: boolean | null = null;
    if (g.nrfiPct >= NRFI_PLAY_THRESHOLD) pickNrfi = true;
    else if (g.nrfiPct <= 1 - NRFI_PLAY_THRESHOLD) pickNrfi = false;
    if (pickNrfi !== null) {
      picks.push({ gamePk: g.gamePk, side: pickNrfi ? "NRFI" : "YRFI", ourProb: pickNrfi ? g.nrfiPct : 1 - g.nrfiPct });
    }
    const dev = Math.abs(g.nrfiPct - 0.5);
    if (!best || dev > best.dev) best = { gamePk: g.gamePk, dev, pickNrfi: g.nrfiPct >= 0.5 };
  }
  if (picks.length === 0 && best) {
    picks.push({ gamePk: best.gamePk, side: best.pickNrfi ? "NRFI" : "YRFI", ourProb: best.pickNrfi ? 0.5 + best.dev : 0.5 + best.dev });
  }
  return picks;
}

/** v-ev: pick the side per game whose ourProb - bookImpliedProb is
 *  largest (positive or negative), then take the day's single
 *  best-EV play. Mirrors "always-pick" cadence (1 play/day) but
 *  pick selection is edge-driven rather than favorite-driven. */
function evBestOfDayMl(games: GradedPrediction[], oddsByPk: Map<number, GameOdds>): MlPick[] {
  let best: { gamePk: number; side: "away" | "home"; ourProb: number; edge: number } | null = null;
  for (const g of games) {
    if (g.actualWinner === null) continue;
    const o = oddsByPk.get(g.gamePk);
    if (!o || o.awayMl == null || o.homeMl == null) continue;
    const awayImplied = americanToImpliedProb(o.awayMl);
    const homeImplied = americanToImpliedProb(o.homeMl);
    const awayEdge = g.awayWinPct - awayImplied;
    const homeEdge = g.homeWinPct - homeImplied;
    if (awayEdge >= homeEdge && (best == null || awayEdge > best.edge)) {
      best = { gamePk: g.gamePk, side: "away", ourProb: g.awayWinPct, edge: awayEdge };
    } else if (homeEdge > awayEdge && (best == null || homeEdge > best.edge)) {
      best = { gamePk: g.gamePk, side: "home", ourProb: g.homeWinPct, edge: homeEdge };
    }
  }
  return best ? [{ gamePk: best.gamePk, side: best.side, ourProb: best.ourProb }] : [];
}

function evBestOfDayNrfi(games: GradedPrediction[], oddsByPk: Map<number, GameOdds>): NrfiPick[] {
  let best: { gamePk: number; side: "NRFI" | "YRFI"; ourProb: number; edge: number } | null = null;
  for (const g of games) {
    if (g.actualNrfi === null) continue;
    const o = oddsByPk.get(g.gamePk);
    if (!o || o.nrfi == null || o.yrfi == null) continue;
    const nrfiImplied = americanToImpliedProb(o.nrfi);
    const yrfiImplied = americanToImpliedProb(o.yrfi);
    const nrfiEdge = g.nrfiPct - nrfiImplied;
    const yrfiEdge = (1 - g.nrfiPct) - yrfiImplied;
    if (nrfiEdge >= yrfiEdge && (best == null || nrfiEdge > best.edge)) {
      best = { gamePk: g.gamePk, side: "NRFI", ourProb: g.nrfiPct, edge: nrfiEdge };
    } else if (yrfiEdge > nrfiEdge && (best == null || yrfiEdge > best.edge)) {
      best = { gamePk: g.gamePk, side: "YRFI", ourProb: 1 - g.nrfiPct, edge: yrfiEdge };
    }
  }
  return best ? [{ gamePk: best.gamePk, side: best.side, ourProb: best.ourProb }] : [];
}

/** v-ev-pos: same as v-ev but only fires when the best edge is positive.
 *  No play on -EV days. Trades coverage for ROI quality. */
function evPosBestOfDayMl(games: GradedPrediction[], oddsByPk: Map<number, GameOdds>): MlPick[] {
  const candidates = evBestOfDayMl(games, oddsByPk);
  for (const p of candidates) {
    const o = oddsByPk.get(p.gamePk);
    if (!o) return [];
    const odds = p.side === "away" ? o.awayMl : o.homeMl;
    if (odds == null) return [];
    if (p.ourProb - americanToImpliedProb(odds) <= 0) return [];
  }
  return candidates;
}
function evPosBestOfDayNrfi(games: GradedPrediction[], oddsByPk: Map<number, GameOdds>): NrfiPick[] {
  const candidates = evBestOfDayNrfi(games, oddsByPk);
  for (const p of candidates) {
    const o = oddsByPk.get(p.gamePk);
    if (!o) return [];
    const odds = p.side === "NRFI" ? o.nrfi : o.yrfi;
    if (odds == null) return [];
    if (p.ourProb - americanToImpliedProb(odds) <= 0) return [];
  }
  return candidates;
}

// ─── Grader ────────────────────────────────────────────────────────────

const STAKE = 10;

function backtestPickRule(
  games: GradedPrediction[],
  oddsByKey: Map<string, GameOdds>,
  mlRule: MlPickRule,
  nrfiRule: NrfiPickRule,
): { ml: MarketMetrics; nrfi: MarketMetrics } {
  // Group games by date.
  const byDate = new Map<string, GradedPrediction[]>();
  for (const g of games) {
    (byDate.get(g.date) ?? byDate.set(g.date, []).get(g.date)!).push(g);
  }

  let mlPlays = 0, mlHits = 0, mlWithOdds = 0, mlStaked = 0, mlProfit = 0, mlBrierSum = 0;
  let nrfiPlays = 0, nrfiHits = 0, nrfiWithOdds = 0, nrfiStaked = 0, nrfiProfit = 0, nrfiBrierSum = 0;

  for (const [date, dayGames] of byDate) {
    // Build a per-day game-pk lookup for the grader.
    const gameByPk = new Map<number, GradedPrediction>();
    for (const g of dayGames) gameByPk.set(g.gamePk, g);
    // Per-day day-game odds map (same key format).
    const dayOdds = new Map<number, GameOdds>();
    for (const g of dayGames) {
      const o = oddsByKey.get(`${date}|${g.gamePk}`);
      if (o) dayOdds.set(g.gamePk, o);
    }

    // ML
    const mlPicks = mlRule(dayGames, dayOdds);
    for (const p of mlPicks) {
      const g = gameByPk.get(p.gamePk);
      if (!g || g.actualWinner === null) continue;
      mlPlays++;
      const hit = p.side === g.actualWinner;
      if (hit) mlHits++;
      const actualBin = p.side === g.actualWinner ? 1 : 0;
      mlBrierSum += Math.pow(p.ourProb - actualBin, 2);
      const o = dayOdds.get(p.gamePk);
      const odds = p.side === "away" ? o?.awayMl : o?.homeMl;
      if (odds != null) {
        mlWithOdds++;
        mlStaked += STAKE;
        mlProfit += hit ? STAKE * americanToProfitMultiplier(odds) : -STAKE;
      }
    }

    // NRFI
    const nrfiPicks = nrfiRule(dayGames, dayOdds);
    for (const p of nrfiPicks) {
      const g = gameByPk.get(p.gamePk);
      if (!g || g.actualNrfi === null) continue;
      nrfiPlays++;
      const wantNrfi = p.side === "NRFI";
      const hit = wantNrfi === g.actualNrfi;
      if (hit) nrfiHits++;
      const actualBin = hit ? 1 : 0;
      nrfiBrierSum += Math.pow(p.ourProb - actualBin, 2);
      const o = dayOdds.get(p.gamePk);
      const odds = wantNrfi ? o?.nrfi : o?.yrfi;
      if (odds != null) {
        nrfiWithOdds++;
        nrfiStaked += STAKE;
        nrfiProfit += hit ? STAKE * americanToProfitMultiplier(odds) : -STAKE;
      }
    }
  }

  return {
    ml: {
      plays: mlPlays, hits: mlHits,
      hitRate: mlPlays > 0 ? mlHits / mlPlays : null,
      brier:   mlPlays > 0 ? mlBrierSum / mlPlays : null,
      withOdds: mlWithOdds, staked: mlStaked, profit: mlProfit,
      roi: mlStaked > 0 ? mlProfit / mlStaked : null,
    },
    nrfi: {
      plays: nrfiPlays, hits: nrfiHits,
      hitRate: nrfiPlays > 0 ? nrfiHits / nrfiPlays : null,
      brier:   nrfiPlays > 0 ? nrfiBrierSum / nrfiPlays : null,
      withOdds: nrfiWithOdds, staked: nrfiStaked, profit: nrfiProfit,
      roi: nrfiStaked > 0 ? nrfiProfit / nrfiStaked : null,
    },
  };
}

// ─── Post-hoc probability transforms ───────────────────────────────────

/** Apply additional shrinkage to a probability already calibrated at
 *  WIN_SHRINKAGE=0.20. Useful for testing whether the production model
 *  is over- or under-confident without regenerating predictions.
 *  factor = (1 - newShrinkage) / (1 - 0.20). Values < 1 → MORE shrinkage. */
function reshrink(p: number, factor: number): number {
  return Math.max(0.05, Math.min(0.95, 0.5 + (p - 0.5) * factor));
}

function applyReshrink(games: GradedPrediction[], factorMl: number, factorNrfi: number): GradedPrediction[] {
  return games.map((g) => {
    const awayWinPct = reshrink(g.awayWinPct, factorMl);
    const homeWinPct = reshrink(g.homeWinPct, factorMl);
    const nrfiPct    = reshrink(g.nrfiPct,    factorNrfi);
    return { ...g, awayWinPct, homeWinPct, nrfiPct };
  });
}

// ─── Mode 2: regenerate predictions with a variant model ──────────────

/** Loads actuals from prediction_results (the comparator-graded outcome
 *  for each historical game), keyed by (date, game_pk). Used to score
 *  variants whose probabilities differ from production's. */
async function loadActualsByKey(startIso: string, endIso: string): Promise<Map<string, { actualWinner: "away" | "home" | null; actualNrfi: boolean | null }>> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("prediction_results")
    .select("date, game_pk, actual_winner, actual_nrfi")
    .eq("sport", "mlb")
    .eq("model_version", PREDICTIONS_MODEL_VERSION)
    .gte("date", startIso)
    .lte("date", endIso);
  if (error) throw new Error(`loadActualsByKey: ${error.message}`);
  const m = new Map<string, { actualWinner: "away" | "home" | null; actualNrfi: boolean | null }>();
  for (const r of data ?? []) {
    m.set(`${r.date}|${r.game_pk}`, {
      actualWinner: r.actual_winner as "away" | "home" | null,
      actualNrfi: r.actual_nrfi,
    });
  }
  return m;
}

/** Runs a variant model across every date in [start, end], producing
 *  GradedPrediction rows with the VARIANT's probabilities. Actuals
 *  come from prediction_results (same comparator-graded outcomes,
 *  vendor-agnostic from a model-iteration perspective).
 *
 *  Skips dates where prevDay daily_raw is missing — common at season
 *  boundaries. */
async function runModelVariant(
  start: string,
  end: string,
  predictFn: (inputs: PredictionInputs) => PredictionsResult,
): Promise<GradedPrediction[]> {
  const actuals = await loadActualsByKey(start, end);
  const out: GradedPrediction[] = [];

  for (let d = start; d <= end; d = isoNext(d)) {
    const inputs = await loadPredictionInputsForDate(d);
    if (!inputs) continue;
    const preds = predictFn(inputs);
    for (const g of preds.games) {
      const actual = actuals.get(`${d}|${g.gamePk}`);
      if (!actual) continue; // not graded yet
      out.push({
        date: d,
        gamePk: g.gamePk,
        awayWinPct: g.away.winProbability,
        homeWinPct: g.home.winProbability,
        nrfiPct: g.nrfiProbability,
        actualWinner: actual.actualWinner,
        actualNrfi: actual.actualNrfi,
        winCorrect: actual.actualWinner === null ? null : (actual.actualWinner === (g.away.winProbability > g.home.winProbability ? "away" : "home")),
        nrfiCorrect: actual.actualNrfi === null ? null : (actual.actualNrfi === (g.nrfiProbability >= 0.5)),
      });
    }
  }
  return out;
}

// ─── CLI / runner ──────────────────────────────────────────────────────

function fmtPct(v: number | null, digits = 1): string {
  return v == null ? "  —  " : `${(v * 100).toFixed(digits)}%`;
}
function fmtDollar(v: number): string {
  const sign = v >= 0 ? "+" : "−";
  return `${sign}$${Math.abs(v).toFixed(2)}`;
}

function printRow(label: string, m: MarketMetrics) {
  const fields = [
    `plays=${String(m.plays).padStart(3)}`,
    `hits=${String(m.hits).padStart(3)}`,
    `hit%=${fmtPct(m.hitRate)}`,
    `brier=${m.brier == null ? "  —  " : m.brier.toFixed(4)}`,
    `wOdds=${String(m.withOdds).padStart(3)}`,
    `staked=$${m.staked.toString().padStart(4)}`,
    `pl=${fmtDollar(m.profit).padStart(9)}`,
    `roi=${fmtPct(m.roi, 2).padStart(7)}`,
  ];
  console.log(`  ${label.padEnd(6)}  ${fields.join("  ")}`);
}

/** One pick/day max — strongest favorite of the day. Apples-to-apples
 *  comparison vs EV variants which also pick 1/day max. */
function oneBestFavoriteMl(games: GradedPrediction[]): MlPick[] {
  let best: { gamePk: number; favPct: number; side: "away" | "home" } | null = null;
  for (const g of games) {
    if (g.actualWinner === null) continue;
    const fav = Math.max(g.awayWinPct, g.homeWinPct);
    const side: "away" | "home" = g.awayWinPct >= g.homeWinPct ? "away" : "home";
    if (!best || fav > best.favPct) best = { gamePk: g.gamePk, favPct: fav, side };
  }
  return best ? [{ gamePk: best.gamePk, side: best.side, ourProb: best.favPct }] : [];
}
function oneBestNrfiPick(games: GradedPrediction[]): NrfiPick[] {
  let best: { gamePk: number; dev: number; pickNrfi: boolean } | null = null;
  for (const g of games) {
    if (g.actualNrfi === null) continue;
    const dev = Math.abs(g.nrfiPct - 0.5);
    if (!best || dev > best.dev) best = { gamePk: g.gamePk, dev, pickNrfi: g.nrfiPct >= 0.5 };
  }
  return best ? [{ gamePk: best.gamePk, side: best.pickNrfi ? "NRFI" : "YRFI", ourProb: 0.5 + best.dev }] : [];
}

/** EV-only pickers with an edge threshold — only fires when edge >=
 *  threshold (decimal, e.g. 0.03 = 3%). Tests whether small edge is
 *  noise and we should hold out for bigger gaps. */
function evThresholdMl(threshold: number): MlPickRule {
  return (games, oddsByPk) => {
    const c = evBestOfDayMl(games, oddsByPk);
    for (const p of c) {
      const o = oddsByPk.get(p.gamePk);
      if (!o) return [];
      const odds = p.side === "away" ? o.awayMl : o.homeMl;
      if (odds == null) return [];
      if (p.ourProb - americanToImpliedProb(odds) < threshold) return [];
    }
    return c;
  };
}
function evThresholdNrfi(threshold: number): NrfiPickRule {
  return (games, oddsByPk) => {
    const c = evBestOfDayNrfi(games, oddsByPk);
    for (const p of c) {
      const o = oddsByPk.get(p.gamePk);
      if (!o) return [];
      const odds = p.side === "NRFI" ? o.nrfi : o.yrfi;
      if (odds == null) return [];
      if (p.ourProb - americanToImpliedProb(odds) < threshold) return [];
    }
    return c;
  };
}

/** Best favorite/day, gated on the favorite's odds not exceeding a
 *  juice cap. Tests "skip heavy-juice favorites" — winning a -300 only
 *  pays $3.33/$10, so even a 75% hit rate barely breaks even there. */
function bestFavoriteCappedMl(maxJuiceNeg: number): MlPickRule {
  return (games, oddsByPk) => {
    let best: { gamePk: number; favPct: number; side: "away" | "home" } | null = null;
    for (const g of games) {
      if (g.actualWinner === null) continue;
      const fav = Math.max(g.awayWinPct, g.homeWinPct);
      const side: "away" | "home" = g.awayWinPct >= g.homeWinPct ? "away" : "home";
      if (!best || fav > best.favPct) best = { gamePk: g.gamePk, favPct: fav, side };
    }
    if (!best) return [];
    const o = oddsByPk.get(best.gamePk);
    if (!o) return [];
    const odds = best.side === "away" ? o.awayMl : o.homeMl;
    if (odds == null) return [];
    if (odds < maxJuiceNeg) return []; // e.g. -200 < -180 means too juicy
    return [{ gamePk: best.gamePk, side: best.side, ourProb: best.favPct }];
  };
}

/** Top-N strongest favorites per day. Tests whether spreading bets
 *  across the day's top picks is better/worse than concentrating. */
function topNFavoritesMl(n: number): MlPickRule {
  return (games) => {
    const ranked = games
      .filter((g) => g.actualWinner !== null)
      .map((g) => {
        const fav = Math.max(g.awayWinPct, g.homeWinPct);
        const side: "away" | "home" = g.awayWinPct >= g.homeWinPct ? "away" : "home";
        return { gamePk: g.gamePk, favPct: fav, side };
      })
      .sort((a, b) => b.favPct - a.favPct)
      .slice(0, n);
    return ranked.map((r) => ({ gamePk: r.gamePk, side: r.side, ourProb: r.favPct }));
  };
}

/** Best favorite per day, but only if our predicted prob beats book's
 *  implied prob by a margin. Combines favorite-rule + edge sanity
 *  check — skip the day if even our favorite has no edge vs book. */
/** cap-160 + edge gating: only fires when the favorite's our_prob
 *  also beats book_implied by `minEdge`. Combines juice control + EV
 *  sanity check. */
function cappedEvGatedMl(maxJuiceNeg: number, minEdge: number): MlPickRule {
  return (games, oddsByPk) => {
    let best: { gamePk: number; favPct: number; side: "away" | "home" } | null = null;
    for (const g of games) {
      if (g.actualWinner === null) continue;
      const fav = Math.max(g.awayWinPct, g.homeWinPct);
      const side: "away" | "home" = g.awayWinPct >= g.homeWinPct ? "away" : "home";
      if (!best || fav > best.favPct) best = { gamePk: g.gamePk, favPct: fav, side };
    }
    if (!best) return [];
    const o = oddsByPk.get(best.gamePk);
    if (!o) return [];
    const odds = best.side === "away" ? o.awayMl : o.homeMl;
    if (odds == null || odds < maxJuiceNeg) return [];
    if (best.favPct - americanToImpliedProb(odds) < minEdge) return [];
    return [{ gamePk: best.gamePk, side: best.side, ourProb: best.favPct }];
  };
}

/** All threshold-qualifying favorites that ALSO pass the juice cap.
 *  Tests whether high coverage at controlled juice beats 1/day. */
function allThresholdCappedMl(maxJuiceNeg: number): MlPickRule {
  return (games, oddsByPk) => {
    const picks: MlPick[] = [];
    for (const g of games) {
      if (g.actualWinner === null) continue;
      let side: "away" | "home" | null = null;
      let prob = 0;
      if (g.awayWinPct >= ML_PLAY_THRESHOLD) { side = "away"; prob = g.awayWinPct; }
      else if (g.homeWinPct >= ML_PLAY_THRESHOLD) { side = "home"; prob = g.homeWinPct; }
      if (!side) continue;
      const o = oddsByPk.get(g.gamePk);
      if (!o) continue;
      const odds = side === "away" ? o.awayMl : o.homeMl;
      if (odds == null || odds < maxJuiceNeg) continue;
      picks.push({ gamePk: g.gamePk, side, ourProb: prob });
    }
    return picks;
  };
}

function bestFavoriteEvGatedMl(minEdge: number): MlPickRule {
  return (games, oddsByPk) => {
    let best: { gamePk: number; favPct: number; side: "away" | "home" } | null = null;
    for (const g of games) {
      if (g.actualWinner === null) continue;
      const fav = Math.max(g.awayWinPct, g.homeWinPct);
      const side: "away" | "home" = g.awayWinPct >= g.homeWinPct ? "away" : "home";
      if (!best || fav > best.favPct) best = { gamePk: g.gamePk, favPct: fav, side };
    }
    if (!best) return [];
    const o = oddsByPk.get(best.gamePk);
    if (!o) return [];
    const odds = best.side === "away" ? o.awayMl : o.homeMl;
    if (odds == null) return [];
    if (best.favPct - americanToImpliedProb(odds) < minEdge) return [];
    return [{ gamePk: best.gamePk, side: best.side, ourProb: best.favPct }];
  };
}

const VARIANTS: Record<string, { label: string; ml: MlPickRule; nrfi: NrfiPickRule }> = {
  current:    { label: "baseline (every threshold favorite)", ml: alwaysFavoriteMl,    nrfi: alwaysFavoriteNrfi },
  "one-fav":  { label: "1 best favorite/day",                  ml: oneBestFavoriteMl,   nrfi: oneBestNrfiPick },
  "cap-220":  { label: "best fav/day, odds ≥ -220",             ml: bestFavoriteCappedMl(-220), nrfi: oneBestNrfiPick },
  "cap-200":  { label: "best fav/day, odds ≥ -200",             ml: bestFavoriteCappedMl(-200), nrfi: oneBestNrfiPick },
  "cap-180":  { label: "best fav/day, odds ≥ -180",             ml: bestFavoriteCappedMl(-180), nrfi: oneBestNrfiPick },
  "cap-170":  { label: "best fav/day, odds ≥ -170",             ml: bestFavoriteCappedMl(-170), nrfi: oneBestNrfiPick },
  "cap-160":  { label: "best fav/day, odds ≥ -160",             ml: bestFavoriteCappedMl(-160), nrfi: oneBestNrfiPick },
  "cap-150":  { label: "best fav/day, odds ≥ -150",             ml: bestFavoriteCappedMl(-150), nrfi: oneBestNrfiPick },
  "cap-140":  { label: "best fav/day, odds ≥ -140",             ml: bestFavoriteCappedMl(-140), nrfi: oneBestNrfiPick },
  "cap-130":  { label: "best fav/day, odds ≥ -130",             ml: bestFavoriteCappedMl(-130), nrfi: oneBestNrfiPick },
  "all-160":  { label: "all threshold favs, odds ≥ -160",       ml: allThresholdCappedMl(-160), nrfi: oneBestNrfiPick },
  "all-180":  { label: "all threshold favs, odds ≥ -180",       ml: allThresholdCappedMl(-180), nrfi: oneBestNrfiPick },
  "top-2":    { label: "top-2 favorites/day",                   ml: topNFavoritesMl(2),         nrfi: oneBestNrfiPick },
  "top-3":    { label: "top-3 favorites/day",                   ml: topNFavoritesMl(3),         nrfi: oneBestNrfiPick },
  "ev-gated": { label: "best fav/day, our edge ≥ 2%",           ml: bestFavoriteEvGatedMl(0.02),nrfi: oneBestNrfiPick },
  "cap-160-ev-0": { label: "cap-160 + edge ≥ 0%",     ml: cappedEvGatedMl(-160, 0.0),  nrfi: oneBestNrfiPick },
  "cap-160-ev-2": { label: "cap-160 + edge ≥ 2%",     ml: cappedEvGatedMl(-160, 0.02), nrfi: oneBestNrfiPick },
  "cap-160-ev-5": { label: "cap-160 + edge ≥ 5%",     ml: cappedEvGatedMl(-160, 0.05), nrfi: oneBestNrfiPick },
  "cap-180-ev-2": { label: "cap-180 + edge ≥ 2%",     ml: cappedEvGatedMl(-180, 0.02), nrfi: oneBestNrfiPick },
  "cap-200-ev-2": { label: "cap-200 + edge ≥ 2%",     ml: cappedEvGatedMl(-200, 0.02), nrfi: oneBestNrfiPick },
  ev:         { label: "EV best-of-day",                        ml: evBestOfDayMl,      nrfi: evBestOfDayNrfi },
  "ev-8pct":  { label: "EV best-of-day, edge ≥ 8%",             ml: evThresholdMl(0.08), nrfi: evThresholdNrfi(0.08) },
};

async function main() {
  const args = process.argv.slice(2);
  const variantKey = args.includes("--variant") ? args[args.indexOf("--variant") + 1] : null;
  const reshrinkArg = args.includes("--reshrink-ml") ? Number(args[args.indexOf("--reshrink-ml") + 1]) : null;
  const start = args.includes("--start") ? args[args.indexOf("--start") + 1] : "2026-06-01";
  const end   = args.includes("--end")   ? args[args.indexOf("--end")   + 1] : new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

  // Mode-2 model knobs — when any is present, regenerate predictions
  // via predictGames(config) instead of reading prediction_results.
  const hfaArg     = args.includes("--hfa")        ? Number(args[args.indexOf("--hfa") + 1]) : null;
  const spCapArg   = args.includes("--sp-cap")     ? Number(args[args.indexOf("--sp-cap") + 1]) : null;
  const spScaleArg = args.includes("--sp-scale")   ? Number(args[args.indexOf("--sp-scale") + 1]) : null;
  const winShrkArg = args.includes("--win-shrink") ? Number(args[args.indexOf("--win-shrink") + 1]) : null;
  const modelMode = hfaArg !== null || spCapArg !== null || spScaleArg !== null || winShrkArg !== null;

  console.log(`backtest window: ${start} → ${end} (model_version=${PREDICTIONS_MODEL_VERSION})`);
  console.log(`stake: $${STAKE}/play`);
  if (reshrinkArg !== null) console.log(`post-hoc ML reshrink factor: ${reshrinkArg}`);
  if (modelMode) {
    const knobs: string[] = [];
    if (hfaArg     !== null) knobs.push(`hfa=${hfaArg}`);
    if (spCapArg   !== null) knobs.push(`spCap=${spCapArg}`);
    if (spScaleArg !== null) knobs.push(`spScale=${spScaleArg}`);
    if (winShrkArg !== null) knobs.push(`winShrink=${winShrkArg}`);
    console.log(`MODE 2: regenerating with config { ${knobs.join(", ")} }`);
  }
  console.log();

  const odds = await loadOdds(start ?? "", end ?? "");
  let rawGames: GradedPrediction[];
  if (modelMode) {
    const cfg: PredictionConfig = {};
    if (hfaArg     !== null) cfg.homeFieldBump = hfaArg;
    if (spCapArg   !== null) cfg.spDeltaCap    = spCapArg;
    if (spScaleArg !== null) cfg.spEraToWinPct = spScaleArg;
    if (winShrkArg !== null) cfg.winShrinkage  = winShrkArg;
    rawGames = await runModelVariant(start ?? "", end ?? "", (inputs) =>
      predictGames({ ...inputs, config: cfg }),
    );
  } else {
    rawGames = await loadGradedSeason(start ?? "", end ?? "");
  }
  const games = reshrinkArg !== null ? applyReshrink(rawGames, reshrinkArg, 1.0) : rawGames;
  console.log(`loaded ${rawGames.length} graded predictions, ${odds.size} odds rows`);
  console.log();

  const keysToRun = variantKey ? [variantKey] : Object.keys(VARIANTS);
  for (const key of keysToRun) {
    const v = VARIANTS[key];
    if (!v) { console.error(`unknown variant: ${key}`); continue; }
    console.log(`── ${key}: ${v.label} ─────────────────────────────────`);
    const result = backtestPickRule(games, odds, v.ml, v.nrfi);
    printRow("ML",   result.ml);
    printRow("NRFI", result.nrfi);
    console.log();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
