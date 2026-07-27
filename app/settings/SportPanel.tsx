import { SettingsToggleCheckbox } from "./SettingsToggleCheckbox";
import { setSportSubscription, setTeamSubscription } from "./actions";
import { PreviewTeams } from "./PreviewTeams";
import previewTeamsJson from "@/lib/preview-teams.generated.json";

// Display-only team lists (grouped by conference) for preview sports, pulled
// from ESPN — see scripts/gen-preview-teams.ts. Subscribing opens when the
// sport launches; these are a preview only (Jeff's note).
const PREVIEW_TEAMS = previewTeamsJson as Record<string, { name: string; teams: string[] }[]>;

// One sport's tab on /settings: the league-digest toggle, per-team toggles
// (only where team digests exist — MLB today), and a Predictions line item.
// Sports not yet live (admin-only for this user, or NHL which doesn't exist
// yet) render a coming-soon panel.

type TeamRow = { slug: string; name: string };

export function SportPanel({
  sportId,
  sportLabel,
  available,
  leagueSubscribed,
  teams,
  teamSubs,
}: {
  sportId: string;
  sportLabel: string;
  available: boolean;
  leagueSubscribed: boolean;
  teams: TeamRow[];
  teamSubs: Map<string, boolean>;
}) {
  if (!available) {
    const groups = PREVIEW_TEAMS[sportId] ?? [];
    return (
      <div className="settings-panel">
        <p className="subscribe-fine">
          {`${sportLabel} isn't live yet — coming soon. You'll subscribe to the daily ${sportLabel} digest right here.`}
        </p>
        {groups.length > 0 && (
          <>
            <h3 className="settings-panel-h">Teams</h3>
            <p className="subscribe-fine">
              A preview of the teams — team emails open when {sportLabel} launches.
            </p>
            <PreviewTeams groups={groups} grouped={sportId === "ncaaf"} />
          </>
        )}
        <PredictionsLine sportId={sportId} available={false} />
      </div>
    );
  }

  return (
    <div className="settings-panel">
      <h3 className="settings-panel-h">Daily {sportLabel} digest</h3>
      <ul className="settings-sport-list">
        <li className="settings-sport-row">
          <SettingsToggleCheckbox
            active={leagueSubscribed}
            action={setSportSubscription}
            fields={{ sport: sportId }}
            label={`Email me the ${sportLabel} league digest`}
          />
        </li>
      </ul>

      {teams.length > 0 ? (
        <>
          <h3 className="settings-panel-h">Team emails</h3>
          <p className="subscribe-fine">
            Each team has its own daily email — yesterday&apos;s game (or a standings +
            transactions roundup on off-days). Independent of the league digest above.
          </p>
          <ul className="settings-sport-list">
            {teams.map((team) => (
              <li key={team.slug} className="settings-sport-row">
                <SettingsToggleCheckbox
                  active={teamSubs.get(team.slug) === true}
                  action={setTeamSubscription}
                  fields={{ sport: sportId, team: team.slug }}
                  label={team.name}
                />
                <a
                  href={`/${sportId}/${team.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="settings-preview-link"
                >
                  Preview →
                </a>
              </li>
            ))}
          </ul>
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
