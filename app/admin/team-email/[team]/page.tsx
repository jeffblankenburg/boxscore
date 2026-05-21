import { notFound } from "next/navigation";
import { nextDay, yesterdayInET, prettyDate } from "@/lib/dates";
import { siteOrigin } from "@/lib/site";
import { findTeam, teamsBySport, type Team } from "@/lib/teams";
import { loadTeamEmailData, renderTeamEmailContent } from "@/lib/render-team-email";
import { teamDailyEmail } from "@/lib/emails/templates";
import { requireAdmin } from "../../require-admin";
import { AdminNav } from "../../AdminNav";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Team email preview · admin · boxscore",
  robots: { index: false },
};

export default async function AdminTeamEmailPreview({
  params,
}: {
  params: Promise<{ team: string }>;
}) {
  await requireAdmin();
  const { team: slug } = await params;
  const team = findTeam("mlb", slug);
  if (!team) notFound();

  const allTeams = teamsBySport("mlb");
  const date = yesterdayInET();
  const origin = await siteOrigin();

  let body: string;
  let renderError: string | null = null;
  try {
    const data = await loadTeamEmailData(team, date);
    body = renderTeamEmailContent(data);
  } catch (err) {
    renderError = (err as Error).message;
    body = "";
  }

  const { getAnnouncement } = await import("@/lib/announcements");
  const announcementBanner = (await getAnnouncement("mlb", date)) ?? undefined;
  const { html, subject } = teamDailyEmail({
    teamName: team.name,
    digestDate: date,
    digestPrettyDate: prettyDate(date),
    digestUrl: `${origin}/mlb/${team.slug}/${nextDay(date)}`,
    unsubscribeUrl: `${origin}/u/admin-preview`,
    manageUrl: `${origin}/settings`,
    announcementBanner,
    digestEmailHtml: body,
  });

  return (
    <main className="admin admin-wide">
      <AdminNav />
      <h1>Team email preview · {team.name}</h1>
      <TeamPicker teams={allTeams} current={team.slug} />
      {renderError ? (
        <p className="admin-error">
          <strong>Render failed:</strong> {renderError}
        </p>
      ) : (
        <p className="admin-meta">
          {prettyDate(date)} · {(html.length / 1024).toFixed(1)} KB · Subject:{" "}
          <code>{subject}</code>
        </p>
      )}
      <iframe
        srcDoc={html}
        className="admin-email-frame"
        title={`Team email preview for ${team.name}`}
      />
    </main>
  );
}

function TeamPicker({ teams, current }: { teams: Team[]; current: string }) {
  return (
    <div className="admin-team-picker">
      {teams.map((t) => (
        <a
          key={t.slug}
          href={`/admin/team-email/${t.slug}`}
          className={t.slug === current ? "current" : undefined}
          title={t.name}
        >
          {t.abbreviation}
        </a>
      ))}
    </div>
  );
}
