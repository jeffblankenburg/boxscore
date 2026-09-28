// Sport-agnostic leaderboard dispatcher + shared column markup. The page
// (app/[sport]/leaders/[category]/page.tsx) asks for a sport's provider and
// renders whatever columns it returns. Each sport implements SportLeadersProvider
// (lib/sports/leaders-types.ts); add a case here as sports come online.

import type { LeaderColumn, SportLeadersProvider } from "./leaders-types";
import { mlbLeadersProvider } from "./mlb/leaders-full";
import { nhlLeadersProvider } from "@/lib/hockey-leaders";

export function leadersProvider(sport: string): SportLeadersProvider | null {
  switch (sport) {
    case "mlb": return mlbLeadersProvider;
    case "nhl": return nhlLeadersProvider;
    default: return null;
  }
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// One column's ranked table. Same markup + classes as the digest leaders tables
// (.leaders-table, .player-col, player-link) so it reads identically. The
// column label renders as a subheader only when present — single-column sports
// (NHL) pass an empty label to omit it. Rows carry pre-linked player name HTML.
export function renderLeaderColumnHtml(col: LeaderColumn, valueLabel: string): string {
  const body = col.rows.length === 0
    ? `<tr><td class="player-col" colspan="2">No qualifiers yet.</td></tr>`
    : col.rows.map((r) => `
      <tr>
        <td class="player-col">${r.rank}. ${r.nameHtml}, ${r.teamAbbr}</td>
        <td>${esc(r.value)}</td>
      </tr>`).join("");
  const heading = col.label ? `<div class="stats-subheader">${esc(col.label)}</div>` : "";
  return `${heading}
    <table class="leaders-table lb-table">
      <thead><tr><th class="player-col">Player</th><th>${esc(valueLabel)}</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}
