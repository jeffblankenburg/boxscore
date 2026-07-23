// Shared loader for v7 fitting + backtesting. Does the slow part ONCE:
// reconstructs every 2026 game's point-in-time v7 TeamInputs (offense /
// pitching ratings, cfg-independent) from daily_raw, plus outcomes, odds,
// and the shipped v6 probabilities. Downstream, fit/backtest just run
// deriveMarkets(cfg) over the cached inputs — fast enough to grid-search.
//
// Not runnable on its own; imported by scripts/fit-v7.ts + backtest-v7.ts.

import { supabaseAdmin } from "@/lib/supabase";
import { parseSlate, type SlateGame } from "@/lib/mlb";
import { prevDay } from "@/lib/dates";
import { predictGames, type TeamSeasonRecord, type ProbableSpStats } from "@/lib/sports/mlb/predictions";
import { computeSeasonAggregatesFromRows } from "@/lib/sports/mlb/season-aggregates";
import { DEFAULT_V7_CONFIG, deriveMarkets, type TeamInputs, type V7Config } from "@/lib/sports/mlb/run-model";
import { buildV7TeamInputs } from "@/lib/sports/mlb/predictions-v7";

const V6_VERSION = "v6-nrfi-rebased";

export type EvalGame = {
  date: string; gamePk: number; awayAbbr: string; homeAbbr: string;
  away: TeamInputs; home: TeamInputs;
  actualWinner: "away" | "home"; actualNrfi: boolean;
  mlHomeOdds: number | null; nrfiOdds: number | null; yrfiOdds: number | null;
  v6HomeWin: number; v6Nrfi: number;              // shipped
  reV6HomeWin: number; reV6Nrfi: number;          // recomputed (faithfulness)
};

type ResultRow = {
  date: string; game_pk: number; status: string;
  actual_winner: "away" | "home" | null; actual_nrfi: boolean | null;
  home_win_pct: number; nrfi_pct: number;
};
type RawRow = { date: string; payload: Record<string, unknown> };

async function pageAll<T>(build: (f: number, t: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await build(f, f + 999);
    if (error) throw error;
    const chunk = (data as T[]) ?? [];
    out.push(...chunk);
    if (chunk.length < 1000) break;
  }
  return out;
}

// Mirrors loadPredictionInputsForDate (predictions-data.ts §3–4).
function parsePayload(payload: Record<string, unknown>) {
  let slate: SlateGame[] = [];
  try { slate = parseSlate(payload.nextDaySchedule); } catch { slate = []; }

  const records = new Map<number, TeamSeasonRecord>();
  const standings = (payload.standings as { records?: Array<{ teamRecords?: Array<{ team?: { id?: number }; wins?: number; losses?: number; runsScored?: number; runsAllowed?: number; gamesPlayed?: number }> }> }) ?? {};
  for (const rec of standings.records ?? []) {
    for (const tr of rec.teamRecords ?? []) {
      if (typeof tr.team?.id !== "number") continue;
      records.set(tr.team.id, {
        teamId: tr.team.id, wins: tr.wins ?? 0, losses: tr.losses ?? 0,
        runsScored: tr.runsScored ?? 0, runsAllowed: tr.runsAllowed ?? 0, gamesPlayed: tr.gamesPlayed ?? 0,
      });
    }
  }

  const spStats = new Map<number, ProbableSpStats>();
  const pps = (payload.probablePitcherStats as Record<string, { era?: string | number; wins?: number; losses?: number }>) ?? {};
  for (const [pidStr, st] of Object.entries(pps)) {
    const pid = Number(pidStr);
    if (!Number.isFinite(pid)) continue;
    const eraN = typeof st.era === "number" ? st.era : Number(st.era);
    spStats.set(pid, { era: Number.isFinite(eraN) ? eraN : null, wins: st.wins ?? null, losses: st.losses ?? null });
  }
  for (const g of slate) {
    for (const pp of [g.away.probablePitcher, g.home.probablePitcher]) {
      if (pp && !spStats.has(pp.id)) spStats.set(pp.id, { era: 4.20, wins: null, losses: null });
    }
  }
  return { slate, records, spStats };
}

// ─── shared walk-forward v7 fitting (fit-v7.ts + fit-registry.ts) ────────

export const clampProb = (p: number) => Math.min(1 - 1e-6, Math.max(1e-6, p));
export const logLoss = (p: number, y: boolean) => -(y ? Math.log(clampProb(p)) : Math.log(1 - clampProb(p)));

const GRID_BETA = [0.3, 0.5, 0.7, 0.9, 1.1, 1.3];
const GRID_HFA = [1.0, 1.01, 1.02, 1.03, 1.04, 1.05];

export type V7Probs = { homeWin: number; nrfi: number };
export function predictV7(g: EvalGame, cfg: V7Config): V7Probs | null {
  const m = deriveMarkets(g.away, g.home, cfg);
  if (!Number.isFinite(m.homeWin) || !Number.isFinite(m.nrfi)) return null;
  return { homeWin: m.homeWin, nrfi: m.nrfi };
}

// Combined ML+NRFI log-loss over a game set for a candidate cfg.
function trainLoss(games: EvalGame[], cfg: V7Config): number {
  let sum = 0, n = 0;
  for (const g of games) {
    const p = predictV7(g, cfg);
    if (!p) continue;
    sum += logLoss(p.homeWin, g.actualWinner === "home") + logLoss(p.nrfi, g.actualNrfi);
    n++;
  }
  return n ? sum / n : Infinity;
}

/** Min-log-loss grid fit of the v7 composition weights on a training set. */
export function fitV7Grid(train: EvalGame[]): V7Config {
  let best = DEFAULT_V7_CONFIG, bestLoss = Infinity;
  for (const betaOff of GRID_BETA)
    for (const betaPitch of GRID_BETA)
      for (const hfaMultiplier of GRID_HFA) {
        const cfg = { ...DEFAULT_V7_CONFIG, betaOff, betaPitch, hfaMultiplier };
        const loss = trainLoss(train, cfg);
        if (loss < bestLoss) { bestLoss = loss; best = cfg; }
      }
  return best;
}

/** Reconstruct all graded games for the season with cached v7 inputs. */
export async function loadEvalGames(year: string): Promise<EvalGame[]> {
  const sb = supabaseAdmin();

  const results = await pageAll<ResultRow>((f, t) => sb.from("prediction_results")
    .select("date,game_pk,status,actual_winner,actual_nrfi,home_win_pct,nrfi_pct")
    .eq("sport", "mlb").eq("model_version", V6_VERSION)
    .gte("date", `${year}-03-01`).lte("date", `${year}-12-31`).range(f, t));

  type OddsRow = { date: string; game_pk: number; book: string; home_ml_odds: number | null; nrfi_odds: number | null; yrfi_odds: number | null };
  const oddsRows = await pageAll<OddsRow>((f, t) => sb.from("daily_odds_first")
    .select("date,game_pk,book,home_ml_odds,nrfi_odds,yrfi_odds")
    .eq("sport", "mlb").in("book", ["DraftKings", "FanDuel"])
    .gte("date", `${year}-03-01`).lte("date", `${year}-12-31`).range(f, t));
  const mlOdds = new Map<string, number>(), nrfiOdds = new Map<string, number>(), yrfiOdds = new Map<string, number>();
  for (const o of oddsRows) {
    const k = `${o.date}|${o.game_pk}`;
    if (o.book === "DraftKings" && o.home_ml_odds != null) mlOdds.set(k, o.home_ml_odds);
    if (o.book === "FanDuel") { if (o.nrfi_odds != null) nrfiOdds.set(k, o.nrfi_odds); if (o.yrfi_odds != null) yrfiOdds.set(k, o.yrfi_odds); }
  }

  const dateList = await pageAll<{ date: string }>((f, t) => sb.from("daily_raw")
    .select("date").eq("sport", "mlb").gte("date", `${year}-03-01`).lte("date", `${year}-12-31`)
    .order("date", { ascending: true }).range(f, t));
  const rows: RawRow[] = [];
  for (const { date } of dateList) {
    const { data } = await sb.from("daily_raw").select("date,payload").eq("sport", "mlb").eq("date", date).limit(1);
    const r = data?.[0] as RawRow | undefined;
    if (r) rows.push(r);
  }
  const payloadByDate = new Map(rows.map((r) => [r.date, r.payload]));

  const graded = results.filter((r) => /final/i.test(r.status) && r.actual_winner && r.actual_nrfi !== null);
  const byDate = new Map<string, ResultRow[]>();
  for (const r of graded) { const l = byDate.get(r.date) ?? []; l.push(r); byDate.set(r.date, l); }

  const games: EvalGame[] = [];
  for (const date of [...byDate.keys()].sort()) {
    const prevPayload = payloadByDate.get(prevDay(date));
    if (!prevPayload) continue;
    const { slate, records, spStats } = parsePayload(prevPayload);
    const aggRows = rows.filter((r) => r.date <= prevDay(date)) as Parameters<typeof computeSeasonAggregatesFromRows>[0];
    const aggs = computeSeasonAggregatesFromRows(aggRows, prevDay(date));
    const v6Result = predictGames({ date, slate, recordsByTeamId: records, spStatsById: spStats, aggregates: aggs });
    const v6ByPk = new Map(v6Result.games.map((g) => [g.gamePk, g]));
    const slateByPk = new Map(slate.map((g) => [g.gamePk, g]));

    for (const res of byDate.get(date)!) {
      const g = slateByPk.get(res.game_pk);
      const v6g = v6ByPk.get(res.game_pk);
      if (!g || !v6g) continue;
      const k = `${res.date}|${res.game_pk}`;
      const away = buildV7TeamInputs(g.away.teamId, g.away.probablePitcher?.id ?? null, g.home.teamId, records, spStats, aggs);
      const home = buildV7TeamInputs(g.home.teamId, g.home.probablePitcher?.id ?? null, g.home.teamId, records, spStats, aggs);
      games.push({
        date: res.date, gamePk: res.game_pk, awayAbbr: g.away.abbr, homeAbbr: g.home.abbr,
        away, home,
        actualWinner: res.actual_winner!, actualNrfi: res.actual_nrfi!,
        mlHomeOdds: mlOdds.get(k) ?? null, nrfiOdds: nrfiOdds.get(k) ?? null, yrfiOdds: yrfiOdds.get(k) ?? null,
        v6HomeWin: res.home_win_pct, v6Nrfi: res.nrfi_pct,
        reV6HomeWin: v6g.home.winProbability, reV6Nrfi: v6g.nrfiProbability,
      });
    }
  }
  return games;
}
