// Data-loading wrapper around the predictions module. Both the
// /mlb/predictions page (live render) and the snapshot cron call this —
// keeping the data plumbing in one place so they can never drift.
//
// Inputs come from:
//   - statsapi (today's slate, fresh per request)
//   - yesterday's daily_raw payload (standings + probablePitcherStats,
//     cached so we don't hammer statsapi on every page view)

import { supabaseAdmin } from "@/lib/supabase";
import { getSlate, type SlateGame } from "@/lib/mlb";
import { prevDay } from "@/lib/dates";
import {
  predictGames,
  type PredictionsResult,
  type TeamSeasonRecord,
  type ProbableSpStats,
} from "./predictions";

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

export async function loadPredictionsForDate(date: string): Promise<PredictionsResult> {
  const sb = supabaseAdmin();

  // 1. Today's slate (live).
  let slate: SlateGame[];
  try {
    slate = await getSlate(date);
  } catch {
    slate = [];
  }

  // 2. Yesterday's daily_raw → standings + probablePitcherStats. Cached
  //    in our DB by the daily generate cron, no live statsapi call needed.
  const { data } = await sb
    .from("daily_raw")
    .select("payload")
    .eq("sport", "mlb")
    .eq("date", prevDay(date))
    .limit(1);
  const payload = (data?.[0]?.payload as Record<string, unknown>) ?? {};

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

  return predictGames({ date, slate, recordsByTeamId, spStatsById });
}

/** Stable version string for predictions snapshots. Bump when the model
 *  formula changes so historical calibration stays attributable. */
export const PREDICTIONS_MODEL_VERSION = "v1-pythag-log5-home";
