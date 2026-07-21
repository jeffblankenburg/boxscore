"use client";

// Client shell for the admin layout. Carved out of app/admin/layout.tsx so
// the layout itself can be a server component (it now reads the admin
// session email via cookies + DB to surface in the topbar). This wrapper
// owns only the pathname-aware "do we render bare?" check — login + verify
// pages render without the sidebar/topbar.

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Sidebar, type SportLink } from "./Sidebar";
import { TopNav } from "./TopNav";

const BARE_PATHS = new Set(["/admin/login", "/admin/verify"]);

export function AdminLayoutShell({
  email,
  sports,
  children,
}: {
  // Current admin's email, surfaced in the topbar. null when no valid
  // session — won't happen on a real admin page (requireAdmin redirects
  // first) but possible on the brief instant before a redirect resolves.
  email: string | null;
  // Registry-driven sport list for the Sidebar's Sports section.
  sports: SportLink[];
  children: ReactNode;
}) {
  const pathname = usePathname();
  if (BARE_PATHS.has(pathname)) {
    return <>{children}</>;
  }
  return (
    <div className="a-shell">
      <TopNav sports={sports} />
      <Sidebar sports={sports} />
      <div className="a-topbar">
        <div /> {/* breadcrumbs slot — rendered per-page inside content */}
        <div className="a-topbar-right">
          {email && (
            <span className="a-muted" style={{ marginRight: 12 }} aria-label="Signed in as">
              {email}
            </span>
          )}
          <a href="/admin/login" className="a-muted">Sign out</a>
        </div>
      </div>
      <main className="a-content">{children}</main>
    </div>
  );
}
