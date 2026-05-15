import { NextResponse, type NextRequest } from "next/server";

// Gates everything under /admin behind ADMIN_SECRET. First visit with the
// secret as ?key=... sets a long-lived cookie; subsequent visits don't need
// the query param. Wrong/missing secret → 404 (intentionally indistinguishable
// from "no such page" so the URL isn't an attack target).

const COOKIE_NAME = "boxscore_admin";

export function middleware(req: NextRequest) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) {
    // Admin disabled in this environment — show a generic 404 to avoid
    // signaling that the route exists.
    return new NextResponse(null, { status: 404 });
  }

  const key = req.nextUrl.searchParams.get("key");
  const cookie = req.cookies.get(COOKIE_NAME)?.value;

  if (key === secret) {
    const url = req.nextUrl.clone();
    url.searchParams.delete("key");
    const res = NextResponse.redirect(url);
    res.cookies.set(COOKIE_NAME, secret, {
      httpOnly: true,
      sameSite: "strict",
      secure: req.nextUrl.protocol === "https:",
      maxAge: 60 * 60 * 24 * 30,
      path: "/admin",
    });
    return res;
  }

  if (cookie === secret) return NextResponse.next();

  return new NextResponse(null, { status: 404 });
}

export const config = {
  matcher: "/admin/:path*",
};
