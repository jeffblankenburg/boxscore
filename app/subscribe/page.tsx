import { subscribe } from "./actions";
import AttributionFields from "./AttributionFields";
import { getVisibleSports } from "@/lib/sports";
import { teamsBySport, type Sport } from "@/lib/teams";

// Sports with a per-team digest pipeline (generate loop + send-team-email).
// NBA/WNBA/NCAAF join once their team renderers ship. Filtered by visibility
// below, so a sport's teams only appear once it's also public. When the
// surviving list has more than one entry the section becomes a tabbed picker;
// one entry renders the team list inline.
const TEAM_TAB_SPORTS: Array<{ id: Sport; label: string }> = [
  { id: "mlb", label: "MLB" },
  { id: "nfl", label: "NFL" },
];

export const metadata = {
  title: "Subscribe — boxscore",
  description: "Daily sports digests in your inbox.",
};

export default async function SubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; reason?: string }>;
}) {
  const { error, reason } = await searchParams;

  // Public sports only — admin_only sports stay hidden until their pipeline
  // is ready. Flip to includeAdminOnly: true when previewing upcoming
  // sports on the public picker again.
  const sports = await getVisibleSports({ includeAdminOnly: false });
  // Team pickers only for sports that are BOTH public and have a team pipeline.
  const visibleIds = new Set(sports.map((s) => s.id));
  const teamTabs = TEAM_TAB_SPORTS.filter((t) => visibleIds.has(t.id)).map(({ id, label }) => ({
    id,
    label,
    teams: teamsBySport(id).slice().sort((a, b) => a.city.localeCompare(b.city)),
  }));

  return (
    <section className="subscribe-card">
      <h1 className="subscribe-h1">Subscribe to boxscore</h1>
      <p className="subscribe-fine">
        Already subscribed? <a href="/settings">Manage your subscriptions →</a>
      </p>
      {reason === "unsubscribed" && (
        <p className="subscribe-welcome">
          That address previously unsubscribed. Pick what you want below and
          we&rsquo;ll send a fresh confirmation link to get you back on the
          list.
        </p>
      )}
      <p className="subscribe-lede">
        Like the sports pages we used to read every day. Standings, full box
        scores, league leaders — in your inbox early every morning.
      </p>

      <form action={subscribe} noValidate>
        <AttributionFields />
        <input
          type="email"
          name="email"
          required
          placeholder="you@yourdomain.com"
          autoComplete="email"
          className="subscribe-input subscribe-input-block"
          aria-label="Email address"
        />

        <button type="submit" className="subscribe-button subscribe-button-block">
          Subscribe →
        </button>
        <p className="subscribe-fine">
          We&rsquo;ll send one confirmation email. After you click the link,
          you&rsquo;re in. Unsubscribe in one click, any time.
        </p>

        <h2 className="settings-section-h">Daily League Boxscores</h2>
        <ul className="settings-sport-list">
          {sports.map((sport) => (
            <li key={sport.id} className="settings-sport-row">
              <label className="settings-pick-label">
                <input
                  type="checkbox"
                  name="leagues"
                  value={sport.id}
                  defaultChecked={sport.id === "mlb"}
                />
                <span>{sport.name}</span>
              </label>
            </li>
          ))}
        </ul>

        <h2 className="settings-section-h">Daily Team Boxscores</h2>
        <p className="subscribe-fine">
          Each team has its own daily email — yesterday&rsquo;s game (or a
          standings + transactions roundup on off-days). Independent of the
          league digest above; subscribe to any, all, or none.
        </p>
        {teamTabs.length === 1 ? (
          // Single-sport simplification: skip the tab chrome when MLB is the
          // only sport with a team picker. Restores the flat list look while
          // keeping the value="sport:slug" wire format so the action still
          // routes picks correctly.
          <ul className="settings-sport-list">
            {teamTabs[0]!.teams.map((team) => (
              <li key={team.slug} className="settings-sport-row">
                <label className="settings-pick-label">
                  <input
                    type="checkbox"
                    name="teams"
                    value={`${teamTabs[0]!.id}:${team.slug}`}
                  />
                  <span>{team.name}</span>
                </label>
                <a
                  href={`/${teamTabs[0]!.id}/${team.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="settings-preview-link"
                >
                  Preview →
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <div className="team-tabs">
            {/* Radio inputs drive the tabs via CSS — no JS needed. Inputs are
                named the same so only one is "active" at a time. Their value
                isn't read server-side; the action only consumes "leagues" and
                "teams" fields. */}
            {teamTabs.map((tab, i) => (
              <input
                key={`input-${tab.id}`}
                type="radio"
                name="team-tab"
                id={`tab-${tab.id}`}
                className="team-tab-input"
                defaultChecked={i === 0}
              />
            ))}
            <div className="team-tab-strip">
              {teamTabs.map((tab) => (
                <label
                  key={`label-${tab.id}`}
                  htmlFor={`tab-${tab.id}`}
                  className="team-tab-label"
                >
                  {tab.label}
                </label>
              ))}
            </div>
            {teamTabs.map((tab) => (
              <div
                key={`panel-${tab.id}`}
                className="team-tab-panel"
                data-sport={tab.id}
              >
                <ul className="settings-sport-list">
                  {tab.teams.map((team) => (
                    <li key={team.slug} className="settings-sport-row">
                      <label className="settings-pick-label">
                        <input
                          type="checkbox"
                          name="teams"
                          value={`${tab.id}:${team.slug}`}
                        />
                        <span>{team.name}</span>
                      </label>
                      <a
                        href={`/${tab.id}/${team.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="settings-preview-link"
                      >
                        Preview →
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

      </form>

      {error === "invalid_email" && (
        <p className="subscribe-error">Please enter a valid email address.</p>
      )}
      {error === "no_picks" && (
        <p className="subscribe-error">
          Pick at least one newsletter or team to subscribe to.
        </p>
      )}
      <p className="subscribe-fine">
        Prefer a feed reader? Subscribe via RSS: <a href="/rss/mlb"><code>boxscore.email/rss/mlb</code></a>
      </p>
    </section>
  );
}
