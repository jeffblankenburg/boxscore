import type { MetadataRoute } from "next";
import { EMAIL_LINK_BASE } from "@/lib/site";
import { getVisibleSports } from "@/lib/sports";
import { listAllDigestDates } from "@/lib/digests";
import { listAllTeamDigestKeys } from "@/lib/team-digests";
import { teamsBySport, type Sport } from "@/lib/teams";
import { nextDay } from "@/lib/dates";

// Regenerated lazily then cached for 24h. The daily generate cron calls
// revalidatePath('/sitemap.xml') after new content lands, so the sitemap
// refreshes within seconds of a new digest being published; the 24h ttl is
// just a backstop in case the cron's revalidate call is ever lost.
//
// Player URLs are intentionally omitted — they're discovered by crawlers
// via internal links from box scores (Wave 1b), which is a stronger SEO
// signal than a sitemap entry and avoids enumerating ~1500 active players
// on every regeneration.
export const revalidate = 86400;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = EMAIL_LINK_BASE;
  const sports = await getVisibleSports();

  const staticUrls: MetadataRoute.Sitemap = [
    { url: `${base}/`,             changeFrequency: "daily",   priority: 1.0 },
    { url: `${base}/about`,        changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/subscribe`,    changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/mlb/transactions`, changeFrequency: "daily",   priority: 0.7 },
    { url: `${base}/mlb/fantasy`,     changeFrequency: "hourly", priority: 0.8 },
    { url: `${base}/mlb/predictions`, changeFrequency: "hourly", priority: 0.8 },
    { url: `${base}/privacy`,      changeFrequency: "yearly",  priority: 0.1 },
    { url: `${base}/terms`,        changeFrequency: "yearly",  priority: 0.1 },
  ];

  const sportLanding: MetadataRoute.Sitemap = sports.map((s) => ({
    url: `${base}/${s.id}`,
    changeFrequency: "daily" as const,
    priority: 0.9,
  }));

  const teamHubUrls: MetadataRoute.Sitemap = sports.flatMap((s) =>
    teamsBySport(s.id as Sport).map((t) => ({
      url: `${base}/${s.id}/${t.slug}`,
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
  );

  // URL date segment is the EDITION date; daily_digests/team_digests rows
  // are keyed by games_date. Translate via nextDay() so the sitemap URLs
  // match what the page routes expect.
  const leagueDates = await Promise.all(
    sports.map(async (s) => ({ sport: s.id, dates: await listAllDigestDates(s.id) })),
  );
  const dailyUrls: MetadataRoute.Sitemap = leagueDates.flatMap(({ sport, dates }) =>
    dates.map((gamesDate) => ({
      url: `${base}/${sport}/${nextDay(gamesDate)}`,
      lastModified: gamesDate,
      changeFrequency: "yearly" as const,
      priority: 0.7,
    })),
  );

  const teamKeys = await Promise.all(
    sports.map(async (s) => ({ sport: s.id, keys: await listAllTeamDigestKeys(s.id) })),
  );
  const teamDayUrls: MetadataRoute.Sitemap = teamKeys.flatMap(({ sport, keys }) =>
    keys.map((k) => ({
      url: `${base}/${sport}/${nextDay(k.date)}/${k.team_slug}`,
      lastModified: k.date,
      changeFrequency: "yearly" as const,
      priority: 0.6,
    })),
  );

  return [...staticUrls, ...sportLanding, ...teamHubUrls, ...dailyUrls, ...teamDayUrls];
}
