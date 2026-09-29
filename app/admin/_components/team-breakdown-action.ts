"use server";

import { requireAdmin } from "../require-admin";
import { getTeamSendBreakdown, type TeamSendStat } from "@/lib/dashboard";

// Lazy per-team send breakdown for the expandable all-sports table. Guarded by
// requireAdmin so the aggregation can't be invoked by a non-admin client.
export async function loadTeamBreakdown(sport: string, days: number): Promise<TeamSendStat[]> {
  await requireAdmin();
  return getTeamSendBreakdown(sport, days);
}
