// A multi-player trade returns one transaction record per player, each carrying
// the SAME free-text description ("Toronto traded RHP … to Minnesota for …").
// Without dedup a single deal renders once per player — six identical lines for
// a six-player trade. No vendor exposes a transaction-group id at our canonical
// boundary, so the description is the only stable key. Keep the first
// occurrence; leave rows with no description untouched (nothing to key on).
//
// Applied at each sport's transaction build point so every surface (league +
// team, web + email) inherits deduped data. See callers in lib/basketball.ts,
// lib/sports/mlb/adapters/from-statsapi.ts, lib/render-team-email.ts, and
// lib/sports/football/adapters/from-espn.ts.
export function dedupeTransactions<T extends { description: string }>(
  txns: readonly T[],
): T[] {
  const seen = new Set<string>();
  return txns.filter((t) => {
    if (!t.description) return true;
    if (seen.has(t.description)) return false;
    seen.add(t.description);
    return true;
  });
}
