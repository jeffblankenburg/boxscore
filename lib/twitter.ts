import { EUploadMimeType, TwitterApi } from "twitter-api-v2";

// Per-league credential resolution. MLB owns the shared/base account
// (TWITTER_API_KEY etc.) — its posts are unchanged. Every other sport posts to
// its own profile via _<SPORT>-suffixed vars (TWITTER_API_KEY_NFL, ...). If a
// sport has no suffixed creds it is treated as "not configured" and the caller
// skips it — we never leak a league's posts onto the shared MLB account.

type TwitterCreds = {
  appKey: string;
  appSecret: string;
  accessToken: string;
  accessSecret: string;
  handle: string;
};

function envSuffix(sport: string): string {
  return sport === "mlb" ? "" : `_${sport.toUpperCase()}`;
}

function credsForSport(sport: string): TwitterCreds | null {
  const s = envSuffix(sport);
  const appKey = process.env[`TWITTER_API_KEY${s}`];
  const appSecret = process.env[`TWITTER_API_SECRET${s}`];
  const accessToken = process.env[`TWITTER_ACCESS_TOKEN${s}`];
  const accessSecret = process.env[`TWITTER_ACCESS_SECRET${s}`];
  if (!appKey || !appSecret || !accessToken || !accessSecret) return null;
  // Handle only shapes the post URL, so it isn't required for "configured".
  const handle =
    process.env[`TWITTER_HANDLE${s}`] ?? (sport === "mlb" ? "boxscoreemail" : "");
  return { appKey, appSecret, accessToken, accessSecret, handle };
}

/**
 * Whether an X/Twitter account is set up for this sport. Crons call this to
 * skip a league before rendering images when its profile isn't wired yet.
 */
export function twitterAccountConfigured(sport: string): boolean {
  return credsForSport(sport) !== null;
}

const clients = new Map<string, TwitterApi>();

function client(sport: string): TwitterApi {
  const existing = clients.get(sport);
  if (existing) return existing;
  const creds = credsForSport(sport);
  if (!creds) {
    const s = envSuffix(sport);
    throw new Error(
      `Twitter credentials missing for sport "${sport}": set TWITTER_API_KEY${s}, ` +
      `TWITTER_API_SECRET${s}, TWITTER_ACCESS_TOKEN${s}, TWITTER_ACCESS_SECRET${s}.`,
    );
  }
  const c = new TwitterApi({
    appKey: creds.appKey,
    appSecret: creds.appSecret,
    accessToken: creds.accessToken,
    accessSecret: creds.accessSecret,
  });
  clients.set(sport, c);
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

function tweetUrl(sport: string, id: string): string {
  const handle = credsForSport(sport)?.handle || "boxscoreemail";
  return `https://twitter.com/${handle}/status/${id}`;
}

export async function postTweetWithImage(args: {
  text: string;
  altText: string;
  imageBytes: Uint8Array;
  mimeType?: EUploadMimeType;
  sport: string;
}): Promise<{ id: string; url: string }> {
  try {
    const c = client(args.sport);
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
    return { id: res.data.id, url: tweetUrl(args.sport, res.data.id) };
  } catch (err) {
    throw wrapError(err);
  }
}

export async function deleteTweet(sport: string, id: string): Promise<void> {
  try {
    await client(sport).v2.deleteTweet(id);
  } catch (err) {
    throw wrapError(err);
  }
}
