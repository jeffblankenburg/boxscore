// Sort key for the Transactions section — order a day's moves by the team they
// concern so the list reads by club. statsapi gives no single "team" field, but
// the description always LEADS with the acting team's full name, which is one of
// fromTeam/toTeam ("Baltimore Orioles activated …" → toTeam; "Detroit Tigers
// sent … to Lakeland" → fromTeam). Fall back to toTeam/fromTeam when the
// description leads with a player instead of a team.

import type { MlbTransaction } from "./types";

export function primaryTeamName(t: MlbTransaction): string {
  const lead = [t.toTeam, t.fromTeam].find((tm) => tm && t.description.startsWith(tm.name));
  return (lead ?? t.toTeam ?? t.fromTeam)?.name ?? "";
}

// Stable-ish ordering: team name, then the raw description as a tiebreaker so a
// club's moves keep a deterministic order.
export function sortTransactionsByTeam<T extends MlbTransaction>(txs: T[]): T[] {
  return [...txs].sort(
    (a, b) =>
      primaryTeamName(a).localeCompare(primaryTeamName(b)) ||
      a.description.localeCompare(b.description),
  );
}
