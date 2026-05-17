import { EUploadMimeType, TwitterApi } from "twitter-api-v2";

let cached: TwitterApi | null = null;

function client(): TwitterApi {
  if (cached) return cached;
  const appKey = process.env.TWITTER_API_KEY;
  const appSecret = process.env.TWITTER_API_SECRET;
  const accessToken = process.env.TWITTER_ACCESS_TOKEN;
  const accessSecret = process.env.TWITTER_ACCESS_SECRET;
  if (!appKey || !appSecret || !accessToken || !accessSecret) {
    throw new Error(
      "Twitter credentials missing: set TWITTER_API_KEY, TWITTER_API_SECRET, " +
      "TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET.",
    );
  }
  cached = new TwitterApi({ appKey, appSecret, accessToken, accessSecret });
  return cached;
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

function tweetUrl(id: string): string {
  const handle = process.env.TWITTER_HANDLE ?? "boxscoreemail";
  return `https://twitter.com/${handle}/status/${id}`;
}

export async function postTweetWithImage(args: {
  text: string;
  altText: string;
  imageBytes: Uint8Array;
  mimeType?: EUploadMimeType;
}): Promise<{ id: string; url: string }> {
  try {
    const c = client();
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
    return { id: res.data.id, url: tweetUrl(res.data.id) };
  } catch (err) {
    throw wrapError(err);
  }
}

export async function deleteTweet(id: string): Promise<void> {
  try {
    await client().v2.deleteTweet(id);
  } catch (err) {
    throw wrapError(err);
  }
}
