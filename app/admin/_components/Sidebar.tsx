"use client";

// Contextual left nav for the admin shell. Its contents depend on the active
// top-nav tab (resolved from the pathname):
//   • a league is active  → that sport's tools (Dashboard, Preview, …)
//   • a platform area is active → that area's pages
// So the left nav is always scoped to "where you are", per the two-zone IA
// decided in issue #50 (sport-centric revision). See nav-config.ts.

import { usePathname } from "next/navigation";
import {
  PLATFORM_AREAS,
  resolveContext,
  sportTools,
  type NavLink,
} from "./nav-config";

// Minimal sport shape the nav needs — fed from the registry by the admin
// layout (server) so admin-only + newly-added sports appear automatically.
export type SportLink = { id: string; name: string };

function isActive(pathname: string, href: string): boolean {
  // Compare on path only (hrefs may carry a query, e.g. ?today=1); usePathname
  // returns the path without search, so strip any query from the link.
  const path = href.split("?")[0]!;
  if (path === "/admin") return pathname === "/admin";
  return pathname === path || pathname.startsWith(path + "/");
}

export function Sidebar({ sports }: { sports: SportLink[] }) {
  const pathname = usePathname();
  const ctx = resolveContext(pathname, sports.map((s) => s.id));

  let heading: string;
  let links: NavLink[];
  if (ctx.kind === "league") {
    heading = sports.find((s) => s.id === ctx.id)?.name ?? ctx.id.toUpperCase();
    links = sportTools(ctx.id);
  } else {
    const area = PLATFORM_AREAS.find((a) => a.id === ctx.id) ?? PLATFORM_AREAS[0]!;
    heading = area.label;
    links = area.links;
  }

  return (
    <nav className="a-sidebar" aria-label={heading}>
      <div className="a-sidebar-section">{heading}</div>
      {links.map((link) => (
        <a
          key={link.href}
          href={link.href}
          className={isActive(pathname, link.href) ? "active" : undefined}
        >
          {link.label}
        </a>
      ))}
    </nav>
  );
}
