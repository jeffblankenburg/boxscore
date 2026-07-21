// Admin information architecture (issue #50, sport-centric revision).
//
// Two-zone top nav:
//   • Leagues  — one tab per sport (registry-driven, passed in at runtime)
//   • Platform — cross-sport areas (Operations, Metrics, Ads, …)
//
// The left nav is CONTEXTUAL: when a league tab is active it shows that
// sport's tools; when a platform area is active it shows that area's pages.
// resolveContext() maps the current pathname to whichever is active so the
// top tab and the left nav highlight together.
//
// Client-safe: no server-only imports. The sport list arrives as a prop from
// the server layout (which reads the registry).

export type NavLink = { href: string; label: string };

export type PlatformArea = {
  id: string;
  label: string;
  href: string;      // where the top-nav tab points (the area's landing page)
  match: string[];   // pathname prefixes that mark this area active
  links: NavLink[];  // the left-nav pages for this area
};

// Cross-sport areas. Order = top-nav order. `Overview` is the dashboard home;
// per-sport previews intentionally live under the sport tools, not here.
export const PLATFORM_AREAS: PlatformArea[] = [
  {
    id: "overview",
    label: "Overview",
    href: "/admin",
    match: [], // matched specially (exact /admin) in resolveContext
    links: [{ href: "/admin", label: "Dashboard" }],
  },
  {
    id: "operations",
    label: "Operations",
    href: "/admin/operations/crons",
    match: ["/admin/operations"],
    links: [
      { href: "/admin/operations/crons", label: "Crons" },
      { href: "/admin/operations/sends", label: "Send coverage" },
      { href: "/admin/operations/deliverability", label: "Deliverability" },
      { href: "/admin/operations/email-lookup", label: "Email lookup" },
    ],
  },
  {
    id: "metrics",
    label: "Metrics",
    href: "/admin/metrics/subscribers",
    match: ["/admin/metrics", "/admin/clicks", "/admin/demographics", "/admin/games"],
    links: [
      { href: "/admin/metrics/subscribers", label: "Subscribers" },
      { href: "/admin/metrics/sources", label: "Sources" },
      { href: "/admin/metrics/qr", label: "QR codes" },
      { href: "/admin/metrics/sends", label: "Sends" },
      { href: "/admin/metrics/rss", label: "RSS" },
      { href: "/admin/clicks", label: "Clicks" },
      { href: "/admin/demographics", label: "Demographics" },
      { href: "/admin/games", label: "Games" },
    ],
  },
  {
    id: "ads",
    label: "Ads",
    href: "/admin/ads",
    match: ["/admin/ads"],
    links: [
      { href: "/admin/ads", label: "Campaigns" },
      { href: "/admin/ads/advertisers", label: "Advertisers" },
      { href: "/admin/ads/leads", label: "Leads" },
      { href: "/admin/ads/explore", label: "Explore" },
    ],
  },
  {
    id: "content",
    label: "Content",
    href: "/admin/content/digests",
    match: [
      "/admin/content", "/admin/preview/canonical", "/admin/historical",
      "/admin/twitter", "/admin/discord", "/admin/images", "/admin/share-preview",
    ],
    links: [
      { href: "/admin/content/digests", label: "Digests" },
      { href: "/admin/preview/canonical", label: "Canonical preview" },
      { href: "/admin/historical", label: "Historical" },
      { href: "/admin/historical?today=1", label: "On This Day" },
      { href: "/admin/historical/feats", label: "Player-line feats" },
      { href: "/admin/historical/backfill", label: "Backfill status" },
      { href: "/admin/twitter", label: "Twitter" },
      { href: "/admin/discord", label: "Discord" },
      { href: "/admin/images", label: "Images" },
      { href: "/admin/share-preview", label: "Share preview" },
    ],
  },
  {
    id: "subscribers",
    label: "Subscribers",
    href: "/admin/followers",
    match: ["/admin/followers", "/admin/subscribers"],
    links: [
      { href: "/admin/followers", label: "Followers" },
    ],
  },
  {
    id: "data-model",
    label: "Data model",
    href: "/admin/data-model",
    match: ["/admin/data-model"],
    links: [
      { href: "/admin/data-model", label: "Canonical model" },
      { href: "/admin/data-model/statsapi", label: "MLB API mapping" },
      { href: "/admin/data-model/sportsdataio", label: "SportsDataIO mapping" },
    ],
  },
];

// The left-nav tools shown when a sport (league) is the active context. All
// point at existing per-sport routes; the preview page carries its own
// web/email toggle, so one "Preview" entry covers both surfaces.
export function sportTools(sportId: string): NavLink[] {
  return [
    { href: `/admin/${sportId}`, label: "Dashboard" },
    { href: `/admin/preview/${sportId}`, label: "Preview (web + email)" },
  ];
}

export type NavContext =
  | { kind: "league"; id: string }
  | { kind: "platform"; id: string };

// True when `pathname` is `prefix` or a sub-path of it (not merely a string
// prefix — "/admin/ads" must not match "/admin/adshoc").
function underPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

// Map the current pathname to the active nav context. Leagues win over
// platform areas (a sport route like /admin/preview/nfl is a sport tool, not
// Content). Falls back to Overview.
export function resolveContext(pathname: string, sportIds: string[]): NavContext {
  for (const id of sportIds) {
    if (underPrefix(pathname, `/admin/${id}`) || underPrefix(pathname, `/admin/preview/${id}`)) {
      return { kind: "league", id };
    }
  }
  // Most-specific platform prefix wins (e.g. a future /admin/metrics/x).
  let best: PlatformArea | null = null;
  let bestLen = -1;
  for (const area of PLATFORM_AREAS) {
    for (const m of area.match) {
      if (underPrefix(pathname, m) && m.length > bestLen) {
        best = area;
        bestLen = m.length;
      }
    }
  }
  if (best) return { kind: "platform", id: best.id };
  return { kind: "platform", id: "overview" };
}
