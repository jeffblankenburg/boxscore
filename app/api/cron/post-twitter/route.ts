import { NextResponse } from "next/server";
import { getDigest } from "@/lib/digests";
import { isValidIsoDate, prettyDate, yesterdayInET } from "@/lib/dates";
import { hasAlreadyPosted, recordPost } from "@/lib/social-posts";
import { postTweet } from "@/lib/twitter";
import { tweetText } from "@/lib/social-content";
import { siteOrigin } from "@/lib/site";

export const runtime = "nodejs";
export const maxDuration = 30;

function isAuthorized(req: Request): boolean {
  if (process.env.NODE_ENV === "development") return true;
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const date = url.searchParams.get("date") ?? yesterdayInET();
  const sport = url.searchParams.get("sport") ?? "mlb";
  if (!isValidIsoDate(date)) {
    return NextResponse.json({ error: "invalid date" }, { status: 400 });
  }

  if (await hasAlreadyPosted("twitter", sport, date)) {
    return NextResponse.json({ ok: true, skipped: true, reason: "already_posted" });
  }

  const digest = await getDigest(sport, date);
  if (!digest) {
    return NextResponse.json({ error: "no digest" }, { status: 404 });
  }

  const origin = await siteOrigin();
  const digestUrl = `${origin}/${sport}/${date}`;
  const text = tweetText({
    sport, date,
    prettyDate: prettyDate(date),
    gameCount: digest.game_count,
    digestUrl,
  });

  try {
    const { id, url: tweetUrl } = await postTweet(text);
    await recordPost({
      platform: "twitter", sport, date,
      remoteId: id, remoteUrl: tweetUrl, error: null,
    });
    return NextResponse.json({ ok: true, posted: true, id, url: tweetUrl });
  } catch (err) {
    const msg = (err as Error).message;
    await recordPost({
      platform: "twitter", sport, date,
      remoteId: null, remoteUrl: null, error: msg,
    });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
