// NHL player page renderer — web only (no email surface). Close port of
// lib/render-basketball-player.ts: a bio header, a season-summary chip row,
// then one game-log table. Pure: canonical data in, HTML out. Reuses the shared
// player-link class + bb-pl- player-page styling (the hockey digest already
// borrows the bb- table styles).

import type {
  HockeyPlayerPageData,
  HockeyAthleteBio,
  HockeyGameLogRow,
} from "./hockey-player";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function shortDate(iso: string): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      month: "short",
      day: "numeric",
    }).format(new Date(iso));
  } catch {
    return "—";
  }
}

function teamHtml(bio: HockeyAthleteBio): string {
  if (!bio.teamName) return "";
  const name = escapeHtml(bio.teamName);
  return bio.teamSlug
    ? `<a class="player-link" href="/nhl/${bio.teamSlug}">${name}</a>`
    : name;
}

function renderHeader(bio: HockeyAthleteBio): string {
  const bits: string[] = [];
  const team = teamHtml(bio);
  if (team) bits.push(team);
  if (bio.jersey) bits.push(`#${escapeHtml(bio.jersey)}`);
  if (bio.position) bits.push(escapeHtml(bio.position));
  const detail: string[] = [];
  if (bio.height) detail.push(escapeHtml(bio.height));
  if (bio.weight) detail.push(escapeHtml(bio.weight));
  if (bio.experience != null) {
    detail.push(bio.experience === 0 ? "Rookie" : `${bio.experience} yr${bio.experience === 1 ? "" : "s"}`);
  }
  return `
<header class="bb-pl-header">
  <h1 class="bb-pl-title">${escapeHtml(bio.fullName)}</h1>
  <div class="bb-pl-team">${bits.join(", ")}</div>
  ${detail.length ? `<div class="bb-pl-detail">${detail.join(", ")}</div>` : ""}
</header>`.trim();
}

function renderSummary(data: HockeyPlayerPageData): string {
  if (data.summary.length === 0) return "";
  const chips = data.summary
    .map(
      (s) =>
        `<div class="bb-pl-chip"><span class="bb-pl-chip-val">${escapeHtml(s.value)}</span>` +
        `<span class="bb-pl-chip-label">${escapeHtml(s.label)}${s.rank ? ` (${escapeHtml(s.rank)})` : ""}</span></div>`,
    )
    .join("");
  return `<div class="bb-pl-summary">${chips}</div>`;
}

function renderRow(r: HockeyGameLogRow): string {
  const opp = `${r.atVs === "@" ? "@ " : "vs "}${escapeHtml(r.oppAbbr)}`;
  const res = r.result
    ? `<span class="bb-pl-res bb-pl-res-${r.result.toLowerCase()}"${r.score ? ` title="${escapeHtml(r.score)}"` : ""}>${r.result}</span>`
    : "—";
  const cells = r.cells.map((c) => `<td class="bb-pl-stat">${escapeHtml(c)}</td>`).join("");
  return (
    `<tr><td class="bb-pl-name">${escapeHtml(shortDate(r.date))}</td>` +
    `<td class="bb-pl-stat bb-pl-opp">${opp}</td>` +
    `<td class="bb-pl-stat">${res}</td>${cells}</tr>`
  );
}

function renderGameLog(data: HockeyPlayerPageData): string {
  if (data.rows.length === 0) {
    return `<p class="bb-pl-empty">No game log available for the ${data.season} season.</p>`;
  }
  const statHead = data.columns.map((c) => `<th class="bb-pl-stat">${escapeHtml(c.label)}</th>`).join("");
  const body = data.rows.map(renderRow).join("");
  return `
<div class="bb-game-header">Recent Games — ${data.season} Regular Season</div>
<table class="bb-player-table" role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
  <thead><tr><th class="bb-pl-name">Date</th><th class="bb-pl-stat bb-pl-opp">Opp</th><th class="bb-pl-stat">Res</th>${statHead}</tr></thead>
  <tbody>${body}</tbody>
</table>`.trim();
}

export function renderHockeyPlayerContent(data: HockeyPlayerPageData): string {
  return `
<div class="newspaper"><div class="bb-section bb-player">
  ${renderHeader(data.bio)}
  ${renderSummary(data)}
  ${renderGameLog(data)}
</div></div>`.trim();
}
