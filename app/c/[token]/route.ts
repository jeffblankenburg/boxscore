// GET /c/[token] — confirmation link from the welcome email.
//
// Handler (not a page) because we need to set a session cookie on real-user
// activations so we can drop them straight into /settings. Server Components
// can read cookies but not write them; the cookie-set has to live in a route
// handler or server action.
//
// No bot/prefetch detection. The earlier version AND-gated isLikelyBot,
// Sec-Fetch-User, and Sec-Fetch-Dest — but mobile Gmail in-app browsers,
// iOS Safari < 16.4, and Google's link-redirector wrapper all fail at
// least one of those signals, so legitimate first-click activations from
// phones were getting blocked with a "click your confirmation link in a
// browser" placeholder. The trade was wrong: blocking marginal prefetcher
// activations cost real conversion. Activating a subscriber who already
// opted in — even slightly early via a prefetcher — costs nothing. The
// confirmSubscriberIfPending transition is atomic so a prefetch + a real
// click both reach the right end state.
//
// Branches:
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
// A prefetcher that races ahead of the human will see "already active" on
// the human's later click — the human lands on /settings with a magic-link
// prompt, same as any returning subscriber.

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
import { EMAIL_LINK_BASE } from "@/lib/site";
import { getDigest } from "@/lib/digests";
import { nextDay, yesterdayInET, prettyDate } from "@/lib/dates";

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
    const digestDate = yesterdayInET();
    const digest = await getDigest("mlb", digestDate);
    if (digest && digest.email_html) {
      // Public URL uses edition_date (games_date + 1).
      const digestUrl = `${EMAIL_LINK_BASE}/mlb/${nextDay(digestDate)}`;
      const unsubscribeUrl = `${EMAIL_LINK_BASE}/u/${justActivated.unsubscribe_token}`;
      const manageUrl = `${EMAIL_LINK_BASE}/settings`;
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
  // Belt-and-suspenders: also forbid caching on the activation redirect
  // itself so no intermediary serves a stale 302 to a later visitor.
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  return res;
}
