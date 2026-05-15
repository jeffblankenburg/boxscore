import { TwitterApi } from "twitter-api-v2";

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

export async function postTweet(text: string): Promise<{ id: string; url: string }> {
  const res = await client().v2.tweet(text);
  if (!res.data?.id) {
    throw new Error(`twitter: no id returned (${JSON.stringify(res)})`);
  }
  // Use the project's own handle from env, falling back to the @boxscoreemail
  // placeholder. The post URL works regardless once Twitter rewrites it.
  const handle = process.env.TWITTER_HANDLE ?? "boxscoreemail";
  return { id: res.data.id, url: `https://twitter.com/${handle}/status/${res.data.id}` };
}
