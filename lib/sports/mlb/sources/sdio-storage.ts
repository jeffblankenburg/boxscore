// Storage glue for SDIO raw payloads. Read/write daily_raw_sdio.
// Kept separate from the fetcher so the cron can write while the admin
// preview can read without any code path triggering a network call by
// accident.
//
// Snapshot preservation: SDIO's Standings and PlayerSeasonStats endpoints
// return CURRENT season state with no historical/point-in-time parameter
// — same shape as statsapi's leaders endpoint (see lib/daily.ts:244).
// On refetch of an already-stored date, we keep the original snapshot
// for those two fields rather than stomping them with today's numbers,
// so a historical digest from /mlb/2026-03-25 still shows leaders that
// reflect 2026-03-25, not whatever's current.
//
// Validation flows (the canonical side-by-side comparison) need fresh
// data on both sides — opt out via `force: true`.

import { supabaseAdmin } from "@/lib/supabase";
import { fetchSdioDaily, type SdioDailyPayload } from "./sdio-fetch-daily";

export async function getSdioDailyRaw(
  sport: string,
  date:  string,
): Promise<SdioDailyPayload | null> {
  const { data, error } = await supabaseAdmin()
    .from("daily_raw_sdio")
    .select("payload")
    .eq("sport", sport)
    .eq("date",  date)
    .maybeSingle();
  if (error) throw new Error(`getSdioDailyRaw: ${error.message}`);
  return (data?.payload as SdioDailyPayload) ?? null;
}

export async function fetchAndStoreSdioDaily(
  sport: string,
  date:  string,
  opts?: { force?: boolean },
): Promise<SdioDailyPayload> {
  const existing = await getSdioDailyRaw(sport, date);
  const fresh = await fetchSdioDaily(date);

  // Preserve the original snapshot of standings + season player stats
  // unless force=true was requested. Everything else (games, box scores,
  // PBP, transactions, teams) is point-in-time-stable once the games
  // are complete, so it's safe to overwrite with the fresh fetch.
  //
  // nextDayGames is its own case: SDIO's GamesByDate sits on a different
  // tier than the "Final" endpoints and 401s intermittently. The fetcher
  // catches that and returns [], which would silently overwrite the
  // existing slate. Always fall back to the prior snapshot when fresh
  // came back empty — even on force=true — since "preserving working
  // data over a transient 401" beats "honest validation of nothing."
  const freshNd = Array.isArray(fresh.nextDayGames) ? fresh.nextDayGames as unknown[] : [];
  const nextDayGames =
    freshNd.length > 0                                                ? fresh.nextDayGames
    : (existing && Array.isArray(existing.nextDayGames) && (existing.nextDayGames as unknown[]).length > 0)
                                                                       ? existing.nextDayGames
    : fresh.nextDayGames;

  // Same intermittent-401 defense for startingLineups (also a /projections-
  // tier endpoint). Empty fresh + existing populated → keep the existing.
  const freshSl = Array.isArray(fresh.startingLineups) ? fresh.startingLineups as unknown[] : [];
  const startingLineups =
    freshSl.length > 0                                                ? fresh.startingLineups
    : (existing && Array.isArray(existing.startingLineups) && (existing.startingLineups as unknown[]).length > 0)
                                                                       ? existing.startingLineups
    : fresh.startingLineups;

  // Player roster snapshot — same defense. The injury-report path needs
  // this; falling back to a transient empty fetch would silently drop
  // all IL transactions for the day.
  const freshPl = Array.isArray(fresh.players) ? fresh.players as unknown[] : [];
  const players =
    freshPl.length > 0                                                ? fresh.players
    : (existing && Array.isArray(existing.players) && (existing.players as unknown[]).length > 0)
                                                                       ? existing.players
    : fresh.players;

  const payload: SdioDailyPayload = (existing && !opts?.force)
    ? {
        ...fresh,
        standings:   existing.standings   ?? fresh.standings,
        playerStats: existing.playerStats ?? fresh.playerStats,
        nextDayGames,
        startingLineups,
        players,
      }
    : { ...fresh, nextDayGames, startingLineups, players };

  const { error } = await supabaseAdmin()
    .from("daily_raw_sdio")
    .upsert({
      sport,
      date,
      payload,
      fetched_at: new Date().toISOString(),
    });
  if (error) throw new Error(`fetchAndStoreSdioDaily upsert: ${error.message}`);
  return payload;
}
