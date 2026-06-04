"use client";

// Top-level admin layout. Renders the persistent sidebar + top bar shell
// for every /admin/* route EXCEPT the unauthenticated /admin/login and
// /admin/verify pages, which need to render bare. usePathname() is the
// reason this is a client component; server children below still render
// server-side and stream through.
//
// See issue #50 for the design decisions driving this rebuild.

import { usePathname } from "next/navigation";
import { Sidebar } from "./_components/Sidebar";
import "./admin.css";

const BARE_PATHS = new Set(["/admin/login", "/admin/verify"]);

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (BARE_PATHS.has(pathname)) {
    return <>{children}</>;
  }
  return (
    <div className="a-shell">
      <Sidebar />
      <div className="a-topbar">
        <div /> {/* breadcrumbs slot — rendered per-page inside content */}
        <div className="a-topbar-right">
          <a href="/admin/login" className="a-muted">Sign out</a>
        </div>
      </div>
      <main className="a-content">{children}</main>
    </div>
  );
}
