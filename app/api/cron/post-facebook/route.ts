import { NextResponse } from "next/server";
import { isValidIsoDate, nextDay, prettyDate, yesterdayInET } from "@/lib/dates";
import { hasAlreadyPosted, recordPost } from "@/lib/social-posts";
import {
  deleteFacebookPost,
  publishAlbum,
  uploadUnpublishedPhoto,
} from "@/lib/facebook";
import { siteOrigin } from "@/lib/site";
import { supabaseAdmin } from "@/lib/supabase";
import { renderShareImages } from "@/lib/render-images";
import { uploadShareImages } from "@/lib/share-storage";

export const runtime = "nodejs";
export const maxDuration = 120;

const PLATFORM = "facebook" as const;
// Single sub_id for the album — there's only one FB post per day, unlike
// BlueSky/Twitter which post one per image.
const ALBUM_SUB_ID = "album";

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
  const reset = url.searchParams.get("reset") === "1";
  if (!isValidIsoDate(date)) {
    return NextResponse.json({ error: "invalid date" }, { status: 400 });
  }

  if (reset) {
    const { data: prior, error: priorErr } = await supabaseAdmin()
      .from("social_posts")
      .select("remote_id")
      .eq("platform", PLATFORM)
      .eq("sport", sport)
      .eq("date", date);
    if (priorErr) {
      return NextResponse.json({ error: `reset query: ${priorErr.message}` }, { status: 500 });
    }
    for (const row of prior ?? []) {
      if (row.remote_id) {
        try { await deleteFacebookPost(row.remote_id); } catch { /* gone */ }
      }
    }
    const { error: delErr } = await supabaseAdmin()
      .from("social_posts")
      .delete()
      .eq("platform", PLATFORM)
      .eq("sport", sport)
      .eq("date", date);
    if (delErr) {
      return NextResponse.json({ error: `reset delete: ${delErr.message}` }, { status: 500 });
    }
  }

  if (await hasAlreadyPosted(PLATFORM, sport, date, ALBUM_SUB_ID)) {
    return NextResponse.json({
      ok: true, sport, date,
      skipped: true,
      note: "Album already posted for this date.",
    });
  }

  const origin = await siteOrigin();
  // Public URL uses edition_date (games_date + 1).
  const digestUrl = `${origin}/${sport}/${nextDay(date)}`;
  const pretty = prettyDate(date);

  // Render share images in-memory using the same renderer as the other crons.
  let images: Awaited<ReturnType<typeof renderShareImages>>;
  try {
    images = await renderShareImages({ date, baseUrl: origin });
  } catch (err) {
    return NextResponse.json(
      { error: `render failed: ${(err as Error).message}` },
      { status: 500 },
    );
  }

  // Upload to storage so we have public URLs FB Graph can fetch by URL.
  let stored: Awaited<ReturnType<typeof uploadShareImages>>;
  try {
    stored = await uploadShareImages({ date, prettyDate: pretty, images });
  } catch (err) {
    return NextResponse.json(
      { error: `share-storage upload failed: ${(err as Error).message}` },
      { status: 500 },
    );
  }

  const boxscoreCount = stored.entries.filter((e) => e.entry.type === "boxscore").length;
  const message =
    `MLB box scores · ${pretty}\n` +
    `${boxscoreCount} games. Standings, leaders, and every line score.\n\n` +
    `Full digest → ${digestUrl}`;

  try {
    // Stage 1: upload every image as unpublished, collecting media_fbids.
    const mediaFbids: string[] = [];
    for (const img of stored.entries) {
      const id = await uploadUnpublishedPhoto(img.url);
      mediaFbids.push(id);
    }

    // Stage 2: publish the album post that bundles them.
    const { postId, url: postUrl } = await publishAlbum({ message, mediaFbids });
    await recordPost({
      platform: PLATFORM, sport, date, subId: ALBUM_SUB_ID,
      remoteId: postId, remoteUrl: postUrl, error: null,
    });
    return NextResponse.json({
      ok: true, sport, date,
      photos: mediaFbids.length,
      postId, postUrl,
    });
  } catch (err) {
    const msg = (err as Error).message;
    await recordPost({
      platform: PLATFORM, sport, date, subId: ALBUM_SUB_ID,
      remoteId: null, remoteUrl: null, error: msg,
    });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
