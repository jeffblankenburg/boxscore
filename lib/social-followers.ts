// Fetches the boxscore accounts' followers from Twitter and Bluesky for the
// /admin/followers dashboard. Both providers return paginated lists; we walk
// every page so the dashboard sees the complete set. Twitter uses the v2
// followers endpoint (requires Basic+ tier — already verified working on
// the OAuth1.0a creds in .env.local). Bluesky uses app.bsky.graph.getFollowers
// over the existing AT Protocol agent.

import { TwitterApi } from "twitter-api-v2";
import { AtpAgent } from "@atproto/api";

export type Platform = "twitter" | "bluesky";

export type Follower = {
  platform: Platform;
  handle: string;          // @-prefixed for Twitter, raw for Bluesky
  displayName: string;
  avatar: string | null;
  bio: string;
  profileUrl: string;
};

// ─── Twitter ────────────────────────────────────────────────────────────────
// twitter-api-v2's followers() returns a paginator; we fetchNext() until
// `done` flips. Cap iterations as a safety belt against runaway loops if
// the API misbehaves.

function twitterClient(): TwitterApi {
  return new TwitterApi({
    appKey: process.env.TWITTER_API_KEY!,
    appSecret: process.env.TWITTER_API_SECRET!,
    accessToken: process.env.TWITTER_ACCESS_TOKEN!,
    accessSecret: process.env.TWITTER_ACCESS_SECRET!,
  });
}

export async function getTwitterFollowers(): Promise<Follower[]> {
  const c = twitterClient();
  const me = await c.v2.me();
  // asPaginator: true is required to get the paginator wrapper with .done
  // / .fetchNext() / .users. The no-paginator overload returns just one
  // raw page.
  const paginator = await c.v2.followers(me.data.id, {
    asPaginator: true,
    max_results: 1000,
    "user.fields": ["description", "profile_image_url", "name"],
  });
  // Walk every page, then read the accumulated users array. Safety cap
  // guards against runaway loops if .done ever lies.
  let safety = 50;
  while (!paginator.done && safety > 0) {
    await paginator.fetchNext();
    safety -= 1;
  }
  return paginator.users.map((u) => ({
    platform: "twitter",
    handle: `@${u.username}`,
    displayName: u.name ?? u.username,
    // The default avatar URL is the _normal (48×48) variant; swap to
    // _bigger (73×73) so retina screens look sharp.
    avatar: u.profile_image_url
      ? u.profile_image_url.replace("_normal", "_bigger")
      : null,
    bio: u.description ?? "",
    profileUrl: `https://twitter.com/${u.username}`,
  }));
}

// ─── Bluesky ────────────────────────────────────────────────────────────────
// AT Protocol's getFollowers takes 100 records at a time and returns a cursor
// for the next page. Walk until the cursor is missing.

async function blueskyAgent(): Promise<AtpAgent> {
  const handle = process.env.BLUESKY_HANDLE!;
  const password = process.env.BLUESKY_APP_PASSWORD!;
  const agent = new AtpAgent({ service: "https://bsky.social" });
  await agent.login({ identifier: handle, password });
  return agent;
}

type BskyProfileView = {
  did: string;
  handle: string;
  displayName?: string;
  description?: string;
  avatar?: string;
};

export async function getBlueskyFollowers(): Promise<Follower[]> {
  const agent = await blueskyAgent();
  const actor = process.env.BLUESKY_HANDLE!;
  const out: Follower[] = [];
  let cursor: string | undefined;
  let safety = 50;
  do {
    const res = await agent.app.bsky.graph.getFollowers({
      actor, limit: 100, cursor,
    });
    for (const f of (res.data.followers ?? []) as BskyProfileView[]) {
      out.push({
        platform: "bluesky",
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

// ─── Combined ───────────────────────────────────────────────────────────────
// One call for the admin page. Fires both providers in parallel; if one
// throws, returns the platform's error string in the result so the UI can
// surface it instead of failing the whole page.

export type FollowersResult = {
  followers: Follower[];
  errors: Partial<Record<Platform, string>>;
};

export async function getAllFollowers(): Promise<FollowersResult> {
  const errors: Partial<Record<Platform, string>> = {};
  const [tw, bs] = await Promise.allSettled([
    getTwitterFollowers(),
    getBlueskyFollowers(),
  ]);
  const followers: Follower[] = [];
  if (tw.status === "fulfilled") followers.push(...tw.value);
  else errors.twitter = (tw.reason as Error).message;
  if (bs.status === "fulfilled") followers.push(...bs.value);
  else errors.bluesky = (bs.reason as Error).message;
  return { followers, errors };
}
