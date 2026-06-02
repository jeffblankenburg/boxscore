import { TwitterApi } from "twitter-api-v2";
async function main() {
  const c = new TwitterApi({
    appKey: process.env.TWITTER_API_KEY!,
    appSecret: process.env.TWITTER_API_SECRET!,
    accessToken: process.env.TWITTER_ACCESS_TOKEN!,
    accessSecret: process.env.TWITTER_ACCESS_SECRET!,
  });
  const me = await c.v2.me({ "user.fields": ["public_metrics"] });
  const m = me.data as { public_metrics?: { followers_count?: number } };
  console.log("me:", me.data.username, "id:", me.data.id, "followers_count:", m.public_metrics?.followers_count);
  try {
    const followers = await c.v2.followers(me.data.id, { max_results: 5, "user.fields": ["description", "profile_image_url", "name"] });
    console.log("FOLLOWERS OK — first page size:", followers.data?.length);
    for (const u of followers.data ?? []) console.log(`  @${u.username}  ${u.name}  bio="${(u.description ?? "").slice(0, 60)}"`);
  } catch (e) {
    const err = e as { code?: number; data?: unknown; message?: string };
    console.log("FOLLOWERS FAIL code=", err.code, "msg=", err.message);
    console.log("data:", JSON.stringify(err.data));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
export {};
