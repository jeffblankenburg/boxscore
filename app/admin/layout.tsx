// Top-level admin layout. Reads the current admin's session email and
// renders the shell via AdminLayoutShell (which owns the bare-path check
// since usePathname is client-only).
//
// The session lookup duplicates the work requireAdmin() does on each page,
// but keeping the layout as the source of truth for the topbar avoids
// threading the email through every page component. validateSession is a
// single token-keyed select with an unused-row check — cheap.
//
// See issue #50 for the design decisions driving the rebuild.

import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE, validateSession } from "@/lib/admin-auth";
import { getVisibleSports } from "@/lib/sports";
import { AdminLayoutShell } from "./_components/AdminLayoutShell";
import "./admin.css";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies();
  const sessionToken = jar.get(ADMIN_SESSION_COOKIE)?.value;
  const email = sessionToken ? await validateSession(sessionToken) : null;
  // Registry-driven so the Sidebar's Sports section (and any new sport)
  // shows up without editing a hardcoded list. Admin context sees admin-only
  // sports too. Passed as plain {id,name} since Sidebar is a client component.
  const sports = (await getVisibleSports({ includeAdminOnly: true })).map((s) => ({ id: s.id, name: s.name }));
  return <AdminLayoutShell email={email} sports={sports}>{children}</AdminLayoutShell>;
}
