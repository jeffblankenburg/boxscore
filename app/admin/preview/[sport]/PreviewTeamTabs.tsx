import { teamsBySport, type Sport } from "@/lib/teams";

// Secondary nav under the league switcher on /admin/preview. First tab is
// always "LEAGUE" — links back to the per-league preview (mode / surface /
// width controls). Remaining tabs are one-per-team using their three-
// letter abbreviation, sorted by abbreviation so finding a team is alpha-
// scan-fast. Active tab is highlighted via `activeTeam` ("league" by
// default; a team slug when on a team-preview page).
//
// Only renders teams for sports that have a team-digest pipeline; passes
// through empty when teamsBySport returns nothing (e.g. NBA today).
export function PreviewTeamTabs({
  sport,
  activeTeam,
}: {
  sport: string;
  activeTeam: string; // "league" or a team slug
}) {
  const teams = teamsBySport(sport as Sport)
    .slice()
    .sort((a, b) => a.abbreviation.localeCompare(b.abbreviation));
  if (teams.length === 0) return null;

  const leagueHref = `/admin/preview/${sport}`;
  return (
    <nav className="preview-team-tabs" aria-label="Team preview navigation">
      <a
        href={leagueHref}
        className={activeTeam === "league" ? "active" : undefined}
      >
        LEAGUE
      </a>
      {teams.map((t) => {
        const isActive = activeTeam === t.slug;
        // Team primary color tints the tab: full color + white text when
        // active, ~12% tint background with the color as a left border
        // when inactive. Admin-only — public surfaces stay monochrome.
        const style: React.CSSProperties = t.primary
          ? isActive
            ? { background: t.primary, color: "#fff", borderColor: t.primary }
            : {
                borderLeft: `3px solid ${t.primary}`,
                background: `${t.primary}1F`, // 1F hex = ~12% alpha
              }
          : {};
        return (
          <a
            key={t.slug}
            href={`/admin/preview/${sport}/${t.slug}`}
            className={isActive ? "active" : undefined}
            style={style}
            title={t.name}
          >
            {t.abbreviation}
          </a>
        );
      })}
    </nav>
  );
}
