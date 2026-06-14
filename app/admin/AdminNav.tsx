import { LeagueSwitcher } from "./LeagueSwitcher";

// AdminNav renders two strips: the top-level universal links (dashboard,
// preview, click tracking, sports) and underneath, the LeagueSwitcher with
// one badge per visible sport. Per-sport tools (email preview, twitter
// compose, images, content preview, cron triggers) live on /admin/[sport]
// reached via the switcher — this nav stays focused on cross-sport surfaces.
//
// `active` highlights the current top-level item. Pass the matching key
// from each page so the operator can see where they are. Defaults to
// undefined (no highlight) for older callers that haven't been updated.
export type AdminNavItem =
  | "dashboard"
  | "preview"
  | "content"
  | "historical"
  | "data-model"
  | "crons"
  | "sends"
  | "deliverability"
  | "email-lookup"
  | "subscribers"
  | "rss-metrics"
  | "clicks"
  | "demographics"
  | "ads"
  | "followers"
  | "sports"
  | "games"
  | "discord"
  | "share-preview";

export function AdminNav({
  activeSport,
  active,
  leagueBasePath,
}: {
  activeSport?: string;
  active?: AdminNavItem;
  // Pass through to LeagueSwitcher when the page lives under a section
  // other than /admin/[sport] — e.g. /admin/preview/[sport] sets this to
  // "/admin/preview" so the league badges stay inside the preview area.
  leagueBasePath?: string;
} = {}) {
  const items: Array<{ key: AdminNavItem; href: string; label: string }> = [
    { key: "dashboard", href: "/admin", label: "Dashboard" },
    { key: "preview", href: "/admin/preview/mlb", label: "Preview" },
    { key: "content", href: "/admin/content/digests", label: "Content" },
    { key: "historical", href: "/admin/historical", label: "Historical" },
    { key: "data-model", href: "/admin/data-model", label: "Data model" },
    { key: "crons", href: "/admin/operations/crons", label: "Crons" },
    { key: "sends", href: "/admin/operations/sends", label: "Sends" },
    { key: "deliverability", href: "/admin/operations/deliverability", label: "Deliverability" },
    { key: "email-lookup", href: "/admin/operations/email-lookup", label: "Email lookup" },
    { key: "subscribers", href: "/admin/metrics/subscribers", label: "Subscribers" },
    { key: "rss-metrics", href: "/admin/metrics/rss", label: "RSS metrics" },
    { key: "clicks", href: "/admin/clicks", label: "Click tracking" },
    { key: "demographics", href: "/admin/demographics", label: "Demographics" },
    { key: "ads", href: "/admin/ads", label: "Ads" },
    { key: "followers", href: "/admin/followers", label: "Followers" },
    { key: "sports", href: "/admin/sports", label: "Sports" },
    { key: "games", href: "/admin/games", label: "Games" },
    { key: "discord", href: "/admin/discord", label: "Discord" },
    { key: "share-preview", href: "/admin/share-preview", label: "Share preview" },
  ];
  return (
    <>
      <nav className="admin-nav">
        {items.map((it) => (
          <a
            key={it.href}
            href={it.href}
            className={active === it.key ? "active" : undefined}
            aria-current={active === it.key ? "page" : undefined}
          >
            {it.label}
          </a>
        ))}
      </nav>
      <LeagueSwitcher active={activeSport} basePath={leagueBasePath} />
    </>
  );
}
