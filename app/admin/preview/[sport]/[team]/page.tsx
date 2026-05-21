import { notFound } from "next/navigation";
import { requireAdmin } from "../../../require-admin";
import { AdminNav } from "../../../AdminNav";
import { PreviewTeamTabs } from "../PreviewTeamTabs";
import { DateInputWithToday } from "../DateInputWithToday";
import { findTeam, type Sport } from "@/lib/teams";
import { yesterdayInET, isValidIsoDate, nextDay, prevDay, shortPrettyDate } from "@/lib/dates";

// Per-team variant of /admin/preview/[sport]. Same chrome (AdminNav,
// LeagueSwitcher, PreviewTeamTabs) as the league preview; controls below
// pick the team's date (not a mode), surface (web/email), and width.
//
// Web surface points the iframe at the public page at /{sport}/{slug}/{date}
// — it already renders the cached team digest with the site chrome. Email
// surface points at /admin/preview/[sport]/[team]/frame for the email
// rendering. This avoids duplicating the team's web renderer here.

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Team preview · admin · boxscore",
  robots: { index: false },
};

const VALID_SPORTS = new Set(["mlb", "nba", "wnba"]);

const WIDTH_PRESETS: Array<{ key: string; label: string; px: number | null }> = [
  { key: "mobile", label: "Mobile", px: 375 },
  { key: "email", label: "Email", px: 600 },
  { key: "tablet", label: "Tablet", px: 768 },
  { key: "laptop", label: "Laptop", px: 1024 },
  { key: "full", label: "Full", px: null },
];

function asWidth(s: string | undefined, surface: "web" | "email"): string {
  const valid = new Set(WIDTH_PRESETS.map((p) => p.key));
  if (s && valid.has(s)) return s;
  return surface === "email" ? "email" : "full";
}

export default async function TeamPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ sport: string; team: string }>;
  searchParams: Promise<{ date?: string; surface?: string; width?: string }>;
}) {
  await requireAdmin();
  const { sport, team: slug } = await params;
  if (!VALID_SPORTS.has(sport)) notFound();
  const team = findTeam(sport as Sport, slug);
  if (!team) notFound();

  const { date: dateParam, surface: surfaceParam, width: widthParam } = await searchParams;
  // `date` is the EDITION date the operator sees on the masthead; the
  // team digest URL and frame route both expect games_date, so we
  // translate at the boundary.
  const todayIsoEt = nextDay(yesterdayInET());
  const date = dateParam && isValidIsoDate(dateParam) ? dateParam : todayIsoEt;
  const gamesDate = prevDay(date);
  const surface: "web" | "email" = surfaceParam === "email" ? "email" : "web";
  const width = asWidth(widthParam, surface);
  const widthPx = WIDTH_PRESETS.find((p) => p.key === width)?.px ?? null;

  const frameSrc = surface === "web"
    ? `/${sport}/${team.slug}/${gamesDate}`
    : `/admin/preview/${sport}/${team.slug}/frame?date=${gamesDate}`;

  const link = (overrides: { date?: string; surface?: "web" | "email"; width?: string }) => {
    const d = overrides.date ?? date;
    const s = overrides.surface ?? surface;
    const w = overrides.width ?? width;
    return `/admin/preview/${sport}/${team.slug}?date=${d}&surface=${s}&width=${w}`;
  };

  const containerStyle: React.CSSProperties = widthPx
    ? { maxWidth: `${widthPx}px`, margin: "0 auto" }
    : {};
  // Mirrors teamDailyEmail in lib/emails/templates.ts.
  const emailSubject = `${team.name} - ${shortPrettyDate(date)}`;

  return (
    <main className="admin admin-preview">
      <AdminNav activeSport={sport} active="preview" leagueBasePath="/admin/preview" />
      <PreviewTeamTabs sport={sport} activeTeam={team.slug} />
      <div className="preview-shell">
        <section className="preview-main">
          <div className="preview-bar">
            <form method="get" className="preview-date-form">
              <DateInputWithToday defaultValue={date} />
              <input type="hidden" name="surface" value={surface} />
              <input type="hidden" name="width" value={width} />
              <button type="submit" className="admin-btn admin-btn-small">
                Go
              </button>
            </form>
            <div className="preview-toggle">
              <a
                className={surface === "web" ? "active" : ""}
                href={link({ surface: "web" })}
              >
                Web
              </a>
              <a
                className={surface === "email" ? "active" : ""}
                href={link({ surface: "email" })}
              >
                Email
              </a>
            </div>
            <div className="preview-toggle">
              {WIDTH_PRESETS.map((p) => (
                <a
                  key={p.key}
                  className={width === p.key ? "active" : ""}
                  href={link({ width: p.key })}
                >
                  {p.label}
                </a>
              ))}
            </div>
            <a
              className="preview-popout"
              href={frameSrc}
              target="_blank"
              rel="noopener noreferrer"
              title="Open at full window width in a new tab"
            >
              Pop out ↗
            </a>
            <div className="preview-meta">
              <code>{date}</code>
            </div>
          </div>

          {surface === "email" && (
            <div className="preview-subject">
              <span className="preview-subject-label">Subject</span>
              <span className="preview-subject-text">{emailSubject}</span>
            </div>
          )}

          <iframe
            className={surface === "web" ? "preview-web-frame" : "preview-email-frame"}
            style={containerStyle}
            src={frameSrc}
            title={`${surface} preview for ${team.name}`}
          />
        </section>
      </div>
    </main>
  );
}
