// Football team page/digest renderer. Composes the shared daily-digest
// renderers (renderGameBlock for the box, renderStandingsGroup for the
// division) with a team heading, an upcoming-schedule list, and a compact
// "this team's players in the league leaders" block. Pure: team data in,
// HTML out. Mirrors the MLB team page section order — heading, standings,
// most-recent box, upcoming — with the football-appropriate leaders section
// standing in for MLB's full roster stat sheet.
//
// The `web` flag mirrors the daily digest: web = relative links; email =
// absolute EMAIL_LINK_BASE links (renderFootballTeamEmailContent). Used by
// the live web page and by the generate cron's per-team email body.

import {
  renderGameBlock,
  renderStandingsGroup,
  NFL_STANDINGS_COLS,
  mascot,
  escapeHtml,
  linkAnchor,
} from "./digest";
import { footballPlayerPath, lastNameOf } from "../player-links";
import type { FootballTeamPageData } from "../team-canonical";
import type { FootballGame, FootballStandingsRow } from "../types";

// "Sun, Jan 4, 1:00 PM ET" — weekday + date + kickoff, in ET.
function kickoffLabel(iso: string): string {
  if (!iso) return "TBD";
  try {
    return (
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }).format(new Date(iso)) + " ET"
    );
  } catch {
    return "TBD";
  }
}

function recordLine(r: FootballStandingsRow): string {
  const base = r.ties > 0 ? `${r.wins}-${r.losses}-${r.ties}` : `${r.wins}-${r.losses}`;
  return r.streak ? `${base}, ${r.streak}` : base;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!);
}

function renderHeading(data: FootballTeamPageData): string {
  const sub: string[] = [];
  if (data.record) sub.push(recordLine(data.record));
  if (data.divisionRank != null && data.divisionGroup) {
    sub.push(`${ordinal(data.divisionRank)} in ${escapeHtml(data.divisionGroup.group)}`);
  }
  return `
<header class="fb-tm-header">
  <h1 class="fb-tm-name">${escapeHtml(data.name)}</h1>
  ${sub.length ? `<div class="fb-tm-sub">${sub.join(", ")}</div>` : ""}
</header>`.trim();
}

function renderStandingsSection(data: FootballTeamPageData, web: boolean): string {
  if (!data.divisionGroup) return "";
  return `
<section class="fb-section">
  <div class="fb-section-title">Division Standings</div>
  ${renderStandingsGroup(data.divisionGroup, NFL_STANDINGS_COLS, data.league === "nfl", data.league, web)}
</section>`.trim();
}

function renderLastGameSection(data: FootballTeamPageData, web: boolean): string {
  if (!data.lastGame) return "";
  return `
<section class="fb-section">
  <div class="fb-section-title">Most Recent Game</div>
  ${renderGameBlock(data.bundle, data.lastGame, data.lastBox, web)}
</section>`.trim();
}

// Opponent as seen from THIS team's side ("at Chiefs" / "vs Jets").
function opponentPhrase(data: FootballTeamPageData, g: FootballGame): string {
  const isHome = g.homeTeam.abbr.toUpperCase() === data.abbr.toUpperCase();
  const opp = isHome ? g.awayTeam : g.homeTeam;
  const name = data.league === "nfl" ? mascot(opp.name) : opp.name;
  return `${isHome ? "vs" : "at"} ${escapeHtml(name)}`;
}

function renderUpcomingSection(data: FootballTeamPageData): string {
  if (data.upcoming.length === 0) return "";
  const rows = data.upcoming
    .map(
      (g) =>
        `<div class="fb-next-row"><span class="fb-next-time">${escapeHtml(kickoffLabel(g.startTime))}</span>` +
        `<span class="fb-next-matchup">${opponentPhrase(data, g)}</span></div>`,
    )
    .join("");
  return `
<section class="fb-section">
  <div class="fb-section-title">Upcoming Matchups</div>
  <div class="fb-next-list">${rows}</div>
</section>`.trim();
}

function renderLeadersSection(data: FootballTeamPageData, web: boolean): string {
  if (data.teamLeaders.length === 0) return "";
  const rows = data.teamLeaders
    .map((grp) => {
      const players = grp.entries
        .map((e) => {
          const path = footballPlayerPath(data.league, { id: e.player.id, slug: e.player.slug });
          const name = linkAnchor(path, escapeHtml(lastNameOf(e.player.fullName)), web, "player-link", "es-player-link");
          return `${name} ${escapeHtml(e.displayValue)}`;
        })
        .join(", ");
      return `<div class="fb-tm-ldr-row"><span class="fb-tm-ldr-cat">${escapeHtml(grp.label)}</span><span class="fb-tm-ldr-vals">${players}</span></div>`;
    })
    .join("");
  return `
<section class="fb-section">
  <div class="fb-section-title">Season Leaders</div>
  <div class="fb-tm-ldr-list">${rows}</div>
</section>`.trim();
}

function renderTeam(data: FootballTeamPageData, web: boolean): string {
  return `
<div class="fb-team-page">
  ${renderHeading(data)}
  ${renderStandingsSection(data, web)}
  ${renderLastGameSection(data, web)}
  ${renderUpcomingSection(data)}
  ${renderLeadersSection(data, web)}
</div>`.trim();
}

/** Web team page — relative links. */
export function renderFootballTeamContent(data: FootballTeamPageData): string {
  return renderTeam(data, true);
}

/** Email team digest body — absolute links. Wrapped in the team email shell
 *  at send time (like MLB's renderTeamEmailContent). */
export function renderFootballTeamEmailContent(data: FootballTeamPageData): string {
  return renderTeam(data, false);
}
