// /settings — sport opt-in toggles, sign-in flow, sign-out.
//
// Signed in:    shows the address, sport toggles, and a "Sign out" button.
// Signed out:   shows an email-entry form that POSTs a magic-link request.
//
// Admin users (subscribers.is_admin = true) see admin-only sports too,
// which is how dogfood works: an admin opts themselves into NBA/WNBA
// through the real settings flow before those sports are publicized.

import { cookies } from "next/headers";
import { validateSession, SUBSCRIBER_SESSION_COOKIE } from "@/lib/subscriber-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { getVisibleSports } from "@/lib/sports";
import { getLeagueSubscriptions } from "@/lib/email-subscriptions";
import { requestSignInLink, setSportSubscription } from "./actions";

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
      .select("email, status, is_admin")
      .eq("id", session.subscriber_id)
      .maybeSingle<{ email: string; status: string; is_admin: boolean }>();
    const isAdmin = sub?.is_admin === true;

    const [sports, subscriptions] = await Promise.all([
      getVisibleSports({ includeAdminOnly: isAdmin }),
      getLeagueSubscriptions(session.subscriber_id),
    ]);

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

        <h2 className="settings-section-h">Newsletters</h2>
        <p className="subscribe-fine">
          Turn each daily digest on or off. Changes take effect for the next
          send.
        </p>
        <ul className="settings-sport-list">
          {sports.map((sport) => {
            const active = subscriptions.get(sport.id) === true;
            return (
              <li key={sport.id} className="settings-sport-row">
                <span className="settings-sport-name">
                  {sport.name}
                  {sport.visibility === "admin_only" && (
                    <span className="settings-sport-badge"> (admin preview)</span>
                  )}
                </span>
                <form action={setSportSubscription}>
                  <input type="hidden" name="sport" value={sport.id} />
                  <input type="hidden" name="next" value={active ? "off" : "on"} />
                  <button
                    type="submit"
                    className={active ? "settings-toggle-off" : "settings-toggle-on"}
                  >
                    {active ? "Unsubscribe" : "Subscribe"}
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
        {error === "forbidden" && (
          <p className="subscribe-error">That sport isn't available yet.</p>
        )}
        {error === "unknown_sport" && (
          <p className="subscribe-error">Unknown sport.</p>
        )}

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
