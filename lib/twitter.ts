import { EUploadMimeType, TwitterApi } from "twitter-api-v2";

// Social-account resolution. Every sport posts to its dedicated profile AND
// mirrors to the shared main account (@boxscoreemail — the base TWITTER_* vars),
// so the main feed carries every sport while each per-sport channel carries only
// its own. MLB IS the main account (its creds are the unsuffixed base vars).
// Other sports read _<SPORT>-suffixed vars (TWITTER_API_KEY_NFL, ...) for their
// dedicated account; a sport with no suffixed creds posts to the main account
// ONLY (see issue #152 for the dedicated accounts still to be created).

type TwitterCreds = {
  appKey: string;
  appSecret: string;
  accessToken: string;
  accessSecret: string;
  handle: string;
};

// A resolved account to post to, plus the sub_id suffix that keeps each
// account's social_posts dedup rows distinct. The primary account for a sport
// uses "" (bare sub_id) to preserve existing post history; a mirror gets
// "#handle" so it dedups independently.
export type TwitterTarget = TwitterCreds & { subIdSuffix: string };

function readCreds(suffix: string, defaultHandle: string): TwitterCreds | null {
  const appKey = process.env[`TWITTER_API_KEY${suffix}`];
  const appSecret = process.env[`TWITTER_API_SECRET${suffix}`];
  const accessToken = process.env[`TWITTER_ACCESS_TOKEN${suffix}`];
  const accessSecret = process.env[`TWITTER_ACCESS_SECRET${suffix}`];
  if (!appKey || !appSecret || !accessToken || !accessSecret) return null;
  // Handle only shapes the post URL, so it isn't required for "configured".
  const handle = process.env[`TWITTER_HANDLE${suffix}`] ?? defaultHandle;
  return { appKey, appSecret, accessToken, accessSecret, handle };
}

function baseCreds(): TwitterCreds | null {
  return readCreds("", "boxscoreemail");
}

function ownCreds(sport: string): TwitterCreds | null {
  return readCreds(`_${sport.toUpperCase()}`, "");
}

/**
 * The X/Twitter account(s) a sport posts to, in priority order. MLB's account
 * IS the shared main account, so it resolves to a single target. Every other
 * sport keeps its dedicated account primary (bare sub_id, preserving history)
 * and mirrors to the main account; a sport with no dedicated account (creds not
 * set yet — see #152) posts to the main account only.
 */
export function twitterTargetsForSport(sport: string): TwitterTarget[] {
  const candidates: TwitterCreds[] = [];
  if (sport === "mlb") {
    const base = baseCreds();
    if (base) candidates.push(base);
  } else {
    const own = ownCreds(sport);
    if (own) candidates.push(own);
    const base = baseCreds();
    if (base) candidates.push(base);
  }
  // Dedupe by access token in case a sport's suffixed creds point at the base.
  const seen = new Set<string>();
  const unique = candidates.filter((c) =>
    seen.has(c.accessToken) ? false : (seen.add(c.accessToken), true),
  );
  return unique.map((c, i) => ({
    ...c,
    subIdSuffix: i === 0 ? "" : `#${c.handle || "main"}`,
  }));
}

/**
 * Whether any X/Twitter account is set up for this sport. Crons call this to
 * skip a league before rendering images. With the main-account mirror this is
 * true for every sport whenever the base creds are set.
 */
export function twitterAccountConfigured(sport: string): boolean {
  return twitterTargetsForSport(sport).length > 0;
}

// Clients are cached per account (keyed by access token), since one sport now
// fans out to multiple accounts and several sports share the base account.
const clients = new Map<string, TwitterApi>();

function clientFor(creds: TwitterCreds): TwitterApi {
  const existing = clients.get(creds.accessToken);
  if (existing) return existing;
  const c = new TwitterApi({
    appKey: creds.appKey,
    appSecret: creds.appSecret,
    accessToken: creds.accessToken,
    accessSecret: creds.accessSecret,
  });
  clients.set(creds.accessToken, c);
  return c;
}

function wrapError(err: unknown): Error {
  const e = err as {
    code?: number;
    data?: unknown;
    errors?: Array<{ message?: string; code?: number }>;
    message?: string;
  };
  return new Error(
    `twitter: ${JSON.stringify({
      status: e.code,
      twitterErrors: e.errors,
      twitterData: e.data,
      message: e.message,
    })}`,
  );
}

function tweetUrl(handle: string, id: string): string {
  return `https://twitter.com/${handle || "boxscoreemail"}/status/${id}`;
}

export async function postTweetWithImage(args: {
  text: string;
  altText: string;
  imageBytes: Uint8Array;
  mimeType?: EUploadMimeType;
  target: TwitterTarget;
}): Promise<{ id: string; url: string }> {
  try {
    const c = clientFor(args.target);
    const buf = Buffer.from(args.imageBytes);
    const mediaId = await c.v2.uploadMedia(buf, {
      media_type: args.mimeType ?? EUploadMimeType.Png,
    });
    // Alt text shouldn't block the post if it fails (e.g., transient v1 issue).
    try {
      await c.v1.createMediaMetadata(mediaId, {
        alt_text: { text: args.altText.slice(0, 1000) },
      });
    } catch {
      // swallow — accessibility is best-effort
    }
    const res = await c.v2.tweet(args.text, {
      media: { media_ids: [mediaId] },
    });
    if (!res.data?.id) {
      throw new Error(`twitter: no id returned (${JSON.stringify(res)})`);
    }
    return { id: res.data.id, url: tweetUrl(args.target.handle, res.data.id) };
  } catch (err) {
    throw wrapError(err);
  }
}

export async function deleteTweet(target: TwitterTarget, id: string): Promise<void> {
  try {
    await clientFor(target).v2.deleteTweet(id);
  } catch (err) {
    throw wrapError(err);
  }
}
