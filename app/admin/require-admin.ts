import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_SESSION_COOKIE, validateSession } from "@/lib/admin-auth";

// Server-side admin gate, called at the top of any /admin page that needs
// real auth. Middleware bounces unauthenticated users to /admin/login on a
// presence check; the page-level validateSession call is what actually
// proves the cookie is genuine. Returns the session's email so callers
// know who the admin is — that email is the canonical "current admin"
// identifier across the app now that ADMIN_EMAIL has been retired.
export async function requireAdmin(): Promise<string> {
  const jar = await cookies();
  const sessionToken = jar.get(ADMIN_SESSION_COOKIE)?.value;
  const sessionEmail = sessionToken ? await validateSession(sessionToken) : null;
  if (sessionEmail) return sessionEmail;
  redirect("/admin/login");
}
