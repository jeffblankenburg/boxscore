import { NextResponse, type NextRequest } from "next/server";

// Two responsibilities in one middleware:
//
//   1. Mark /games/* requests with `x-games: 1` so the root layout can
//      skip the public-site chrome and the games layout takes over the
//      viewport. No auth required — same anonymous-friendly model as
//      the digest pages.
//   2. Gates /admin/* (everything below) behind one of two auth mechanisms.

function gamesNext(req: NextRequest): NextResponse {
  const reqHeaders = new Headers(req.headers);
  reqHeaders.set("x-games", "1");
  return NextResponse.next({ request: { headers: reqHeaders } });
}

// Gates /admin/* behind an email-2FA session cookie
// (boxscore_admin_session). The cookie value is a session token; admin
// pages validate it against admin_sessions on each render. Middleware
// only checks presence so the unauthenticated user gets redirected to
// the login page instead of seeing a generic 404.
//
// /admin/login and /admin/verify must be reachable without auth —
// they ARE the auth flow.

const SESSION_COOKIE = "boxscore_admin_session";

const PUBLIC_ADMIN_PATHS = ["/admin/login", "/admin/verify"];

// Inject `x-admin: 1` on the forwarded request so the root layout
// (`app/layout.tsx`) can detect admin requests and skip the public-site
// chrome (newspaper wrapper, SiteHeader, SiteFooter). The header is set on
// the request — not the response — so server components can read it via
// `headers()`. Auth-page responses also get the header so login/verify
// render bare too.
function adminNext(req: NextRequest): NextResponse {
  const reqHeaders = new Headers(req.headers);
  reqHeaders.set("x-admin", "1");
  return NextResponse.next({ request: { headers: reqHeaders } });
}

export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;

  // Games surface — no auth, just header injection so the root layout
  // can skip the digest-site chrome.
  if (path === "/games" || path.startsWith("/games/")) {
    return gamesNext(req);
  }

  // Auth pages are always reachable.
  if (PUBLIC_ADMIN_PATHS.some((p) => path === p || path.startsWith(p + "/"))) {
    return adminNext(req);
  }

  // 2FA session cookie present → let the admin pages validate it server-side.
  if (req.cookies.get(SESSION_COOKIE)?.value) {
    return adminNext(req);
  }

  // Unauthenticated → bounce to login. (We used to 404 to be opaque, but with
  // an explicit login flow there's nothing to hide.)
  const url = req.nextUrl.clone();
  url.pathname = "/admin/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // Match both surfaces. The function above branches on path.
  matcher: ["/admin/:path*", "/games", "/games/:path*"],
};
