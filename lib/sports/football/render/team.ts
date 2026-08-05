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
import { findTeamByAbbr } from "../../../teams";
import type { FootballTeamPageData } from "../team-canonical";
import type { FootballGame, FootballStandingsRow, FootballLeague } from "../types";

// Link an opponent (by abbreviation) to its team page when resolvable; FCS
// opponents not in the FBS registry stay unlinked. `inner` must be escaped.
function teamPageLink(league: FootballLeague, abbr: string, inner: string, web: boolean): string {
  const slug = findTeamByAbbr(league, abbr)?.slug;
  return slug ? linkAnchor(`/${league}/${slug}`, inner, web, "team-link", "es-team-link") : inner;
}

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

function recordLine(r: { wins: number; losses: number; ties: number; streak: string | null }): string {
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
  // Prefer the point-in-time record (from the schedule through the as-of date)
  // over the standings row, which ESPN only serves as current.
  const rec = data.asOfRecord ?? data.record;
  if (rec) sub.push(recordLine(rec));
  if (data.divisionRank != null && data.divisionGroup) {
    sub.push(`${ordinal(data.divisionRank)} in ${escapeHtml(data.divisionGroup.group)}`);
  }
  return `
<header class="fb-tm-header">
  <h1 class="fb-tm-name">${escapeHtml(data.name)}</h1>
  ${sub.length ? `<div class="fb-tm-sub">${sub.join(", ")}</div>` : ""}
</header>`.trim();
}

// Record-split columns that should disappear when the whole group has no data
// for them — e.g. college conferences without divisions show Div = "0-0" for
// every team, so the column is pure noise.
// Columns worth hiding when a whole group has no data for them: the record
// splits (Div is "0-0" for every team in a division-less college conference)
// and Ties (essentially always 0 in modern football).
const DROPPABLE_LABELS = new Set(["Home", "Road", "Div", "Conf", "T"]);
function isBlankRecord(v: string | number): boolean {
  const s = String(v).trim();
  return s === "" || s === "0" || /^0-0(-0)?$/.test(s);
}
function visibleStandingsCols(
  cols: typeof NFL_STANDINGS_COLS,
  rows: FootballStandingsRow[],
): typeof NFL_STANDINGS_COLS {
  return cols.filter((c) =>
    DROPPABLE_LABELS.has(c.label) ? rows.some((r) => !isBlankRecord(c.get(r))) : true,
  );
}

function renderStandingsSection(data: FootballTeamPageData, web: boolean): string {
  if (!data.divisionGroup) return "";
  // One combined header ("American Conference Standings") — the group's own
  // caption is suppressed so we don't stack a generic "… Standings" title over
  // a redundant conference caption. Drop split columns that are empty/zero for
  // the whole conference (e.g. Div in a division-less college conference).
  const cols = visibleStandingsCols(NFL_STANDINGS_COLS, data.divisionGroup.rows);
  return `
<section class="fb-section">
  <div class="fb-section-title">${escapeHtml(data.divisionGroup.group)} Standings</div>
  ${renderStandingsGroup(data.divisionGroup, cols, data.league === "nfl", data.league, web, undefined, true, true)}
</section>`.trim();
}

// "Saturday, November 1, 2025" — date only (the box header already carries the
// kickoff/Final status), in ET so a late game lands on the night it was played.
function gameDateLabel(iso: string): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

function renderLastGameSection(data: FootballTeamPageData, web: boolean): string {
  if (!data.lastGame) return "";
  const date = gameDateLabel(data.lastGame.startTime);
  return `
<section class="fb-section">
  <div class="fb-section-title">${date ? escapeHtml(date) : "Most Recent Game"}</div>
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

// "3:30 PM ET" for an upcoming game's result column; "TBD" when the kickoff
// time isn't set yet (ESPN parks unscheduled games at midnight).
function kickoffTime(iso: string): string {
  if (!iso) return "TBD";
  try {
    const d = new Date(iso);
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    const parts = fmt.formatToParts(d);
    const hour = parts.find((p) => p.type === "hour")?.value;
    const minute = parts.find((p) => p.type === "minute")?.value;
    const period = parts.find((p) => p.type === "dayPeriod")?.value;
    // ESPN parks unscheduled games at midnight ET — show TBD, not "12:00 AM".
    if (hour === "12" && minute === "00" && /AM/i.test(period ?? "")) return "TBD";
    return fmt.format(d) + " ET";
  } catch {
    return "TBD";
  }
}

// "Sep 6" — compact date for a schedule row, in ET.
function shortDate(iso: string): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      month: "short",
      day: "numeric",
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

// Full-season schedule with results for completed games. Web-only (the loader
// fetches it live; the email digest omits it).
function renderScheduleSection(data: FootballTeamPageData, web: boolean): string {
  if (!data.schedule || data.schedule.length === 0) return "";
  const rows = data.schedule
    .map((g) => {
      const oppName =
        data.league === "nfl"
          ? g.opponent
            ? mascot(g.opponent.name)
            : "TBD"
          : g.opponent?.location ?? g.opponent?.name ?? "TBD";
      const oppRef = g.opponent
        ? // Link the opponent to its team page when we can resolve the slug.
          teamPageLink(data.league, g.opponent.abbr, escapeHtml(oppName), web)
        : escapeHtml(oppName);
      const site = g.isHome ? "vs" : "at";
      let result = "";
      if (g.completed && g.teamScore != null && g.oppScore != null) {
        const wl = g.won === null ? "T" : g.won ? "W" : "L";
        result = `<span class="fb-sch-wl fb-sch-${wl.toLowerCase()}">${wl}</span> ${g.teamScore}&ndash;${g.oppScore}`;
      } else {
        // Not played (as of this page's date): show the kickoff time, not
        // ESPN's real "Final" status. Reads as an upcoming game.
        result = `<span class="fb-sch-upcoming">${escapeHtml(kickoffTime(g.isoDate))}</span>`;
      }
      return `<tr>
        <td class="fb-sch-date">${escapeHtml(shortDate(g.isoDate))}</td>
        <td class="fb-sch-opp">${escapeHtml(site)} ${oppRef}</td>
        <td class="fb-sch-res">${result}</td>
      </tr>`;
    })
    .join("");
  return `
<section class="fb-section">
  <div class="fb-section-title">Schedule</div>
  <table class="fb-sched-table" role="presentation" cellpadding="0" cellspacing="0" border="0">
    <thead><tr>
      <th class="fb-sch-date">Date</th>
      <th class="fb-sch-opp">Opponent</th><th class="fb-sch-res">Result</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
</section>`.trim();
}

// Full roster stat tables (Passing/Rushing/Receiving/Defense/Kicking), season
// totals through the page's as-of date. Web-only (live loader aggregates the
// box scores). Player names link to their player pages.
function renderRosterSection(data: FootballTeamPageData, web: boolean): string {
  if (!data.roster || data.roster.length === 0) return "";
  const blocks = data.roster
    .map((t) => {
      const head = t.columns
        .map((c, i) => `<th class="${i === 0 ? "fb-rost-name" : "fb-rost-stat"}">${escapeHtml(c)}</th>`)
        .join("");
      const rows = t.rows
        .map((r) => {
          const nm = r.player.id
            ? linkAnchor(
                footballPlayerPath(data.league, { id: r.player.id, slug: r.player.slug }),
                escapeHtml(r.player.fullName),
                web,
                "player-link",
                "es-player-link",
              )
            : escapeHtml(r.player.fullName);
          const vals = r.values.map((v) => `<td class="fb-rost-stat">${escapeHtml(String(v))}</td>`).join("");
          return `<tr><td class="fb-rost-name">${nm}</td>${vals}</tr>`;
        })
        .join("");
      return `<div class="fb-rost-block">
  <h3 class="fb-rost-cap">${escapeHtml(t.label)}</h3>
  <table class="fb-rost-table" role="presentation" cellpadding="0" cellspacing="0" border="0">
    <thead><tr>${head}</tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>`;
    })
    .join("");
  return `
<section class="fb-section">
  <div class="fb-section-title">Roster Statistics</div>
  <div class="fb-rost-grid">${blocks}</div>
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
  ${renderRosterSection(data, web)}
  ${renderScheduleSection(data, web)}
  ${renderUpcomingSection(data)}
  ${data.roster && data.roster.length > 0 ? "" : renderLeadersSection(data, web)}
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
