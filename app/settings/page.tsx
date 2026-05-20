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
import {
  getLeagueSubscriptions,
  getTeamSubscriptions,
} from "@/lib/email-subscriptions";
import { teamsBySport, type Sport } from "@/lib/teams";
import {
  requestSignInLink,
  setSportSubscription,
  setTeamSubscription,
} from "./actions";
import { SettingsToggleCheckbox } from "./SettingsToggleCheckbox";

// Sports that have a per-team digest pipeline wired. Team toggles only
// surface for these on /settings. MLB-only at v1; flip on NBA/WNBA once
// their team renderers exist.
const SPORTS_WITH_TEAM_DIGESTS = new Set<string>(["mlb"]);

export const metadata = { title: "Settings — boxscore", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string; welcome?: string }>;
}) {
  const { sent, error, welcome } = await searchParams;
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

    const [sports, subscriptions, teamSubscriptions] = await Promise.all([
      getVisibleSports({ includeAdminOnly: isAdmin }),
      getLeagueSubscriptions(session.subscriber_id),
      getTeamSubscriptions(session.subscriber_id),
    ]);

    // Build per-sport team sections. Each section's teams are sorted by
    // city alphabetically (per #31 spec).
    const teamSections = sports
      .filter((s) => SPORTS_WITH_TEAM_DIGESTS.has(s.id))
      .map((sport) => ({
        sport,
        teams: teamsBySport(sport.id as Sport)
          .slice()
          .sort((a, b) => a.city.localeCompare(b.city)),
        subs: teamSubscriptions.get(sport.id) ?? new Map<string, boolean>(),
      }));

    return (
      <section className="subscribe-card">
        <h1 className="subscribe-h1">Settings</h1>
        {welcome === "1" && (
          <p className="subscribe-welcome">
            You&rsquo;re in. The boxes you picked at signup are already
            turned on below — toggle anything else on or off, any time.
          </p>
        )}
        <p className="subscribe-lede">
          Signed in as <code>{sub?.email ?? "(unknown)"}</code>.
        </p>
        {/* Sign out lives at the top so it's reachable without scrolling
            past the (long) team list. Matches the Subscribe button styling
            on /subscribe for visual parity between the two pages. The
            subscribe-button-block default top-margin (16px) is doubled by
            the lede's own bottom-margin, so override here for a tight gap.
            Admin dashboard sits below sign out so the two account-control
            buttons aren't crowding each other above the lede. */}
        <form action="/api/auth/logout" method="post" style={{ margin: 0 }}>
          <button
            type="submit"
            className="subscribe-button subscribe-button-block"
            style={{ marginTop: 4 }}
          >
            Sign out →
          </button>
        </form>
        {isAdmin && (
          <a
            href="/admin"
            className="subscribe-button subscribe-button-block subscribe-button-outline"
            style={{ marginTop: 8, textAlign: "center" }}
          >
            Admin Dashboard →
          </a>
        )}

        <h2 className="settings-section-h">Daily League Boxscores</h2>
        <ul className="settings-sport-list">
          {sports.map((sport) => {
            const active = subscriptions.get(sport.id) === true;
            const label = sport.visibility === "admin_only" ? (
              <>
                {sport.name}
                <span className="settings-sport-badge"> (admin preview)</span>
              </>
            ) : sport.name;
            return (
              <li key={sport.id} className="settings-sport-row">
                <SettingsToggleCheckbox
                  active={active}
                  action={setSportSubscription}
                  fields={{ sport: sport.id }}
                  label={label}
                />
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

        {teamSections.length > 0 && (
          <>
            <h2 className="settings-section-h">Daily Team Boxscores</h2>
            <p className="subscribe-fine">
              Each team has its own daily email — yesterday&apos;s game (or a
              standings + transactions roundup on off-days). Independent of
              the league digest above; subscribe to any, all, or none.
            </p>
            {teamSections.map(({ sport, teams, subs }) => (
              <ul key={sport.id} className="settings-sport-list">
                {teams.map((team) => {
                  const active = subs.get(team.slug) === true;
                  return (
                    <li key={team.slug} className="settings-sport-row">
                      <SettingsToggleCheckbox
                        active={active}
                        action={setTeamSubscription}
                        fields={{ sport: sport.id, team: team.slug }}
                        label={team.name}
                      />
                    </li>
                  );
                })}
              </ul>
            ))}
            {error === "unknown_team" && (
              <p className="subscribe-error">Unknown team.</p>
            )}
          </>
        )}
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
      {error === "link_expired" && (
        <p className="subscribe-welcome">
          That sign-in link has expired or already been used. Enter your
          email below and we&rsquo;ll send a fresh one.
        </p>
      )}
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
