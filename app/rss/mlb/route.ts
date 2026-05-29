// RSS 2.0 feed for the daily MLB digest. One item per cached digest going back
// FEED_LIMIT days. Each item embeds the full digest HTML so feed readers show
// the same dense layout subscribers get in email and on the web.
//
// Cache strategy: NONE. The route runs on every request so we can log polls
// to `rss_polls` for the dashboard readership stats — Vercel's edge cache
// would serve responses without invoking our handler, which would silently
// drop the user-agent data we need to count aggregators + subscribers. The
// underlying query is a single indexed select returning <= 30 rows so the
// per-request cost is negligible. Headers tell clients to revalidate.
//
// IMPORTANT: When a new sport goes public (NBA, WNBA, NFL, NHL, etc.), add
// a parallel route at `app/rss/[sport]/route.ts` AND a new entry in
// `app/layout.tsx`'s `alternates.types["application/rss+xml"]` array. The
// footer "RSS" link in BRAND.footerLinks currently points at MLB; once a
// second sport ships, consider a chooser page at `/rss` or per-sport links.

import { supabaseAdmin } from "@/lib/supabase";
import { nextDay, prettyDate } from "@/lib/dates";
import { EMAIL_LINK_BASE } from "@/lib/site";
import { BRAND } from "@/lib/brand";
import { logRssPoll } from "@/lib/rss-polls";

export const dynamic = "force-dynamic";

const SHARE_BUCKET = "share-images";

type ShareImage = { url: string; alt: string; priority: number };

// Map a stored share-image filename (suffix after the YYYY-MM-DD_ prefix) to
// an ordered (alt, priority) pair. Returns null for files that shouldn't go
// in the RSS body — `full.png/.jpg` is wide and unreadable in feed-reader
// preview widths, and `_manifest.json` isn't an image.
function classifyShareFile(name: string): { alt: string; priority: number } | null {
  if (name === "al-standings.png") return { alt: "American League Standings", priority: 1 };
  if (name === "nl-standings.png") return { alt: "National League Standings", priority: 2 };
  if (name === "al-leaders.png")   return { alt: "American League Leaders",   priority: 3 };
  if (name === "nl-leaders.png")   return { alt: "National League Leaders",   priority: 4 };
  const m = name.match(/^boxscore-(\d+)\.png$/);
  if (m) return { alt: `Box score #${Number(m[1])}`, priority: 100 + Number(m[1]) };
  return null;
}

// Pull every share-images file once at the top of a feed request and group
// the relevant ones by games_date (which matches `daily_digests.date`). Pages
// through if storage ever exceeds the 1000-file list cap.
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

const SPORT = "mlb";
const SPORT_LABEL = "MLB";
const FEED_LIMIT = 30;
const FEED_URL = `${EMAIL_LINK_BASE}/rss/${SPORT}`;
const SITE_URL = EMAIL_LINK_BASE;
// Used for the channel-level <image> (the feed-list icon Feedly shows) and as
// a per-item <media:thumbnail> placeholder. Once the per-section share-images
// pipeline lands, item thumbnails should prefer that day's first share image.
const LOGO_URL = `${EMAIL_LINK_BASE}/icon.png`;
const LOGO_SIZE = 256;

// Modes that correspond to a real digest page worth feeding. Offseason /
// preseason placeholder rows are skipped — they exist in `daily_digests` to
// give the archive page something to return, but aren't navigable content.
const IN_SEASON_MODES = ["regular", "no-games", "all-star", "postseason"];

type DigestRow = {
  date: string;
  generated_at: string;
  game_count: number;
  html: string;
  email_html: string | null;
};

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// RSS 2.0 requires pubDate in RFC 822. Item dates are the digest's edition day
// (the day we ship it = games_date + 1) at 6am ET — close enough to when the
// digest actually went out without needing the real send time per item.
function rfc822(isoEditionDate: string): string {
  const [y, m, d] = isoEditionDate.split("-").map(Number) as [number, number, number];
  // 6:00 ET = 10:00 UTC during EDT, 11:00 UTC during EST. Use 10:00 UTC
  // year-round — the hour drift is invisible to feed readers polling daily.
  return new Date(Date.UTC(y, m - 1, d, 10, 0, 0)).toUTCString();
}

export async function GET(req: Request) {
  // Fire-and-forget poll log. We don't await; the response shouldn't wait on a
  // side-effect write, and any DB error is internal-only (already logged in
  // logRssPoll). Voiding the promise also makes the intent obvious.
  void logRssPoll({ sport: SPORT, userAgent: req.headers.get("user-agent") });

  const [{ data, error }, imagesByDate] = await Promise.all([
    supabaseAdmin()
      .from("daily_digests")
      .select("date, generated_at, game_count, html, email_html")
      .eq("sport", SPORT)
      .in("mode", IN_SEASON_MODES)
      .order("date", { ascending: false })
      .limit(FEED_LIMIT),
    loadShareImagesByDate(),
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
    const title = `${SPORT_LABEL} — ${prettyDate(editionDate)}`;
    const link = `${SITE_URL}/${SPORT}/${editionDate}`;
    const images = imagesByDate.get(r.date) ?? [];

    // Body composition:
    //   - "View on the web" anchor at the top — accessibility net for readers
    //     whose feed app stripped images or who use a screen reader, and a
    //     general escape hatch to the full HTML view.
    //   - If per-section share images exist for this date, render them as
    //     <img> tags. Inline width:100% so feed readers fit them to whatever
    //     column width they render in (typically ~400-700px).
    //   - Otherwise fall back to the email_html (or web html) body. Mixed
    //     feeds are expected until the backfill script runs.
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

    // Per-item thumbnail prefers the first share image for that date (the AL
    // standings, by priority) so each item gets a visually distinct
    // preview in Feedly. Falls back to the brand logo for items without
    // images yet.
    const thumbUrl = images[0]?.url ?? LOGO_URL;
    const thumbAttrs = images[0]
      ? `url="${escapeXml(thumbUrl)}"`
      : `url="${escapeXml(LOGO_URL)}" width="${LOGO_SIZE}" height="${LOGO_SIZE}"`;
    return `
    <item>
      <title>${escapeXml(title)}</title>
      <link>${escapeXml(link)}</link>
      <guid isPermaLink="true">${escapeXml(link)}</guid>
      <pubDate>${rfc822(editionDate)}</pubDate>
      <media:thumbnail ${thumbAttrs} />
      <description><![CDATA[${body}]]></description>
    </item>`;
  }).join("");

  const lastBuildDate = rows[0] ? rfc822(nextDay(rows[0].date)) : new Date().toUTCString();

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
     xmlns:atom="http://www.w3.org/2005/Atom"
     xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>${escapeXml(`${BRAND.name} — ${SPORT_LABEL}`)}</title>
    <link>${escapeXml(`${SITE_URL}/${SPORT}`)}</link>
    <atom:link href="${escapeXml(FEED_URL)}" rel="self" type="application/rss+xml" />
    <description>${escapeXml(`Daily ${SPORT_LABEL} box scores, standings, and leaders from ${BRAND.name}.`)}</description>
    <language>en-us</language>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
    <ttl>1440</ttl>
    <image>
      <url>${escapeXml(LOGO_URL)}</url>
      <title>${escapeXml(`${BRAND.name} — ${SPORT_LABEL}`)}</title>
      <link>${escapeXml(`${SITE_URL}/${SPORT}`)}</link>
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
