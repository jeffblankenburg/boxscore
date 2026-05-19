import { getVisibleSports } from "@/lib/sports";

// Renders the league badge strip that lives under the main admin nav on
// every admin page. Reads from the sports table so admin-only sports show
// up here (admin context bypasses public visibility), and freshly-launched
// public sports appear without a code change.
//
// `active` is the sport id of the current page (e.g. "mlb" on /admin/mlb).
// Pages that aren't sport-specific (e.g. /admin, /admin/sports) omit it and
// no badge is highlighted.

// Quick visual marker per sport. Hardcoded here rather than a sports-table
// column — adding a sport is already a code touch (renderer config, etc.),
// so one more line in this map is no extra burden, and it keeps the table
// schema small. NBA and WNBA intentionally share the basketball emoji; the
// league name + left-edge color stripe carry the disambiguation.
const SPORT_EMOJI: Record<string, string> = {
  mlb: "\u26BE",   // ⚾
  nba: "\u{1F3C0}", // 🏀
  wnba: "\u{1F3C0}", // 🏀
};

export async function LeagueSwitcher({ active }: { active?: string }) {
  const sports = await getVisibleSports({ includeAdminOnly: true });
  if (sports.length === 0) return null;
  return (
    <nav className="league-switcher" aria-label="League dashboards">
      {sports.map((s) => {
        const emoji = SPORT_EMOJI[s.id];
        return (
          <a
            key={s.id}
            href={`/admin/${s.id}`}
            className={`league-badge league-badge-${s.id}${active === s.id ? " active" : ""}`}
          >
            {emoji && <span className="league-badge-emoji" aria-hidden="true">{emoji}</span>}
            <span>{s.name}</span>
          </a>
        );
      })}
    </nav>
  );
}
