// GET /c/[token] — confirmation link from the welcome email.
//
// Handler (not a page) because we need to set a session cookie on real-user
// activations so we can drop them straight into /settings. Server Components
// can read cookies but not write them; the cookie-set has to live in a route
// handler or server action.
//
// Branches:
//   - bot UA            → render a static "click to confirm" page; no DB write,
//                         no session, so a link-prefetcher can't claim the row.
//   - subscriber missing → 404
//   - already unsubscribed → redirect to /subscribe?reason=unsubscribed
//   - pending → active (this request did the transition):
//                         send welcome email, create session, set cookie,
//                         redirect to /settings?welcome=1 so the new subscriber
//                         lands directly on the manage-subscriptions page.
//   - already active (no transition this request):
//                         redirect to /settings without a session — the page
//                         will prompt for a magic-link sign-in. Avoids the
//                         confirm token being a permanent sign-in cheat code.
//
// Session creation only happens when *this* request flipped pending→active.
// confirmSubscriberIfPending is atomic, so repeat clicks of the same URL
// can't grant a session after the first one. The confirm token itself never
// rotates; the gate is the row's status, not the token.

import { NextResponse } from "next/server";
import {
  confirmSubscriberIfPending,
  findByConfirmToken,
} from "@/lib/subscribers";
import {
  createSession,
  SUBSCRIBER_SESSION_COOKIE,
  SUBSCRIBER_SESSION_TTL_SEC,
} from "@/lib/subscriber-auth";
import { sendEmail } from "@/lib/email";
import { welcomeEmail } from "@/lib/emails/templates";
import { siteOrigin } from "@/lib/site";
import { getDigest } from "@/lib/digests";
import { yesterdayInET, prettyDate } from "@/lib/dates";
import { isLikelyBot } from "@/lib/bot-detect";

export const dynamic = "force-dynamic";

const TOKEN_RE = /^[0-9a-f-]{36}$/i;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const url = new URL(req.url);

  if (!TOKEN_RE.test(token)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const subscriber = await findByConfirmToken(token);
  if (!subscriber) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const looksLikeBot = isLikelyBot(req.headers.get("user-agent"));

  // Bot path: render a tiny static page. We don't mark anything active and
  // don't issue a session, so a link prefetcher can't "use up" the token.
  // The real user click follows immediately after in practice.
  if (looksLikeBot) {
    return new NextResponse(botPlaceholderHtml(), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  if (subscriber.status === "unsubscribed") {
    return NextResponse.redirect(new URL("/subscribe?reason=unsubscribed", url));
  }

  // Atomic pending → active. Returns the row only on the request that
  // actually moved the status; null otherwise (already active, race winner
  // was a different request, etc).
  const justActivated = await confirmSubscriberIfPending(subscriber.id);

  if (!justActivated) {
    // Already active. Send them to /settings; if they're not signed in they
    // get the magic-link form. Confirm tokens don't double as sign-in
    // credentials past the first use.
    return NextResponse.redirect(new URL("/settings", url));
  }

  // Best-effort welcome email — send the most recent league digest so the
  // first thing the new subscriber sees in their inbox is the actual
  // product, not a thank-you screen.
  try {
    const origin = await siteOrigin();
    const digestDate = yesterdayInET();
    const digest = await getDigest("mlb", digestDate);
    if (digest && digest.email_html) {
      const digestUrl = `${origin}/mlb/${digestDate}`;
      const unsubscribeUrl = `${origin}/u/${justActivated.unsubscribe_token}`;
      const manageUrl = `${origin}/settings`;
      const { subject, html, text } = welcomeEmail({
        digestPrettyDate: prettyDate(digestDate),
        digestUrl,
        unsubscribeUrl,
        manageUrl,
        digestEmailHtml: digest.email_html,
      });
      await sendEmail({ to: justActivated.email, subject, html, text });
    }
  } catch (err) {
    console.error("welcome send failed:", (err as Error).message);
  }

  // Auto-sign-in: the click proves they own the inbox, so dropping them
  // straight into /settings (instead of forcing another magic-link round
  // trip) is the right UX. Cookie semantics match /auth/[token]'s POST.
  const { token: sessionToken } = await createSession({
    subscriberId: justActivated.id,
  });
  const res = NextResponse.redirect(new URL("/settings?welcome=1", url));
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

function botPlaceholderHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Confirm — boxscore</title>
<meta name="robots" content="noindex">
</head>
<body style="font-family:system-ui,sans-serif;padding:24px;">
<p>Click your confirmation link in a browser to finish signing up.</p>
</body>
</html>`;
}
