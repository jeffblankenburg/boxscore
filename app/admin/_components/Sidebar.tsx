"use client";

// Persistent left sidebar for the admin shell. Reads the current pathname
// via usePathname() so the active link highlights without each page having
// to pass an explicit `active` prop.
//
// IA matches the reorganization decided in chunk 2 of issue #50:
//
//   Dashboard          ← watchwall only ("is anything broken right now?")
//   Operations         ← when something IS broken, drill here
//   Metrics            ← analytical / trend views
//   Ads                ← ad pipeline
//   Content            ← publishing tools + content inventory
//   Sports             ← per-sport tools
//   Subscribers        ← audience
//   Admin              ← configuration
//
// Some sub-pages still point at their pre-reorg URLs (Twitter, Images,
// Share preview, Followers, Sports config, MLB/NBA/WNBA) — chunk 2b moves
// those to the nested paths shown in commented form below. Sidebar URLs
// will update at that point.

import { usePathname } from "next/navigation";

type NavLink = { href: string; label: string };
type NavSection = { label: string; links: NavLink[] };

const SECTIONS: NavSection[] = [
  {
    label: "Dashboard",
    links: [
      { href: "/admin", label: "Overview" },
    ],
  },
  {
    label: "Operations",
    links: [
      { href: "/admin/operations/crons", label: "Crons" },
      { href: "/admin/operations/sends", label: "Send coverage" },
      { href: "/admin/operations/deliverability", label: "Deliverability" },
      { href: "/admin/operations/email-lookup", label: "Email lookup" },
    ],
  },
  {
    label: "Metrics",
    links: [
      { href: "/admin/metrics/subscribers", label: "Subscribers" },
      { href: "/admin/metrics/sources", label: "Sources" },
      { href: "/admin/metrics/sends", label: "Sends" },
      { href: "/admin/metrics/rss", label: "RSS" },
      // Chunk 2b: move /admin/clicks → /admin/metrics/clicks
      { href: "/admin/clicks", label: "Clicks" },
      { href: "/admin/demographics", label: "Demographics" },
      { href: "/admin/games", label: "Games" },
    ],
  },
  {
    label: "Ads",
    links: [
      { href: "/admin/ads", label: "Campaigns" },
      { href: "/admin/ads/advertisers", label: "Advertisers" },
      { href: "/admin/ads/leads", label: "Leads" },
      { href: "/admin/ads/explore", label: "Explore" },
    ],
  },
  {
    label: "Content",
    links: [
      { href: "/admin/preview/mlb", label: "Email preview" },
      { href: "/admin/preview/canonical", label: "Canonical preview" },
      { href: "/admin/content/digests", label: "Digests" },
      { href: "/admin/historical", label: "Historical" },
      { href: "/admin/historical?today=1", label: "On This Day" },
      { href: "/admin/historical/feats", label: "Player-line feats" },
      { href: "/admin/historical/backfill", label: "Backfill status" },
      // Chunk 2b: move these into /admin/content/*
      { href: "/admin/twitter", label: "Twitter" },
      { href: "/admin/discord", label: "Discord" },
      { href: "/admin/images", label: "Images" },
      { href: "/admin/share-preview", label: "Share preview" },
    ],
  },
  {
    label: "Sports",
    links: [
      // Chunk 2b: move /admin/[sport] → /admin/sports/[sport]
      { href: "/admin/mlb", label: "MLB" },
      { href: "/admin/nba", label: "NBA" },
      { href: "/admin/wnba", label: "WNBA" },
    ],
  },
  {
    label: "Subscribers",
    links: [
      // Chunk 2b: move /admin/followers → /admin/subscribers/followers
      { href: "/admin/followers", label: "Followers" },
    ],
  },
  {
    label: "Data model",
    links: [
      { href: "/admin/data-model", label: "Canonical model" },
      { href: "/admin/data-model/statsapi", label: "MLB API mapping" },
      { href: "/admin/data-model/sportsdataio", label: "SportsDataIO mapping" },
    ],
  },
];

function isActive(pathname: string, href: string): boolean {
  // /admin (the dashboard) only highlights on exact match — its sub-routes
  // belong to other sections.
  if (href === "/admin") return pathname === "/admin";
  // Exact match or current path is a sub-route. But /admin/ads/advertisers
  // shouldn't highlight /admin/ads — disambiguate by checking the next
  // char is "/" or end.
  if (pathname === href) return true;
  return pathname.startsWith(href + "/");
}

export function Sidebar() {
  const pathname = usePathname();
  return (
    <nav className="a-sidebar">
      <div className="a-sidebar-brand">
        boxscore <small>admin</small>
      </div>
      {SECTIONS.map((section) => (
        <div key={section.label}>
          <div className="a-sidebar-section">{section.label}</div>
          {section.links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className={isActive(pathname, link.href) ? "active" : undefined}
            >
              {link.label}
            </a>
          ))}
        </div>
      ))}
    </nav>
  );
}
