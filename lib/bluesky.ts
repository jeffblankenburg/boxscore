import { AtpAgent, RichText } from "@atproto/api";

// BlueSky posting client. Session-based auth: we login fresh on each post
// (cheap, ~100ms; avoids storing a session). RichText auto-detects URLs and
// hashtags and converts them into clickable "facets" — required so they
// render as links/tags rather than gray text.
//
// Per-league accounts: most leagues post to a single dedicated
// <sport>.boxscore.email profile via _<SPORT>-suffixed env vars
// (BLUESKY_HANDLE_NFL / BLUESKY_APP_PASSWORD_NFL, ...). A sport with no
// suffixed creds (or a blank password) is "not configured" and the caller skips
// it, so we never leak a league's posts onto another account. MLB is the one
// exception — see blueskyTargetsForSport.

type Agent = InstanceType<typeof AtpAgent>;

export type BlueskyTarget = {
  handle: string;
  password: string;
  // Appended to the image's sub_id so each account gets its own social_posts
  // dedup row. The first target for a sport uses "" (bare sub_id) to keep
  // existing post history valid; additional mirrors qualify by handle.
  subIdSuffix: string;
};

type BlueskyCreds = { handle: string; password: string };

function baseCreds(): BlueskyCreds | null {
  const handle = process.env.BLUESKY_HANDLE;
  const password = process.env.BLUESKY_APP_PASSWORD;
  if (!handle || !password) return null;
  return { handle, password };
}

function suffixedCreds(sport: string): BlueskyCreds | null {
  const s = `_${sport.toUpperCase()}`;
  const handle = process.env[`BLUESKY_HANDLE${s}`];
  const password = process.env[`BLUESKY_APP_PASSWORD${s}`];
  if (!handle || !password) return null;
  return { handle, password };
}

/**
 * The Bluesky account(s) a sport posts to, in priority order. Every sport posts
 * to its dedicated <sport>.boxscore.email account AND mirrors to the shared main
 * account (BLUESKY_HANDLE / boxscore.email), so the main feed carries every
 * sport while each per-sport channel carries only its own. The primary target
 * keeps the bare sub_id to preserve post history; the mirror gets "#handle".
 * MLB began on the shared account, so there the shared account stays primary
 * and the dedicated mlb handle is the mirror. Sports with no dedicated handle
 * (ncaam/ncaaw) post to the main account only.
 */
export function blueskyTargetsForSport(sport: string): BlueskyTarget[] {
  const base = baseCreds();
  const own = suffixedCreds(sport);
  const candidates: BlueskyCreds[] = [];
  if (sport === "mlb") {
    if (base) candidates.push(base);
    if (own) candidates.push(own);
  } else {
    if (own) candidates.push(own);
    if (base) candidates.push(base);
  }
  // Dedupe by handle in case base and own point at the same account.
  const seen = new Set<string>();
  const unique = candidates.filter((c) =>
    seen.has(c.handle) ? false : (seen.add(c.handle), true),
  );
  return unique.map((c, i) => ({
    ...c,
    subIdSuffix: i === 0 ? "" : `#${c.handle}`,
  }));
}

/**
 * Whether any Bluesky account is set up for this sport. Crons call this to skip
 * a league before rendering images when its profile isn't wired yet.
 */
export function blueskyAccountConfigured(sport: string): boolean {
  return blueskyTargetsForSport(sport).length > 0;
}

async function loginWith(creds: BlueskyCreds): Promise<Agent> {
  const agent = new AtpAgent({ service: "https://bsky.social" });
  await agent.login({ identifier: creds.handle, password: creds.password });
  return agent;
}

function postUrl(handle: string, uri: string): string {
  const rkey = uri.split("/").pop();
  return `https://bsky.app/profile/${handle}/post/${rkey}`;
}

export async function postToBlueskyWithImage(args: {
  target: BlueskyCreds;
  text: string;
  imageBytes: Uint8Array;
  imageMime?: string;
  altText: string;
  aspectRatio?: { width: number; height: number };
}): Promise<{ uri: string; url: string }> {
  const agent = await loginWith(args.target);
  const blob = await agent.uploadBlob(args.imageBytes, {
    encoding: args.imageMime ?? "image/png",
  });
  const rt = new RichText({ text: args.text });
  await rt.detectFacets(agent);
  const image: {
    image: typeof blob.data.blob;
    alt: string;
    aspectRatio?: { width: number; height: number };
  } = { image: blob.data.blob, alt: args.altText };
  if (args.aspectRatio) image.aspectRatio = args.aspectRatio;
  const result = await agent.post({
    text: rt.text,
    facets: rt.facets,
    embed: {
      $type: "app.bsky.embed.images",
      images: [image],
    },
    createdAt: new Date().toISOString(),
  });
  return { uri: result.uri, url: postUrl(args.target.handle, result.uri) };
}

/**
 * Delete a post by its AT URI, using the credentials of the account that owns
 * it. Used by the cron route's ?reset=1 flow to clean up prior posts before
 * re-posting (helpful during testing).
 */
export async function deleteBlueskyPost(target: BlueskyCreds, uri: string): Promise<void> {
  const agent = await loginWith(target);
  await agent.deletePost(uri);
}
