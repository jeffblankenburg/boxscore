// /settings — minimal stub for the auth foundation.
//
// Signed in:    shows the address, plus a "Sign out" button.
// Signed out:   shows an email-entry form that POSTs a magic-link request.
//
// Real settings UI (sport toggles, team picker, billing) lives in follow-up
// work; this page just proves auth works end-to-end.

import { cookies } from "next/headers";
import { validateSession, SUBSCRIBER_SESSION_COOKIE } from "@/lib/subscriber-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { requestSignInLink } from "./actions";

export const metadata = { title: "Settings — boxscore", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const { sent, error } = await searchParams;
  const jar = await cookies();
  const sessionToken = jar.get(SUBSCRIBER_SESSION_COOKIE)?.value;
  const session = await validateSession(sessionToken);

  if (session) {
    const { data: sub } = await supabaseAdmin()
      .from("subscribers")
      .select("email, status")
      .eq("id", session.subscriber_id)
      .maybeSingle<{ email: string; status: string }>();
    const adminEmail = process.env.ADMIN_EMAIL?.toLowerCase();
    const isAdmin = !!sub && !!adminEmail && sub.email.toLowerCase() === adminEmail;
    return (
      <section className="subscribe-card">
        <h1 className="subscribe-h1">Settings</h1>
        <p className="subscribe-lede">
          Signed in as <code>{sub?.email ?? "(unknown)"}</code>.
        </p>
        {isAdmin && (
          <p className="subscribe-fine">
            <a href="/admin">Open admin dashboard →</a>
          </p>
        )}
        <p className="subscribe-fine">
          The full settings UI (sport picker, team customization, billing) is
          on the way. For now this just proves you're signed in.
        </p>
        <form action="/api/auth/logout" method="post" className="subscribe-form">
          <button type="submit" className="subscribe-button">
            Sign out
          </button>
        </form>
      </section>
    );
  }

  if (sent === "1") {
    return (
      <section className="subscribe-card">
        <h1 className="subscribe-h1">Check your inbox</h1>
        <p className="subscribe-lede">
          If that email is registered, a sign-in link is on its way. The link
          works once and expires in 15 minutes.
        </p>
        <p className="subscribe-fine">
          Didn't get it? <a href="/settings">Try again</a>.
        </p>
      </section>
    );
  }

  return (
    <section className="subscribe-card">
      <h1 className="subscribe-h1">Sign in</h1>
      <p className="subscribe-lede">
        Enter the address you subscribed with. We'll email you a one-time
        link.
      </p>
      <form action={requestSignInLink} className="subscribe-form" noValidate>
        <input
          type="email"
          name="email"
          required
          placeholder="you@yourdomain.com"
          autoComplete="email"
          className="subscribe-input"
          aria-label="Email address"
        />
        <button type="submit" className="subscribe-button">
          Send link →
        </button>
      </form>
      {error === "invalid_email" && (
        <p className="subscribe-error">Please enter a valid email address.</p>
      )}
      <p className="subscribe-fine">
        Not a subscriber yet? <a href="/subscribe">Sign up first</a>.
      </p>
    </section>
  );
}
