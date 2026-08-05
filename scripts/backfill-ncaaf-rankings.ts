// Backfill real, in-season NCAAF poll rankings into a preview date's daily_raw.
//
// WHY: ESPN's site `/rankings` endpoint only ever returns the CURRENT poll and
// ignores week/year params. That's correct for the daily production cron (today
// == current week), but during the offseason the "current" poll is the 2026
// preseason Coaches poll — so any HISTORICAL preview date renders that stale,
// cross-season poll (and no AP Top 25). ESPN's core API *does* serve historical
// polls keyed by season/type/week, at the cost of resolving team + conference
// $refs. This script fetches the correct week's polls (AP, Coaches, CFP when it
// exists), shapes them like the site feed the adapter expects, and swaps them
// into the cached payload — leaving games/standings/boxscores untouched.
//
//   npx tsx --env-file=.env.local scripts/backfill-ncaaf-rankings.ts 2025-11-02 [more dates...]
//
// Idempotent: rerunning for a date just re-replaces its rankings.

import { supabaseAdmin } from "../lib/supabase";
import { loadFootballData } from "../lib/sports/football/data";

const CORE = "https://sports.core.api.espn.com/v2/sports/football/leagues/college-football";
// Polls worth showing in an FBS recap — matches adaptRankings' filter.
const KEEP = /AP Top 25|Coaches Poll|College Football Playoff|CFP/i;
const DROP = /FCS|Division/i;

async function j(url: string): Promise<any> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}
async function jref(ref: string | undefined): Promise<any | null> {
  if (!ref) return null;
  try { return await j(ref); } catch { return null; }
}

// Which (season, seasonType, week) does this date fall in? Scan the core
// calendar's week date ranges — regular season (type 2) then postseason (3).
async function findWeek(date: string): Promise<{ season: number; type: number; week: number }> {
  const season = Number(date.slice(0, 4));
  for (const type of [2, 3]) {
    const list = await jref(`${CORE}/seasons/${season}/types/${type}/weeks?lang=en&region=us`);
    for (const it of list?.items ?? []) {
      const w = await jref(it.$ref);
      const s = String(w?.startDate ?? "").slice(0, 10);
      const e = String(w?.endDate ?? "").slice(0, 10);
      if (s && e && s <= date && date <= e) return { season, type, week: Number(w.number) };
    }
  }
  throw new Error(`no week covers ${date}`);
}

const groupCache = new Map<string, string | null>();
async function confShortName(team: any): Promise<string | null> {
  const ref: string | undefined = team?.groups?.$ref;
  if (!ref) return null;
  if (groupCache.has(ref)) return groupCache.get(ref)!;
  const g = await jref(ref);
  const short = g?.shortName ?? g?.name ?? null;
  groupCache.set(ref, short);
  return short;
}

// Shape one core-API poll like the site feed: { name, ranks: [{ current,
// previous, points, firstPlaceVotes, recordSummary, team:{...} }] }.
async function buildPoll(ref: string): Promise<{ name: string; ranks: any[] } | null> {
  const poll = await jref(ref);
  if (!poll || !KEEP.test(poll.name) || DROP.test(poll.name)) return null;
  const ranks = await Promise.all(
    (poll.ranks ?? []).map(async (r: any) => {
      const team = await jref(r.team?.$ref);
      const conf = team ? await confShortName(team) : null;
      return {
        current: r.current,
        previous: r.previous,
        points: r.points,
        firstPlaceVotes: r.firstPlaceVotes,
        recordSummary: r.record?.summary ?? null, // in-season records are inline
        team: team
          ? {
              id: String(team.id),
              abbreviation: team.abbreviation,
              displayName: team.displayName,
              location: team.location,
              name: team.name,
              nickname: team.nickname,
              groups: conf ? { shortName: conf, isConference: true } : undefined,
            }
          : null,
      };
    }),
  );
  return { name: poll.name, ranks: ranks.filter((r) => r.team) };
}

async function backfill(date: string): Promise<void> {
  // Ensure the day's payload exists (games/standings/boxes) before we edit it.
  await loadFootballData("ncaaf", date);

  const { season, type, week } = await findWeek(date);
  const list = await jref(`${CORE}/seasons/${season}/types/${type}/weeks/${week}/rankings?lang=en&region=us`);
  const polls = (
    await Promise.all((list?.items ?? []).map((it: any) => buildPoll(it.$ref)))
  ).filter(Boolean) as Array<{ name: string; ranks: any[] }>;
  // AP first, then Coaches/CFP — the render prefers AP anyway, but keep order tidy.
  polls.sort((a, b) => (/AP Top 25/i.test(b.name) ? 1 : 0) - (/AP Top 25/i.test(a.name) ? 1 : 0));

  const sb = supabaseAdmin();
  const { data } = await sb
    .from("daily_raw")
    .select("payload")
    .eq("sport", "ncaaf")
    .eq("date", date)
    .maybeSingle<{ payload: any }>();
  if (!data?.payload) throw new Error(`no cached payload for ${date} after load`);

  const payload = data.payload;
  payload.rankings = { rankings: polls };
  const { error } = await sb.from("daily_raw").upsert(
    { sport: "ncaaf", date, payload, fetched_at: new Date().toISOString() },
    { onConflict: "sport,date" },
  );
  if (error) throw error;
  console.log(
    `${date}: season ${season} type ${type} week ${week} → ${polls.map((p) => `${p.name}[${p.ranks.length}]`).join(", ")}`,
  );
}

async function main() {
  const dates = process.argv.slice(2);
  if (dates.length === 0) {
    console.error("usage: backfill-ncaaf-rankings.ts <YYYY-MM-DD> [more dates...]");
    process.exit(1);
  }
  for (const d of dates) await backfill(d);
  console.log(`Done — backfilled ${dates.length} date(s).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
