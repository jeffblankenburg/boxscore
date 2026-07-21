// Football player page renderer — web only (no email surface). Produces the
// same HTML string the route drops into the page, styled with the shared fb-
// classes from globals.css (fb-stat-table for the game logs, a handful of
// fb-pl- classes for the bio header). Pure: canonical player data in, HTML
// out. Mirrors lib/render-player.ts (MLB) section-for-section: a bio header,
// a season stats summary line, then one game-log table per stat category
// with a season-totals footer.

import type {
  FootballPlayerPageData,
  FootballStatSection,
  FootballAthleteBio,
} from "../player-canonical";
import { footballPlayerPath } from "../player-links";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function teamHtml(bio: FootballAthleteBio): string {
  if (!bio.teamName) return "";
  const name = escapeHtml(bio.teamName);
  if (!bio.teamSlug) return name;
  return `<a class="player-link" href="/${bio.league}/${bio.teamSlug}">${name}</a>`;
}

function renderHeader(bio: FootballAthleteBio): string {
  const bits: string[] = [];
  const team = teamHtml(bio);
  if (team) bits.push(team);
  if (bio.jersey) bits.push(`#${escapeHtml(bio.jersey)}`);
  if (bio.position) bits.push(escapeHtml(bio.position));
  // Physical line kept separate and quieter — height/weight/college/exp.
  const detail: string[] = [];
  if (bio.height) detail.push(escapeHtml(bio.height));
  if (bio.weight) detail.push(escapeHtml(bio.weight));
  if (bio.college) detail.push(escapeHtml(bio.college));
  if (bio.experience != null) {
    detail.push(bio.experience === 0 ? "Rookie" : `${bio.experience} yr${bio.experience === 1 ? "" : "s"}`);
  }
  return `
<header class="fb-pl-header">
  <h1 class="fb-pl-name">${escapeHtml(bio.fullName)}</h1>
  <div class="fb-pl-team">${bits.join(", ")}</div>
  ${detail.length ? `<div class="fb-pl-detail">${detail.join(", ")}</div>` : ""}
</header>`.trim();
}

function renderSummary(data: FootballPlayerPageData): string {
  if (data.summary.length === 0) return "";
  const chips = data.summary
    .map(
      (s) =>
        `<div class="fb-pl-chip"><span class="fb-pl-chip-val">${escapeHtml(s.value)}</span>` +
        `<span class="fb-pl-chip-label">${escapeHtml(s.label)}${s.rank ? ` (${escapeHtml(s.rank)})` : ""}</span></div>`,
    )
    .join("");
  return `<div class="fb-pl-summary">${chips}</div>`;
}

function opponentCell(atVs: "@" | "vs", oppAbbr: string): string {
  return `${atVs === "@" ? "@ " : "vs "}${escapeHtml(oppAbbr)}`;
}

function renderSection(season: number, section: FootballStatSection): string {
  const statHead = section.columns
    .map((c) => `<th class="fb-st-cell">${escapeHtml(c.label)}</th>`)
    .join("");
  const body = section.rows
    .map((r) => {
      const wk = r.week != null ? `Wk ${r.week}` : "—";
      const opp = opponentCell(r.atVs, r.oppAbbr);
      const res = r.result
        ? `<span class="fb-pl-res fb-pl-res-${r.result.toLowerCase()}"${
            r.score ? ` title="${escapeHtml(r.score)}"` : ""
          }>${r.result}</span>`
        : "—";
      const cells = r.cells.map((c) => `<td class="fb-st-cell">${escapeHtml(c)}</td>`).join("");
      return (
        `<tr><td class="fb-st-name">${escapeHtml(wk)}</td>` +
        `<td class="fb-st-cell fb-pl-opp">${opp}</td>` +
        `<td class="fb-st-cell">${res}</td>${cells}</tr>`
      );
    })
    .join("");
  const foot = section.totals
    ? `<tfoot><tr><td class="fb-st-name">Totals</td><td class="fb-st-cell"></td><td class="fb-st-cell"></td>` +
      section.totals.map((c) => `<td class="fb-st-cell">${escapeHtml(c)}</td>`).join("") +
      `</tr></tfoot>`
    : "";
  return `
<div class="fb-game-header">${escapeHtml(section.label)} — ${season} Regular Season</div>
<table class="fb-stat-table" width="100%" cellpadding="0" cellspacing="0" border="0">
  <thead><tr><th class="fb-st-name">Game</th><th class="fb-st-cell">Opp</th><th class="fb-st-cell">Res</th>${statHead}</tr></thead>
  <tbody>${body}</tbody>
  ${foot}
</table>`.trim();
}

export function renderFootballPlayerContent(data: FootballPlayerPageData): string {
  const sections =
    data.sections.length > 0
      ? data.sections.map((s) => renderSection(data.season, s)).join("\n")
      : `<p class="fb-pl-empty">No game log available for the ${data.season} season.</p>`;
  return `
<div class="fb-section fb-player">
  ${renderHeader(data.bio)}
  ${renderSummary(data)}
  ${sections}
</div>`.trim();
}
