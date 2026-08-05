import { SettingsToggleCheckbox } from "./SettingsToggleCheckbox";
import { setSportSubscription, setConferenceSubscription } from "./actions";
import { TeamPicker } from "./TeamPicker";

// One sport's tab on /settings: the league-digest toggle + the team list. All
// sports now carry a real team registry (NCAAF/NHL added from ESPN), so teams
// are subscribable wherever the sport is available to the viewer — MLB for
// everyone, preview sports for admins. Non-admins see the preview lists
// read-only until each sport launches. NCAAF adds a middle Conference tier and
// labels its league digest the "Top 25".

type TeamRow = { slug: string; name: string; conference?: string };
type ConferenceRow = { slug: string; name: string };

export function SportPanel({
  sportId,
  sportLabel,
  available,
  leagueSubscribed,
  teams,
  teamSubs,
  conferences = [],
  confSubs = new Map<string, boolean>(),
}: {
  sportId: string;
  sportLabel: string;
  available: boolean;
  leagueSubscribed: boolean;
  teams: TeamRow[];
  teamSubs: Map<string, boolean>;
  conferences?: ConferenceRow[];
  confSubs?: Map<string, boolean>;
}) {
  const subs = Object.fromEntries(teamSubs); // plain object for the client component
  // NCAAF's league digest IS the Top 25 recap — name it that so the three
  // tiers (Top 25 / Conference / Team) read clearly.
  const leagueName = sportId === "ncaaf" ? "Top 25" : "league";

  return (
    <div className="settings-panel">
      <h3 className="settings-panel-h">
        Daily {sportLabel} {sportId === "ncaaf" ? "Top 25 " : ""}digest
      </h3>
      {available ? (
        <ul className="settings-sport-list">
          <li className="settings-sport-row">
            <SettingsToggleCheckbox
              active={leagueSubscribed}
              action={setSportSubscription}
              fields={{ sport: sportId }}
              label={`Email me the ${sportLabel} ${leagueName} digest`}
            />
          </li>
        </ul>
      ) : (
        <p className="subscribe-fine">
          {`${sportLabel} isn't live yet — coming soon. You'll subscribe to the daily ${sportLabel} ${leagueName} digest right here.`}
        </p>
      )}

      {conferences.length > 0 && (
        <>
          <h3 className="settings-panel-h">Conferences</h3>
          <p className="subscribe-fine">
            {available
              ? "Each conference has its own daily digest — scores, standings, and box scores for that conference. Subscribe to any, independent of the Top 25 and team emails."
              : `A preview of the conferences — you'll be able to subscribe when ${sportLabel} launches.`}
          </p>
          {available ? (
            <ul className="settings-sport-list">
              {conferences.map((c) => (
                <li className="settings-sport-row" key={c.slug}>
                  <SettingsToggleCheckbox
                    active={confSubs.get(c.slug) === true}
                    action={setConferenceSubscription}
                    fields={{ sport: sportId, conference: c.slug }}
                    label={`${c.name} digest`}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <ul className="settings-sport-list settings-preview-list">
              {conferences.map((c) => (
                <li className="settings-sport-row" key={c.slug}>
                  <span className="settings-preview-name">{c.name}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {teams.length > 0 ? (
        <>
          <h3 className="settings-panel-h">{sportId === "mlb" ? "Team emails" : "Teams"}</h3>
          <p className="subscribe-fine">
            {available
              ? "Each team has its own daily email. Subscribe to any, all, or none — independent of the league digest above."
              : `A preview of the teams — you'll be able to subscribe when ${sportLabel} launches.`}
          </p>
          <TeamPicker
            sportId={sportId}
            teams={teams}
            subs={subs}
            grouped={sportId === "ncaaf"}
            canSubscribe={available}
            showPreview={sportId === "mlb"}
          />
        </>
      ) : (
        <p className="subscribe-fine">Team-specific emails are coming soon for {sportLabel}.</p>
      )}

      <PredictionsLine sportId={sportId} available={sportId === "mlb"} />
    </div>
  );
}

// Compact predictions entry per sport. MLB links to the storefront; the full
// per-sport subscription cards live in the dedicated Predictions tab.
function PredictionsLine({ sportId, available }: { sportId: string; available: boolean }) {
  return (
    <div className="settings-pred-line">
      <span className="settings-pred-label">Predictions</span>
      {available ? (
        <a href={`/${sportId}/predictions`} className="settings-pred-link">View &amp; subscribe →</a>
      ) : (
        <span className="ps-soon-tag">Coming soon</span>
      )}
    </div>
  );
}
