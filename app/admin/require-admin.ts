import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_SESSION_COOKIE, validateSession } from "@/lib/admin-auth";

// Server-side admin gate, called at the top of any /admin page that needs
// real auth. Middleware bounces unauthenticated users to /admin/login already,
// but that's only a presence check on the session cookie — the page-level
// validateSession call is what actually proves the cookie is genuine.
//
// Two paths supported:
//   1. 2FA session cookie (boxscore_admin_session) → look up admin_sessions.
//   2. Legacy ADMIN_SECRET cookie (boxscore_admin) → still honored so the
//      operator can recover if email delivery breaks. Remove once 2FA is
//      proven in production.
export async function requireAdmin(): Promise<string> {
  const jar = await cookies();
  const sessionToken = jar.get(ADMIN_SESSION_COOKIE)?.value;
  const legacyToken = jar.get("boxscore_admin")?.value;

  const sessionEmail = sessionToken ? await validateSession(sessionToken) : null;
  if (sessionEmail) return sessionEmail;

  const adminSecret = process.env.ADMIN_SECRET;
  if (adminSecret && legacyToken === adminSecret) {
    return process.env.ADMIN_EMAIL ?? "admin";
  }

  redirect("/admin/login");
}
