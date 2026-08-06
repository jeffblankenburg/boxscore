// Subscriber counts for every email list, for the /admin dashboard grid. Each
// count is the ACCURATE deliverable audience — active opt-in rows whose
// subscriber account is also status='active' (the same intersection the send
// crons fan out to). The PostgREST `subscribers!inner(status)` embed does the
// join server-side so a 6k-row list counts in one head request, no pagination.
//
// change24h is a live flow, not a snapshot diff: net opt-ins over the last 24h
// (rows added minus rows toggled off). Full-account unsubscribes that flip the
// subscriber's status without touching the opt-in row aren't captured here —
// for exact day-over-day, a daily count snapshot would be the next step.

import { supabaseAdmin } from "./supabase";

export type EmailListStat = {
  key: string;
  label: string;
  count: number;
  change24h: number;
};

type ListDef = { key: string; label: string; sport: string; scope: "league" | "team" | "conference" };

// Order + labels per Jeff's grid. "Team" and "Conference" rows are TOTALS across
// all teams/conferences (one email_subscriptions row per opt-in), not per-entity.
const LISTS: ListDef[] = [
  { key: "mlb-league", label: "MLB League", sport: "mlb", scope: "league" },
  { key: "mlb-team", label: "MLB Team", sport: "mlb", scope: "team" },
  { key: "nfl-league", label: "NFL League", sport: "nfl", scope: "league" },
  { key: "nfl-team", label: "NFL Team", sport: "nfl", scope: "team" },
  { key: "nba-league", label: "NBA League", sport: "nba", scope: "league" },
  { key: "nba-team", label: "NBA Team", sport: "nba", scope: "team" },
  { key: "ncaaf-league", label: "NCAAF Top 25", sport: "ncaaf", scope: "league" },
  { key: "ncaaf-conference", label: "NCAAF Conference", sport: "ncaaf", scope: "conference" },
  { key: "ncaaf-team", label: "NCAAF Team", sport: "ncaaf", scope: "team" },
  { key: "wnba-league", label: "WNBA League", sport: "wnba", scope: "league" },
  { key: "wnba-team", label: "WNBA Team", sport: "wnba", scope: "team" },
];

export async function getEmailListStats(): Promise<EmailListStat[]> {
  const db = supabaseAdmin();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Active deliverable rows for (sport, scope) — the shared count base.
  const active = (sport: string, scope: string) =>
    db
      .from("email_subscriptions")
      .select("subscriber_id, subscribers!inner(status)", { count: "exact", head: true })
      .eq("sport", sport)
      .eq("scope", scope)
      .eq("active", true)
      .eq("subscribers.status", "active");

  return Promise.all(
    LISTS.map(async (l): Promise<EmailListStat> => {
      const [cur, adds, removes] = await Promise.all([
        active(l.sport, l.scope),
        active(l.sport, l.scope).gte("created_at", cutoff),
        db
          .from("email_subscriptions")
          .select("subscriber_id", { count: "exact", head: true })
          .eq("sport", l.sport)
          .eq("scope", l.scope)
          .eq("active", false)
          .gte("updated_at", cutoff),
      ]);
      return {
        key: l.key,
        label: l.label,
        count: cur.count ?? 0,
        change24h: (adds.count ?? 0) - (removes.count ?? 0),
      };
    }),
  );
}
