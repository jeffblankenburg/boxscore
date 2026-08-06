import { requireAdmin } from "../require-admin";
import { SubmitButton } from "../SubmitButton";
import { adminRoster } from "@/lib/team-hashtags";
import { saveTeamHashtagAction, resetTeamHashtagAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Team hashtags · admin · boxscore", robots: { index: false } };

// Every sport with social captions. Matches lib/social-content.ts.
const SPORTS = ["mlb", "nba", "wnba", "nfl", "ncaaf"] as const;
const SPORT_LABEL: Record<string, string> = {
  mlb: "MLB", nba: "NBA", wnba: "WNBA", nfl: "NFL", ncaaf: "College Football",
};

export default async function AdminHashtagsPage({
  searchParams,
}: {
  searchParams: Promise<{ sport?: string; ok?: string; error?: string }>;
}) {
  await requireAdmin();
  const { sport: rawSport, ok, error } = await searchParams;
  const sport = (SPORTS as readonly string[]).includes(rawSport ?? "") ? rawSport! : "mlb";

  const rows = await adminRoster(sport);
  const overrides = rows.filter((r) => r.isOverride).length;
  const missing = rows.filter((r) => !r.current).length;

  return (
    <main className="admin admin-wide">
      <h1>Team hashtags</h1>
      {ok && <p className="admin-success"><strong>✓</strong> {ok}</p>}
      {error && <p className="admin-error"><strong>Error:</strong> {error}</p>}

      <form method="get" className="admin-regen-form">
        <label>
          League:{" "}
          <select name="sport" defaultValue={sport} className="admin-input">
            {SPORTS.map((s) => (
              <option key={s} value={s}>{SPORT_LABEL[s]}</option>
            ))}
          </select>
        </label>
        <SubmitButton idleLabel="Switch" pendingLabel="Loading…" />
      </form>

      <p className="admin-meta">
        {rows.length} teams · {overrides} edited · {missing} with no official tag.
        The <b>always-on</b> tags (nickname + abbreviation) always post; the{" "}
        <b>official</b> rally tag is optional and editable here. Changes take effect
        on the next Twitter/BlueSky post (Discord posts to channels, not hashtags).
      </p>

      <table className="admin-hashtag-table">
        <thead>
          <tr>
            <th>Team</th>
            <th>Always-on</th>
            <th>Official #</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td className="ht-team">
                {r.label}
                {r.isCustom && <span className="ht-flag"> added</span>}
                {r.isOverride && !r.isCustom && <span className="ht-flag"> edited</span>}
              </td>
              <td className="ht-derived">{r.derived.join(" ")}</td>
              <td className="ht-official">
                <form action={saveTeamHashtagAction} className="ht-form">
                  <input type="hidden" name="sport" value={sport} />
                  <input type="hidden" name="teamKey" value={r.key} />
                  <input type="hidden" name="label" value={r.label} />
                  <span className="ht-hash">#</span>
                  <input
                    className="admin-input ht-input"
                    name="official"
                    defaultValue={r.current ?? ""}
                    placeholder="none"
                    autoComplete="off"
                  />
                  <SubmitButton idleLabel="Save" pendingLabel="…" />
                </form>
              </td>
              <td className="ht-reset">
                {r.isOverride && (
                  <form action={resetTeamHashtagAction}>
                    <input type="hidden" name="sport" value={sport} />
                    <input type="hidden" name="teamKey" value={r.key} />
                    <button className="admin-btn admin-btn-ghost admin-btn-small" type="submit">
                      Reset
                    </button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {sport === "ncaaf" && (
        <>
          <h2 className="ht-add-h">Add a team</h2>
          <p className="admin-meta">
            FBS teams that aren't listed above (they weren't in the research pass)
            can be added here. Use the school name as it appears in scoreboards
            (e.g. <code>Appalachian State</code>, <code>Coastal Carolina</code>).
          </p>
          <form action={saveTeamHashtagAction} className="admin-regen-form">
            <input type="hidden" name="sport" value={sport} />
            <input className="admin-input" name="label" placeholder="School name" required autoComplete="off" />
            <input className="admin-input" name="official" placeholder="Official hashtag (no #)" autoComplete="off" />
            <SubmitButton idleLabel="Add" pendingLabel="Adding…" />
          </form>
        </>
      )}
    </main>
  );
}
