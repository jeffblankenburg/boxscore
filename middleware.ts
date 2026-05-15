import { NextResponse, type NextRequest } from "next/server";

// Gates /admin/* behind one of two auth mechanisms:
//
//   1. Email-2FA session cookie (boxscore_admin_session) — the modern path.
//      The cookie value is a session token; the admin pages validate it
//      against admin_sessions on each render. Middleware only checks
//      presence so the unauthenticated user gets redirected to the login
//      page instead of seeing a generic 404.
//
//   2. ADMIN_SECRET legacy cookie (boxscore_admin) — kept as a fallback so
//      the operator isn't locked out mid-rollout. Setting ?key=ADMIN_SECRET
//      mints the legacy cookie. Can be removed once 2FA is fully cut over.
//
// /admin/login and /admin/verify must be reachable without auth — they ARE
// the auth flow.

const LEGACY_COOKIE = "boxscore_admin";
const SESSION_COOKIE = "boxscore_admin_session";

const PUBLIC_ADMIN_PATHS = ["/admin/login", "/admin/verify"];

export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;

  // Auth pages are always reachable.
  if (PUBLIC_ADMIN_PATHS.some((p) => path === p || path.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  // 2FA session cookie present → let the admin pages validate it server-side.
  if (req.cookies.get(SESSION_COOKIE)?.value) {
    return NextResponse.next();
  }

  // Legacy ADMIN_SECRET path: query param mints the cookie, cookie value
  // matching the secret grants access. Kept so the operator isn't locked out
  // if 2FA email delivery breaks.
  const secret = process.env.ADMIN_SECRET;
  if (secret) {
    const key = req.nextUrl.searchParams.get("key");
    if (key === secret) {
      const url = req.nextUrl.clone();
      url.searchParams.delete("key");
      const res = NextResponse.redirect(url);
      res.cookies.set(LEGACY_COOKIE, secret, {
        httpOnly: true,
        sameSite: "strict",
        secure: req.nextUrl.protocol === "https:",
        maxAge: 60 * 60 * 24 * 30,
        path: "/admin",
      });
      return res;
    }
    if (req.cookies.get(LEGACY_COOKIE)?.value === secret) {
      return NextResponse.next();
    }
  }

  // Unauthenticated → bounce to login. (We used to 404 to be opaque, but with
  // an explicit login flow there's nothing to hide.)
  const url = req.nextUrl.clone();
  url.pathname = "/admin/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: "/admin/:path*",
};
