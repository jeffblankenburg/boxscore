// RSS 2.0 feed for any publicly-launched sport's daily digest, at
// /rss/<sport> (e.g. /rss/mlb, /rss/nfl). One item per cached digest going
// back FEED_LIMIT editions. Each item embeds the full digest HTML so feed
// readers show the same dense layout subscribers get in email and on the web.
//
// One route serves every sport — the sport comes from the path segment and is
// validated against the public sports registry (admin-only leagues 404 so
// unlaunched content can't leak through the feed). The human-facing chooser
// lives at /rss (app/rss/page.tsx); auto-discovery <link>s are emitted by the
// root layout and each /[sport] page.
//
// Cache strategy: NONE. The route runs on every request so we can log polls
// to `rss_polls` for the dashboard readership stats — Vercel's edge cache
// would serve responses without invoking our handler, which would silently
// drop the user-agent data we need to count aggregators + subscribers. The
// underlying query is a single indexed select returning <= 30 rows so the
// per-request cost is negligible. Headers tell clients to revalidate.

import { supabaseAdmin } from "@/lib/supabase";
import { nextDay, prettyDate } from "@/lib/dates";
import { EMAIL_LINK_BASE } from "@/lib/site";
import { BRAND } from "@/lib/brand";
import { getSportById } from "@/lib/sports";
import { IN_SEASON_MODES } from "@/lib/digests";
import { logRssPoll } from "@/lib/rss-polls";

export const dynamic = "force-dynamic";

const SHARE_BUCKET = "share-images";
const FEED_LIMIT = 30;
// Channel-level <image> (the feed-list icon Feedly shows) and the per-item
// <media:thumbnail> fallback for items without a section share image.
const LOGO_URL = `${EMAIL_LINK_BASE}/icon.png`;
const LOGO_SIZE = 256;

type ShareImage = { url: string; alt: string; priority: number };

type DigestRow = {
  date: string;
  generated_at: string;
  game_count: number;
  html: string;
  email_html: string | null;
};

// Map a stored share-image filename (suffix after the YYYY-MM-DD_ prefix) to
// an ordered (alt, priority) pair. Returns null for files that shouldn't go
// in the RSS body — `full.png/.jpg` is wide and unreadable in feed-reader
// preview widths, and `_manifest.json` isn't an image. This recognizes MLB's
// per-section digest images; share images are only wired for MLB today (see
// loadShareImagesByDate's caller), so other sports fall back to the HTML body.
function classifyShareFile(name: string): { alt: string; priority: number } | null {
  if (name === "al-standings.png") return { alt: "American League Standings", priority: 1 };
  if (name === "nl-standings.png") return { alt: "National League Standings", priority: 2 };
  if (name === "al-leaders.png")   return { alt: "American League Leaders",   priority: 3 };
  if (name === "nl-leaders.png")   return { alt: "National League Leaders",   priority: 4 };
  const m = name.match(/^boxscore-(\d+)\.png$/);
  if (m) return { alt: `Box score #${Number(m[1])}`, priority: 100 + Number(m[1]) };
  return null;
}

// Pull the MLB share-images files once at the top of a feed request and group
// the relevant ones by games_date (which matches `daily_digests.date`). MLB
// images live at the bucket root; other sports live in a per-sport subfolder
// (see lib/share-storage.ts) and don't have a per-section set curated for the
// feed, so this is MLB-only — keeping it root-scoped avoids one sport's images
// bleeding into another's feed on a shared date.
async function loadShareImagesByDate(): Promise<Map<string, ShareImage[]>> {
  const supa = supabaseAdmin();
  const byDate = new Map<string, ShareImage[]>();
  let offset = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supa.storage.from(SHARE_BUCKET).list("", { limit: pageSize, offset });
    if (error) {
      console.warn(`loadShareImagesByDate: list error: ${error.message}`);
      break;
    }
    const page = data ?? [];
    if (page.length === 0) break;
    for (const f of page) {
      const m = f.name.match(/^(\d{4}-\d{2}-\d{2})_(.+)$/);
      if (!m) continue;
      const date = m[1]!;
      const suffix = m[2]!;
      const klass = classifyShareFile(suffix);
      if (!klass) continue;
      const { data: urlData } = supa.storage.from(SHARE_BUCKET).getPublicUrl(f.name);
      const list = byDate.get(date) ?? [];
      list.push({ url: urlData.publicUrl, alt: klass.alt, priority: klass.priority });
      byDate.set(date, list);
    }
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  // Sort each day's images by priority so they appear in newspaper order.
  for (const list of byDate.values()) list.sort((a, b) => a.priority - b.priority);
  return byDate;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// RSS 2.0 requires pubDate in RFC 822. The publish instant is the row's real
// `generated_at` (when the generate cron wrote the digest, ~5am ET). We cap it
// at the edition day's 6am ET so a midday regeneration (backfill) doesn't bump
// an old edition's pubDate forward and re-notify readers; and because it's the
// real write time, the newest edition is never stamped in the future — which
// strict readers would hide, silently making the feed look a day stale.
function rfc822PubDate(generatedAtIso: string, isoEditionDate: string): string {
  const generated = new Date(generatedAtIso).getTime();
  const [y, m, d] = isoEditionDate.split("-").map(Number) as [number, number, number];
  // 6:00 ET = 10:00 UTC during EDT, 11:00 UTC during EST. Use 10:00 UTC
  // year-round — the hour drift is invisible to feed readers polling daily.
  const editionCap = Date.UTC(y, m - 1, d, 10, 0, 0);
  return new Date(Math.min(generated, editionCap)).toUTCString();
}

export async function GET(req: Request, ctx: { params: Promise<{ sport: string }> }) {
  const { sport } = await ctx.params;

  // Only publicly-launched sports get a feed. Admin-only leagues 404 so their
  // pre-launch content never leaks through RSS.
  const row = await getSportById(sport);
  if (!row || row.visibility !== "public") {
    return new Response("Not found", { status: 404 });
  }
  const label = row.name;
  const feedUrl = `${EMAIL_LINK_BASE}/rss/${sport}`;
  const siteUrl = EMAIL_LINK_BASE;

  // Fire-and-forget poll log. We don't await; the response shouldn't wait on a
  // side-effect write, and any DB error is internal-only (already logged in
  // logRssPoll). Voiding the promise also makes the intent obvious.
  void logRssPoll({ sport, userAgent: req.headers.get("user-agent") });

  const [{ data, error }, imagesByDate] = await Promise.all([
    supabaseAdmin()
      .from("daily_digests")
      .select("date, generated_at, game_count, html, email_html")
      .eq("sport", sport)
      .in("mode", IN_SEASON_MODES)
      .order("date", { ascending: false })
      .limit(FEED_LIMIT),
    // Share images are an MLB-only pipeline; other sports use the HTML body.
    sport === "mlb" ? loadShareImagesByDate() : Promise.resolve(new Map<string, ShareImage[]>()),
  ]);

  if (error) {
    return new Response(`<error>${escapeXml(error.message)}</error>`, {
      status: 500,
      headers: { "content-type": "application/xml; charset=utf-8" },
    });
  }

  const rows = (data ?? []) as DigestRow[];
  const items = rows.map((r) => {
    // games_date → edition_date for the canonical permalink and for the
    // item title (readers expect the date they're seeing it, not yesterday).
    const editionDate = nextDay(r.date);
    const title = `${label} — ${prettyDate(editionDate)}`;
    const link = `${siteUrl}/${sport}/${editionDate}`;
    const images = imagesByDate.get(r.date) ?? [];

    // Body composition:
    //   - "View on the web" anchor at the top — accessibility net for readers
    //     whose feed app stripped images or who use a screen reader, and a
    //     general escape hatch to the full HTML view.
    //   - If per-section share images exist for this date (MLB), render them as
    //     <img> tags. Inline width:100% so feed readers fit them to whatever
    //     column width they render in (typically ~400-700px).
    //   - Otherwise fall back to the email_html (or web html) body.
    const viewOnWeb = `<p><a href="${escapeXml(link)}">View on the web</a></p>`;
    let body: string;
    if (images.length > 0) {
      const imgTags = images.map((img) =>
        `<p><img src="${escapeXml(img.url)}" alt="${escapeXml(img.alt)}" style="max-width:100%;height:auto;display:block;" /></p>`
      ).join("");
      body = viewOnWeb + imgTags + viewOnWeb;
    } else {
      const fallback = r.email_html ?? r.html;
      body = viewOnWeb + fallback;
    }

    // Per-item thumbnail prefers the first share image for that date so each
    // item gets a visually distinct preview in Feedly. Falls back to the brand
    // logo for items (and sports) without images.
    const thumbUrl = images[0]?.url ?? LOGO_URL;
    const thumbAttrs = images[0]
      ? `url="${escapeXml(thumbUrl)}"`
      : `url="${escapeXml(LOGO_URL)}" width="${LOGO_SIZE}" height="${LOGO_SIZE}"`;
    return `
    <item>
      <title>${escapeXml(title)}</title>
      <link>${escapeXml(link)}</link>
      <guid isPermaLink="true">${escapeXml(link)}</guid>
      <pubDate>${rfc822PubDate(r.generated_at, editionDate)}</pubDate>
      <media:thumbnail ${thumbAttrs} />
      <description><![CDATA[${body}]]></description>
    </item>`;
  }).join("");

  const lastBuildDate = rows[0]
    ? rfc822PubDate(rows[0].generated_at, nextDay(rows[0].date))
    : new Date().toUTCString();

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
     xmlns:atom="http://www.w3.org/2005/Atom"
     xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>${escapeXml(`${BRAND.name} — ${label}`)}</title>
    <link>${escapeXml(`${siteUrl}/${sport}`)}</link>
    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml" />
    <description>${escapeXml(`Daily ${label} box scores, standings, and leaders from ${BRAND.name}.`)}</description>
    <language>en-us</language>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
    <ttl>1440</ttl>
    <image>
      <url>${escapeXml(LOGO_URL)}</url>
      <title>${escapeXml(`${BRAND.name} — ${label}`)}</title>
      <link>${escapeXml(`${siteUrl}/${sport}`)}</link>
    </image>${items}
  </channel>
</rss>`;

  return new Response(xml, {
    status: 200,
    headers: {
      "content-type": "application/rss+xml; charset=utf-8",
      // No CDN cache: see top-of-file note. Browser-side, "no-cache,
      // must-revalidate" tells the client to validate freshness against
      // origin on every request — paired with feed-reader polling cadence
      // (typically hourly+) this is fine.
      "cache-control": "no-cache, must-revalidate",
    },
  });
}
