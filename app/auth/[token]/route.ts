// GET /auth/[token] — magic-link consumer.
//
// Same one-click-from-email pattern as /c/[token]: real users get auto-
// signed-in and redirected to /settings; bots (Gmail link safety, Outlook
// SafeLinks, link unfurlers) get a manual click-through page so they
// don't burn the single-use token on the user's behalf.
//
// The page-based version of this route required two clicks (email link →
// "Sign in" button) to dodge the prefetch risk. The route-handler version
// folds the bot mitigation into UA detection, so real users only click
// once.
//
// POST is also handled so the manual-fallback page (rendered to bots) can
// still complete the sign-in if a real user with a flagged UA ends up
// there. Token is consumed atomically — second click of the same URL
// after success lands on /settings with an expired-link banner.

import { NextResponse } from "next/server";
import {
  consumeMagicToken,
  createSession,
  SUBSCRIBER_SESSION_COOKIE,
  SUBSCRIBER_SESSION_TTL_SEC,
} from "@/lib/subscriber-auth";
import { isLikelyBot } from "@/lib/bot-detect";

export const dynamic = "force-dynamic";

// 256-bit random base64url tokens are 43 chars of [A-Za-z0-9_-].
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const url = new URL(req.url);

  if (!TOKEN_RE.test(token)) {
    return NextResponse.redirect(new URL("/settings", url));
  }

  const looksLikeBot = isLikelyBot(req.headers.get("user-agent"));
  if (looksLikeBot) {
    return new NextResponse(manualSignInPage(token), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  return consumeAndRedirect(token, url);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  // Submission from the manual sign-in fallback page above.
  const { token } = await params;
  const url = new URL(req.url);
  if (!TOKEN_RE.test(token)) {
    return NextResponse.redirect(new URL("/settings", url));
  }
  return consumeAndRedirect(token, url);
}

async function consumeAndRedirect(token: string, url: URL): Promise<NextResponse> {
  const claim = await consumeMagicToken(token);
  if (!claim) {
    return NextResponse.redirect(new URL("/settings?error=link_expired", url));
  }
  const { token: sessionToken } = await createSession({
    subscriberId: claim.subscriberId,
  });
  const res = NextResponse.redirect(new URL("/settings", url));
  res.cookies.set({
    name: SUBSCRIBER_SESSION_COOKIE,
    value: sessionToken,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SUBSCRIBER_SESSION_TTL_SEC,
  });
  return res;
}

function manualSignInPage(token: string): string {
  // Minimal HTML — no globals.css here since this is a raw Response. Real
  // users almost never see this page; it's the prefetcher fallback. The
  // form POSTs back to the same URL to complete the sign-in.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Sign in — boxscore</title>
<meta name="robots" content="noindex">
<style>
  body { font-family: system-ui, sans-serif; padding: 24px; max-width: 560px; margin: 0 auto; color: #161410; background: #f9f7f1; }
  h1 { font-size: 22px; margin: 0 0 12px; }
  p { font-size: 15px; line-height: 1.5; margin: 0 0 12px; }
  button { padding: 10px 16px; background: #161410; color: white; border: 0; cursor: pointer; font-size: 14px; font-weight: 600; }
</style>
</head>
<body>
<h1>Sign in to boxscore</h1>
<p>Click below to sign in. The link is good for 15 minutes and only works once.</p>
<form action="/auth/${token}" method="post">
  <button type="submit">Sign in</button>
</form>
<p style="font-size:13px;color:#6a6354;margin-top:18px;">Didn't ask for this link? Just close the tab — nothing changes unless you click the button.</p>
</body>
</html>`;
}
