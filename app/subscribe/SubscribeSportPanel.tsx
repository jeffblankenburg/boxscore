import { digestFrequency } from "@/lib/digest-frequency";

// One sport's tab on /subscribe — mirrors /settings' SportPanel layout (heading
// + cadence, then League / Conferences / Teams), but the controls are plain
// form checkboxes submitted with the signup form (name="leagues"/"conferences"/
// "teams") rather than the instant server-action toggles /settings uses for an
// already-authenticated subscriber.

type TeamRow = { slug: string; name: string };
type ConferenceRow = { slug: string; name: string };

export function SubscribeSportPanel({
  sportId,
  sportLabel,
  teams,
  conferences = [],
}: {
  sportId: string;
  sportLabel: string;
  teams: TeamRow[];
  conferences?: ConferenceRow[];
}) {
  // NCAAF's league digest is the Top 25 recap.
  const leagueName = sportId === "ncaaf" ? "Top 25" : "league";

  return (
    <div className="settings-panel">
      <h3 className="settings-panel-h">
        {sportLabel} {sportId === "ncaaf" ? "Top 25 " : ""}digest
      </h3>
      <p className="settings-freq">{digestFrequency(sportId)}</p>
      <ul className="settings-sport-list">
        <li className="settings-sport-row">
          <label className="settings-pick-label">
            <input type="checkbox" name="leagues" value={sportId} defaultChecked={sportId === "mlb"} />
            <span>Email me the {sportLabel} {leagueName} digest</span>
          </label>
        </li>
      </ul>

      {conferences.length > 0 && (
        <>
          <h3 className="settings-panel-h">Conferences</h3>
          <p className="subscribe-fine">
            Each conference has its own daily digest — scores, standings, and box
            scores for that conference. Independent of the Top 25 and team emails.
          </p>
          <ul className="settings-sport-list">
            {conferences.map((c) => (
              <li key={c.slug} className="settings-sport-row">
                <label className="settings-pick-label">
                  <input type="checkbox" name="conferences" value={`${sportId}:${c.slug}`} />
                  <span>{c.name}</span>
                </label>
                <a
                  href={`/${sportId}/conference/${c.slug}`}
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
      )}

      {teams.length > 0 && (
        <>
          <h3 className="settings-panel-h">Teams</h3>
          <p className="subscribe-fine">
            Each team has its own daily email — yesterday&rsquo;s game (or a
            standings roundup on off-days). Subscribe to any, all, or none.
          </p>
          <ul className="settings-sport-list">
            {teams.map((t) => (
              <li key={t.slug} className="settings-sport-row">
                <label className="settings-pick-label">
                  <input type="checkbox" name="teams" value={`${sportId}:${t.slug}`} />
                  <span>{t.name}</span>
                </label>
                <a
                  href={`/${sportId}/${t.slug}`}
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
      )}
    </div>
  );
}
