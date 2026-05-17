// GET /auth/[token] — show a "Sign in" button. We never grant a session on
// GET so link-prefetchers (Gmail/Outlook safety scanners, link previews,
// Slack unfurls) can't claim the token on the user's behalf.
//
// POST (form action) — atomically consume the token and create a session.

import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import {
  consumeMagicToken,
  createSession,
  SUBSCRIBER_SESSION_COOKIE,
  SUBSCRIBER_SESSION_TTL_SEC,
} from "@/lib/subscriber-auth";

export const metadata = { title: "Sign in — boxscore", robots: { index: false } };
export const dynamic = "force-dynamic";

// 256-bit random base64url tokens are 43 chars of [A-Za-z0-9_-].
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export default async function AuthLinkPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  if (!TOKEN_RE.test(token)) notFound();
  const { error } = await searchParams;

  async function doSignIn() {
    "use server";
    const claim = await consumeMagicToken(token);
    if (!claim) {
      redirect(`/auth/${token}?error=expired`);
    }
    const { token: sessionToken } = await createSession({ subscriberId: claim.subscriberId });
    const jar = await cookies();
    jar.set({
      name: SUBSCRIBER_SESSION_COOKIE,
      value: sessionToken,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SUBSCRIBER_SESSION_TTL_SEC,
    });
    redirect("/settings");
  }

  return (
    <section className="subscribe-card">
      <h1 className="subscribe-h1">Sign in to boxscore</h1>
      {error === "expired" ? (
        <>
          <p className="subscribe-lede">
            This link is no longer valid. Sign-in links expire after 15 minutes
            and can only be used once.
          </p>
          <p className="subscribe-fine">
            <a href="/settings">Request a fresh link →</a>
          </p>
        </>
      ) : (
        <>
          <p className="subscribe-lede">
            Click below to sign in. The link is good for 15 minutes and only
            works once.
          </p>
          <form action={doSignIn} className="subscribe-form">
            <button type="submit" className="subscribe-button">
              Sign in
            </button>
          </form>
          <p className="subscribe-fine">
            Didn't ask for this link? Just close the tab — nothing changes
            unless you click the button.
          </p>
        </>
      )}
    </section>
  );
}
