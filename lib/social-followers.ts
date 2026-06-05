// Twitter + Bluesky follower tracking for the /admin/followers dashboard.
// Two halves:
//
// 1. Live API fetchers — pull our followers (and who *we* follow) from each
//    platform. Both endpoints paginate; we walk every page with a safety cap.
// 2. Sync + read against social_followers (migration 0028). The page calls
//    syncIfStale() to refresh from APIs at most once per SYNC_TTL, then
//    reads from the DB so star/notes/we-follow persist and unfollowers don't
//    silently vanish — stale rows get removed_at set instead of being deleted.

import { TwitterApi } from "twitter-api-v2";
import { AtpAgent } from "@atproto/api";
import { supabaseAdmin } from "./supabase";

export type Platform = "twitter" | "bluesky";

export type Follower = {
  platform: Platform;
  handle: string;          // @-prefixed for Twitter, raw for Bluesky
  displayName: string;
  avatar: string | null;
  bio: string;
  profileUrl: string;
  weFollow: boolean;
  starred: boolean;
  notes: string;
  firstSeenAt: string;
  lastSeenAt: string;
  removedAt: string | null;
};

// Minimum gap between live-API syncs. Twitter rate limits are tight on the
// followers endpoint (~15 calls / 15 min on Basic), so 5 minutes keeps page
// refreshes safe while still letting an admin force-refresh after a small
// wait.
const SYNC_TTL_MS = 5 * 60 * 1000;

// ─── Live fetchers: followers ───────────────────────────────────────────────

function twitterClient(): TwitterApi {
  return new TwitterApi({
    appKey: process.env.TWITTER_API_KEY!,
    appSecret: process.env.TWITTER_API_SECRET!,
    accessToken: process.env.TWITTER_ACCESS_TOKEN!,
    accessSecret: process.env.TWITTER_ACCESS_SECRET!,
  });
}

type RawFollower = {
  handle: string;
  displayName: string;
  avatar: string | null;
  bio: string;
  profileUrl: string;
};

async function fetchTwitterFollowers(): Promise<RawFollower[]> {
  const c = twitterClient();
  const me = await c.v2.me();
  const paginator = await c.v2.followers(me.data.id, {
    asPaginator: true,
    max_results: 1000,
    "user.fields": ["description", "profile_image_url", "name"],
  });
  let safety = 50;
  while (!paginator.done && safety > 0) {
    await paginator.fetchNext();
    safety -= 1;
  }
  return paginator.users.map((u) => ({
    handle: `@${u.username}`,
    displayName: u.name ?? u.username,
    // Default avatar URL is _normal (48×48); swap to _bigger (73×73) for retina.
    avatar: u.profile_image_url
      ? u.profile_image_url.replace("_normal", "_bigger")
      : null,
    bio: u.description ?? "",
    profileUrl: `https://twitter.com/${u.username}`,
  }));
}

// Returns the set of @-prefixed handles we follow on Twitter — used to mark
// `we_follow` on the matching follower rows.
async function fetchTwitterFollowing(): Promise<Set<string>> {
  const c = twitterClient();
  const me = await c.v2.me();
  const paginator = await c.v2.following(me.data.id, {
    asPaginator: true,
    max_results: 1000,
  });
  let safety = 50;
  while (!paginator.done && safety > 0) {
    await paginator.fetchNext();
    safety -= 1;
  }
  return new Set(paginator.users.map((u) => `@${u.username}`));
}

async function blueskyAgent(): Promise<AtpAgent> {
  const agent = new AtpAgent({ service: "https://bsky.social" });
  await agent.login({
    identifier: process.env.BLUESKY_HANDLE!,
    password: process.env.BLUESKY_APP_PASSWORD!,
  });
  return agent;
}

type BskyProfileView = {
  did: string;
  handle: string;
  displayName?: string;
  description?: string;
  avatar?: string;
};

async function fetchBlueskyFollowers(): Promise<RawFollower[]> {
  const agent = await blueskyAgent();
  const actor = process.env.BLUESKY_HANDLE!;
  const out: RawFollower[] = [];
  let cursor: string | undefined;
  let safety = 50;
  do {
    const res = await agent.app.bsky.graph.getFollowers({
      actor, limit: 100, cursor,
    });
    for (const f of (res.data.followers ?? []) as BskyProfileView[]) {
      out.push({
        handle: f.handle,
        displayName: f.displayName ?? f.handle,
        avatar: f.avatar ?? null,
        bio: f.description ?? "",
        profileUrl: `https://bsky.app/profile/${f.handle}`,
      });
    }
    cursor = res.data.cursor;
    safety -= 1;
  } while (cursor && safety > 0);
  return out;
}

async function fetchBlueskyFollowing(): Promise<Set<string>> {
  const agent = await blueskyAgent();
  const actor = process.env.BLUESKY_HANDLE!;
  const out = new Set<string>();
  let cursor: string | undefined;
  let safety = 50;
  do {
    const res = await agent.app.bsky.graph.getFollows({
      actor, limit: 100, cursor,
    });
    for (const f of (res.data.follows ?? []) as BskyProfileView[]) {
      out.add(f.handle);
    }
    cursor = res.data.cursor;
    safety -= 1;
  } while (cursor && safety > 0);
  return out;
}

// ─── Sync ───────────────────────────────────────────────────────────────────

type SyncRow = {
  platform: Platform;
  synced_at: string;
  follower_n: number;
  error: string | null;
};

export async function getLastSyncs(): Promise<Partial<Record<Platform, SyncRow>>> {
  const { data, error } = await supabaseAdmin()
    .from("social_followers_syncs")
    .select("platform, synced_at, follower_n, error");
  if (error) throw new Error(`getLastSyncs: ${error.message}`);
  const out: Partial<Record<Platform, SyncRow>> = {};
  for (const r of (data ?? []) as SyncRow[]) out[r.platform] = r;
  return out;
}

async function syncPlatform(
  platform: Platform,
  followers: RawFollower[],
  following: Set<string>,
  syncStartIso: string,
): Promise<void> {
  const db = supabaseAdmin();

  // Upsert every observed follower. last_seen_at = syncStartIso so we can
  // later detect un-followers (rows still showing the previous sync's
  // timestamp). removed_at is cleared in case they previously dropped off
  // and then re-followed.
  if (followers.length > 0) {
    const rows = followers.map((f) => ({
      platform,
      handle: f.handle,
      display_name: f.displayName,
      avatar_url: f.avatar,
      bio: f.bio,
      profile_url: f.profileUrl,
      we_follow: following.has(f.handle),
      last_seen_at: syncStartIso,
      removed_at: null,
    }));
    // Supabase upsert defaults to a single statement but we chunk to stay
    // well under any payload limit — 500 fits comfortably.
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error } = await db
        .from("social_followers")
        .upsert(chunk, { onConflict: "platform,handle" });
      if (error) throw new Error(`upsert ${platform}: ${error.message}`);
    }
  }

  // Mark stale rows as removed. Anything on this platform with
  // last_seen_at < syncStartIso wasn't returned by this sync, so they've
  // unfollowed (or the API hiccuped — soft delete keeps the row + history).
  const { error: removeErr } = await db
    .from("social_followers")
    .update({ removed_at: syncStartIso })
    .eq("platform", platform)
    .lt("last_seen_at", syncStartIso)
    .is("removed_at", null);
  if (removeErr) throw new Error(`mark removed ${platform}: ${removeErr.message}`);

  // Record success in the sync log.
  const { error: logErr } = await db
    .from("social_followers_syncs")
    .upsert({
      platform,
      synced_at: syncStartIso,
      follower_n: followers.length,
      error: null,
    });
  if (logErr) throw new Error(`log sync ${platform}: ${logErr.message}`);
}

async function recordSyncError(platform: Platform, msg: string): Promise<void> {
  await supabaseAdmin()
    .from("social_followers_syncs")
    .upsert({
      platform,
      synced_at: new Date().toISOString(),
      follower_n: 0,
      error: msg,
    });
}

export type SyncResult = {
  errors: Partial<Record<Platform, string>>;
  counts: Partial<Record<Platform, number>>;
};

// Full sync: pull followers + following for both platforms in parallel,
// reconcile against the DB. Each platform is independent — one provider
// failing doesn't block the other.
export async function syncAllFollowers(): Promise<SyncResult> {
  const syncStartIso = new Date().toISOString();
  const errors: Partial<Record<Platform, string>> = {};
  const counts: Partial<Record<Platform, number>> = {};

  const [twResult, bsResult] = await Promise.allSettled([
    (async () => {
      const [followers, following] = await Promise.all([
        fetchTwitterFollowers(),
        fetchTwitterFollowing(),
      ]);
      await syncPlatform("twitter", followers, following, syncStartIso);
      return followers.length;
    })(),
    (async () => {
      const [followers, following] = await Promise.all([
        fetchBlueskyFollowers(),
        fetchBlueskyFollowing(),
      ]);
      await syncPlatform("bluesky", followers, following, syncStartIso);
      return followers.length;
    })(),
  ]);

  if (twResult.status === "fulfilled") counts.twitter = twResult.value;
  else {
    errors.twitter = (twResult.reason as Error).message;
    await recordSyncError("twitter", errors.twitter);
  }
  if (bsResult.status === "fulfilled") counts.bluesky = bsResult.value;
  else {
    errors.bluesky = (bsResult.reason as Error).message;
    await recordSyncError("bluesky", errors.bluesky);
  }
  return { errors, counts };
}

// Sync only if the latest successful run for either platform is older than
// SYNC_TTL_MS. Returns the errors from the sync (empty if skipped or
// completely successful). The page calls this on every render so a quick
// reload doesn't burn API quota, but a 5-min-old view triggers a refresh.
export async function syncIfStale(): Promise<SyncResult> {
  const last = await getLastSyncs();
  const now = Date.now();
  const stale = (platform: Platform): boolean => {
    const row = last[platform];
    if (!row) return true;
    if (row.error) return true;
    return now - new Date(row.synced_at).getTime() > SYNC_TTL_MS;
  };
  if (!stale("twitter") && !stale("bluesky")) {
    return { errors: {}, counts: {} };
  }
  return syncAllFollowers();
}

// ─── Read ───────────────────────────────────────────────────────────────────

export type FollowerFilter = {
  platform?: Platform;
  starred?: boolean;
  // they-follow-us-but-we-don't — the "who should I follow back?" view
  unreciprocated?: boolean;
  // include rows where the most recent sync didn't see them (unfollowers)
  includeRemoved?: boolean;
};

type DbRow = {
  platform: Platform;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  bio: string;
  profile_url: string;
  we_follow: boolean;
  starred: boolean;
  notes: string;
  first_seen_at: string;
  last_seen_at: string;
  removed_at: string | null;
};

function rowToFollower(r: DbRow): Follower {
  return {
    platform: r.platform,
    handle: r.handle,
    displayName: r.display_name,
    avatar: r.avatar_url,
    bio: r.bio,
    profileUrl: r.profile_url,
    weFollow: r.we_follow,
    starred: r.starred,
    notes: r.notes,
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
    removedAt: r.removed_at,
  };
}

// Read followers from the DB. Paginates manually to avoid the silent 1000-row
// cap that has burned us before (see [[feedback_supabase_1000_row_cap]]).
export async function getStoredFollowers(
  filter: FollowerFilter = {},
): Promise<Follower[]> {
  const db = supabaseAdmin();
  const PAGE = 1000;
  const out: Follower[] = [];
  let from = 0;
  for (;;) {
    let q = db
      .from("social_followers")
      .select("platform, handle, display_name, avatar_url, bio, profile_url, we_follow, starred, notes, first_seen_at, last_seen_at, removed_at")
      .order("display_name", { ascending: true })
      .range(from, from + PAGE - 1);
    if (filter.platform) q = q.eq("platform", filter.platform);
    if (filter.starred) q = q.eq("starred", true);
    if (filter.unreciprocated) q = q.eq("we_follow", false);
    if (!filter.includeRemoved) q = q.is("removed_at", null);
    const { data, error } = await q;
    if (error) throw new Error(`getStoredFollowers: ${error.message}`);
    const rows = (data ?? []) as DbRow[];
    out.push(...rows.map(rowToFollower));
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

// ─── Mutations (called from admin server actions) ───────────────────────────

export async function setFollowerStarred(
  platform: Platform,
  handle: string,
  starred: boolean,
): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("social_followers")
    .update({ starred })
    .eq("platform", platform)
    .eq("handle", handle);
  if (error) throw new Error(`setFollowerStarred: ${error.message}`);
}

export async function setFollowerNotes(
  platform: Platform,
  handle: string,
  notes: string,
): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("social_followers")
    .update({ notes })
    .eq("platform", platform)
    .eq("handle", handle);
  if (error) throw new Error(`setFollowerNotes: ${error.message}`);
}
