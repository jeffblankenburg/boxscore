import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { isSportVisible, getVisibleSports } from "@/lib/sports";
import { mastheadNavSports } from "@/lib/masthead";
import { isAdminSession } from "@/lib/admin-auth";
import { getLatestDigest } from "@/lib/digests";
import { yesterdayInET } from "@/lib/dates";
import { loadFootballData } from "@/lib/sports/football/data";
import { renderFootballConferenceContent } from "@/lib/sports/football/render/digest";
import { findConferenceBySlug } from "@/lib/sports/football/conferences";
import { loadNcaamData } from "@/lib/ncaam";
import { loadNcaawData } from "@/lib/ncaaw";
import { renderBasketballConferenceContent } from "@/lib/render-basketball";
import { findBasketballConferenceBySlug, scopeBasketballToConference } from "@/lib/basketball-conferences";
import { EMAIL_LINK_BASE } from "@/lib/site";

const BASKETBALL_CONF_SPORTS = ["ncaam", "ncaaw"] as const;
type BasketballConfSport = (typeof BASKETBALL_CONF_SPORTS)[number];
function isBasketballConfSport(s: string): s is BasketballConfSport {
  return (BASKETBALL_CONF_SPORTS as readonly string[]).includes(s);
}

export const dynamicParams = true;
export const revalidate = false;

// Public conference digest — the daily NCAAF data scoped to one conference.
// Rendered live off the latest edition's games date (same source the league
// page reads), web-only, mirroring the football team pages. Conferences are an
// NCAAF-only concept, so any other sport 404s.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ sport: string; slug: string }>;
}): Promise<Metadata> {
  const { sport, slug } = await params;
  if (isBasketballConfSport(sport)) {
    const bconf = findBasketballConferenceBySlug(sport, slug);
    if (!bconf) return {};
    const m = sport === "ncaam" ? "Men's" : "Women's";
    return {
      title: `${bconf.short} ${m} Basketball — Scores & Standings | boxscore`,
      description: `${bconf.short} college basketball box scores and standings. Updated daily.`,
      alternates: { canonical: `${EMAIL_LINK_BASE}/${sport}/conference/${bconf.slug}` },
    };
  }
  const conf = sport === "ncaaf" ? findConferenceBySlug(slug) : undefined;
  if (!conf) return {};
  return {
    title: `${conf.short} Football — Scores, Standings & Rankings | boxscore`,
    description: `${conf.short} college football box scores, standings, and rankings. Updated daily.`,
    alternates: { canonical: `${EMAIL_LINK_BASE}/${sport}/conference/${conf.slug}` },
  };
}

export default async function ConferencePage({
  params,
}: {
  params: Promise<{ sport: string; slug: string }>;
}) {
  const { sport, slug } = await params;
  // Admins can preview admin_only sports pre-launch; the public still 404s.
  if (!isSportVisible(sport, { includeAdminOnly: await isAdminSession() })) notFound();

  const navSports = mastheadNavSports(await getVisibleSports());

  // College basketball: scope the latest edition's data to one conference and
  // render the conference digest (full standings + its scores + box scores).
  if (isBasketballConfSport(sport)) {
    const bconf = findBasketballConferenceBySlug(sport, slug);
    if (!bconf) notFound();
    const latest = await getLatestDigest(sport);
    const gamesDate = latest?.date ?? yesterdayInET();
    const bdata = sport === "ncaam"
      ? await loadNcaamData(gamesDate)
      : await loadNcaawData(gamesDate);
    const html = renderBasketballConferenceContent(scopeBasketballToConference(bdata, bconf), bconf, navSports);
    const schema = {
      "@context": "https://schema.org",
      "@type": "SportsOrganization",
      "@id": `${EMAIL_LINK_BASE}/${sport}/conference/${bconf.slug}`,
      name: `${bconf.short} (College Basketball)`,
      url: `${EMAIL_LINK_BASE}/${sport}/conference/${bconf.slug}`,
      sport: "Basketball",
    };
    return (
      <div>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    );
  }

  if (sport !== "ncaaf") notFound();

  const conf = findConferenceBySlug(slug);
  if (!conf) notFound();

  // Latest finalized games date — the same anchor the bookmarkable league page
  // uses, so the conference view stays in lockstep with /ncaaf. Falls back to
  // yesterday-in-ET when no league digest is stored yet, so the page renders
  // live (like the team pages) rather than 404ing pre-launch.
  const latest = await getLatestDigest(sport);
  const gamesDate = latest?.date ?? yesterdayInET();

  const data = await loadFootballData("ncaaf", gamesDate);
  const html = renderFootballConferenceContent(data, conf, navSports);

  const schema = {
    "@context": "https://schema.org",
    "@type": "SportsOrganization",
    "@id": `${EMAIL_LINK_BASE}/${sport}/conference/${conf.slug}`,
    name: `${conf.short} (College Football)`,
    url: `${EMAIL_LINK_BASE}/${sport}/conference/${conf.slug}`,
    sport: "American Football",
  };

  return (
    <div>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
      />
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
