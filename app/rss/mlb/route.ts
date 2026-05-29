// RSS 2.0 feed for the daily MLB digest. One item per cached digest going back
// FEED_LIMIT days. Each item embeds the full digest HTML so feed readers show
// the same dense layout subscribers get in email and on the web.
//
// Cache strategy: digests change once a day (when the morning generate cron
// writes `daily_digests`). `export const revalidate = 86400` lets Vercel cache
// the response at the edge for 24 hours; the first request of the day rebuilds
// the XML and everything after is a CDN hit.
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

export const revalidate = 86400;

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

export async function GET() {
  const { data, error } = await supabaseAdmin()
    .from("daily_digests")
    .select("date, generated_at, game_count, html, email_html")
    .eq("sport", SPORT)
    .in("mode", IN_SEASON_MODES)
    .order("date", { ascending: false })
    .limit(FEED_LIMIT);

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
    // Prefer email_html: it's table-based with inline styles and monospace
    // fallbacks designed for email clients, which is the closest analog to
    // how feed readers render (CSS-stripped, narrow viewport, table-friendly).
    // Fall back to the web HTML if email wasn't generated for this row.
    const body = r.email_html ?? r.html;
    return `
    <item>
      <title>${escapeXml(title)}</title>
      <link>${escapeXml(link)}</link>
      <guid isPermaLink="true">${escapeXml(link)}</guid>
      <pubDate>${rfc822(editionDate)}</pubDate>
      <media:thumbnail url="${escapeXml(LOGO_URL)}" width="${LOGO_SIZE}" height="${LOGO_SIZE}" />
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
      "cache-control": "public, s-maxage=86400, stale-while-revalidate=86400",
    },
  });
}
