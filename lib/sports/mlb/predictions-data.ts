// Data-loading wrapper around the predictions module. Both the
// /mlb/predictions page (live render) and the snapshot cron call this —
// keeping the data plumbing in one place so they can never drift.
//
// Inputs ALL come from yesterday's daily_raw payload:
//   - standings (as of last night, post-yesterday's games)
//   - probablePitcherStats for tonight's slate
//   - nextDaySchedule = tonight's slate as known when the cron wrote
//     the row, parsed into SlateGame shape with the same parser the
//     live getSlate path uses.
//
// No statsapi calls — keeps the model fully reproducible from cached
// state, which makes historical backfills leak-free.

import { supabaseAdmin } from "@/lib/supabase";
import { parseSlate, type SlateGame } from "@/lib/mlb";
import { prevDay } from "@/lib/dates";
import {
  predictGames,
  type PredictionsResult,
  type TeamSeasonRecord,
  type ProbableSpStats,
} from "./predictions";
import { loadSeasonAggregates } from "./season-aggregates";

const PYTHAG_FALLBACK_SP_ERA = 4.20;

type StandingsTeamRecord = {
  team: { id: number; name?: string };
  wins?: number;
  losses?: number;
  runsScored?: number;
  runsAllowed?: number;
  gamesPlayed?: number;
};
type StandingsEnvelope = {
  records?: Array<{ teamRecords?: StandingsTeamRecord[] }>;
};

function parseFiniteNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Loads the model inputs for `date` from cached daily_raw — does NOT
 *  call the model. Split out so the backtest harness can substitute a
 *  variant predictGames implementation without duplicating the
 *  data-loading plumbing. Returns null if the upstream daily_raw row
 *  for prevDay(date) is missing (no slate snapshot to build from). */
export async function loadPredictionInputsForDate(date: string): Promise<{
  date: string;
  slate: SlateGame[];
  recordsByTeamId: Map<number, TeamSeasonRecord>;
  spStatsById: Map<number, ProbableSpStats>;
  aggregates: Awaited<ReturnType<typeof loadSeasonAggregates>> | undefined;
} | null> {
  const sb = supabaseAdmin();

  // Yesterday's daily_raw → everything. The generate cron writes this
  // row at 5 AM ET each morning; it contains the standings as of that
  // moment (post yesterday's games), probable-pitcher season stats for
  // tonight's slate, AND the nextDaySchedule blob which IS tonight's
  // slate. No live statsapi call required.
  const { data } = await sb
    .from("daily_raw")
    .select("payload")
    .eq("sport", "mlb")
    .eq("date", prevDay(date))
    .limit(1);
  const payload = (data?.[0]?.payload as Record<string, unknown>) ?? {};

  // Parse nextDaySchedule into SlateGame shape with the same parser
  // the live getSlate() path uses — so the model sees identical input
  // structure whether the data came from statsapi live or cache.
  let slate: SlateGame[] = [];
  try {
    slate = parseSlate(payload.nextDaySchedule);
  } catch {
    slate = [];
  }

  // 3. Build team-records lookup keyed by statsapi team id.
  const recordsByTeamId = new Map<number, TeamSeasonRecord>();
  const standings = (payload.standings as StandingsEnvelope | undefined) ?? {};
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

  // 4. Probable-SP stats. Some probables may be missing if they were
  //    just announced today (after yesterday's daily_raw cache); for v1
  //    we accept neutral SP factor in that case rather than refetching.
  const spStatsById = new Map<number, ProbableSpStats>();
  const pps = (payload.probablePitcherStats as Record<string, {
    era?: string | number;
    wins?: number;
    losses?: number;
  }>) ?? {};
  for (const [pidStr, st] of Object.entries(pps)) {
    const pid = Number(pidStr);
    if (!Number.isFinite(pid)) continue;
    spStatsById.set(pid, {
      era: parseFiniteNumber(st.era),
      wins: st.wins ?? null,
      losses: st.losses ?? null,
    });
  }
  // Make sure every probable SP in today's slate has at least a fallback
  // entry — otherwise a brand-new probable will silently fall through.
  for (const g of slate) {
    for (const pp of [g.away.probablePitcher, g.home.probablePitcher]) {
      if (pp && !spStatsById.has(pp.id)) {
        spStatsById.set(pp.id, { era: PYTHAG_FALLBACK_SP_ERA, wins: null, losses: null });
      }
    }
  }

  // Season aggregates — team 1st-inning RPG, team bullpen ERA, and
  // per-SP 1st-inning ERA. Computed from `daily_raw` payloads we
  // already cache; falls back to league averages where a team or
  // pitcher hasn't accumulated enough sample yet (see
  // sp1stInningEra / team1stInningRpg / bullpenDelta min thresholds).
  // Loader is memoized per process for 6h, so the cold-start hit
  // only happens once per warm serverless instance.
  const season = Number(date.slice(0, 4));
  const aggregates = await loadSeasonAggregates(season, prevDay(date));

  return { date, slate, recordsByTeamId, spStatsById, aggregates };
}

export async function loadPredictionsForDate(date: string): Promise<PredictionsResult> {
  const inputs = await loadPredictionInputsForDate(date);
  if (!inputs) return { date, gameCount: 0, games: [], generatedAt: new Date().toISOString() };
  return predictGames(inputs);
}

/** Stable version string for predictions snapshots. Bump when the model
 *  formula changes (or calibration is refit) so historical attribution
 *  stays clean.
 *
 *  v4 layers empirical linear shrinkage onto v3: WIN_SHRINKAGE=0.20,
 *  NRFI_SHRINKAGE=0.15 fit by Brier-minimizing least squares on 313
 *  graded June games. Threshold bands re-anchored to the calibrated
 *  scale (0.545 play / 0.555 strong) so the displayed probability and
 *  the play logic agree.
 *
 *  Note (2026-07-01): v5-empirical was tried and reverted — bumping
 *  HOME_FIELD_BUMP to 0.060 diluted the ML pick pool (56% vs 61.6% on
 *  home picks), and NRFI shrinkage of 0.05 killed all NRFI plays.
 *  Instead of retuning calibration, the play-selection rule was
 *  changed to home-only ML (winPlayFor). The stored calibrated
 *  probabilities are unchanged. */
export const PREDICTIONS_MODEL_VERSION = "v6-nrfi-rebased";
