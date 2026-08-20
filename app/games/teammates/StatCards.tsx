"use client";

import { useState } from "react";
import type { TeammatesPuzzle, PlayerCard, StatLine } from "@/lib/games/teammates/generate";

// Canonical franchise label -> compact abbreviation for the card's Team column.
const ABBR: Record<string, string> = {
  "New York Yankees": "NYY", "Boston Red Sox": "BOS", "Chicago Cubs": "CHC", "Cleveland Guardians": "CLE",
  "St. Louis Cardinals": "STL", "Philadelphia Phillies": "PHI", "Chicago White Sox": "CHW", "Cincinnati Reds": "CIN",
  "Los Angeles Dodgers": "LAD", "Pittsburgh Pirates": "PIT", "Detroit Tigers": "DET", "Los Angeles Angels": "LAA",
  "Baltimore Orioles": "BAL", "New York Mets": "NYM", "Atlanta Braves": "ATL", "Texas Rangers": "TEX",
  "San Francisco Giants": "SF", "Oakland Athletics": "OAK", "San Diego Padres": "SD", "Houston Astros": "HOU",
  "Toronto Blue Jays": "TOR", "Minnesota Twins": "MIN", "Milwaukee Brewers": "MIL", "Kansas City Royals": "KC",
  "Seattle Mariners": "SEA", "Miami Marlins": "MIA", "Arizona Diamondbacks": "ARI", "Tampa Bay Rays": "TB",
  "Colorado Rockies": "COL", "Washington Nationals": "WSH", "Washington Senators": "WAS", "New York Giants": "NYG",
  "Montreal Expos": "MON", "Brooklyn Dodgers": "BRO", "Boston Braves": "BSN", "St. Louis Browns": "SLB",
  "Kansas City Athletics": "KCA", "Philadelphia Athletics": "PHA", "Milwaukee Braves": "MLN", "Athletics": "ATH",
  "Cleveland Spiders": "CLV", "Louisville Colonels": "LOU", "Seattle Pilots": "SEP", "Troy Trojans": "TRO",
  "Buffalo Bisons": "BUF", "Detroit Wolverines": "DTW", "Providence Grays": "PRV", "Indianapolis Hoosiers": "IND",
  "Hartford Dark Blues": "HAR", "Worcester Brown Stockings": "WOR",
};
const abbr = (label: string) => ABBR[label] ?? label.slice(0, 3).toUpperCase();

const BAT_COLS: Array<[string, string]> = [["G", "g"], ["AB", "ab"], ["H", "h"], ["HR", "hr"], ["RBI", "rbi"], ["SB", "sb"], ["AVG", "avg"]];
const PIT_COLS: Array<[string, string]> = [["W", "w"], ["L", "l"], ["ERA", "era"], ["G", "g"], ["IP", "ip"], ["SO", "so"]];

const ipVal = (v: unknown) => { const f = parseFloat(String(v ?? 0)); const w = Math.floor(f); return w + Math.round((f - w) * 10) / 3; };
const cell = (v: number | string | null | undefined) => (v === null || v === undefined || v === "" ? "–" : String(v));

// Newspaper-style B&W table. Puzzle-team seasons are BOLD with the team code in
// that team's color (the only color in the table), so a player who played for
// several puzzle teams shows several colors down the card without flooding it.
function Card({ card, groupOf, assignedTeam }: { card: PlayerCard; groupOf: Map<string, number>; assignedTeam: string }) {
  const batAB = card.lines.filter((l) => l.k === "bat").reduce((a, l) => a + Number(l.s.ab ?? 0), 0);
  const pitIP = card.lines.filter((l) => l.k === "pit").reduce((a, l) => a + ipVal(l.s.ip), 0);
  const twoWay = batAB >= 50 && pitIP >= 20;
  const [kind, setKind] = useState<"bat" | "pit">(pitIP >= 20 ? "pit" : "bat");
  const cols = kind === "pit" ? PIT_COLS : BAT_COLS;

  // One row per (year, team) carrying both the bat and pit line, so BOTH toggle
  // panels render the identical set of rows — toggling never changes the height.
  const rowMap = new Map<string, { y: number; label: string; bat?: StatLine; pit?: StatLine }>();
  for (const l of card.lines) {
    const key = `${l.y}|${l.label}`;
    const e = rowMap.get(key) ?? { y: l.y, label: l.label };
    if (l.k === "bat") e.bat = l; else e.pit = l;
    rowMap.set(key, e);
  }
  let rows = [...rowMap.values()].sort((a, b) => a.y - b.y || a.label.localeCompare(b.label));
  if (!twoWay) rows = rows.filter((r) => (kind === "pit" ? r.pit : r.bat));

  return (
    <div className="tm-card">
      <div className="tm-card-head">
        <span className="tm-card-name">
          {card.name}
          {card.pos && <span className="tm-card-meta">{card.pos}</span>}
          {card.num && <span className="tm-card-meta">#{card.num}</span>}
          {card.hof && <span className="tm-card-hof">HOF</span>}
        </span>
        {twoWay && (
          <span className="tm-card-toggle">
            <button className={kind === "bat" ? "on" : ""} onClick={() => setKind("bat")}>Bat</button>
            <button className={kind === "pit" ? "on" : ""} onClick={() => setKind("pit")}>Pit</button>
          </span>
        )}
      </div>
      <table className="tm-card-table">
        <thead>
          <tr><th className="l">Year</th><th className="l">Tm</th>{cols.map(([h]) => <th key={h}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const line = kind === "pit" ? r.pit : r.bat;
            const gi = groupOf.get(r.label);
            // Every puzzle-team row is shaded; only the assigned team's rows bold.
            const cls = [gi === undefined ? "" : `pt-${gi}`, r.label === assignedTeam ? "assigned" : ""].filter(Boolean).join(" ");
            return (
              <tr key={i} className={cls}>
                <td className="l">{r.y}</td>
                <td className="l">{abbr(r.label)}</td>
                {cols.map(([h, key]) => <td key={h}>{cell(line?.s[key] as number | string | null | undefined)}</td>)}
              </tr>
            );
          })}
          {card.career[kind] && (
            <tr className="tm-career">
              <td className="l" colSpan={2}>Career</td>
              {cols.map(([h, key]) => <td key={h}>{cell(card.career[kind]![key] as number | string | null | undefined)}</td>)}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// Renders the stat cards for one team's four players (used inside the expanded
// accordion band on the results screen).
export function TeamStatCards({ puzzle, team }: { puzzle: TeammatesPuzzle; team: string }) {
  const groupOf = new Map<string, number>(puzzle.groups.map((g, i) => [g.team, i]));
  const cardById = new Map(puzzle.cards.map((c) => [c.id, c]));
  const group = puzzle.groups.find((g) => g.team === team);

  return (
    <div className="tm-team-cards">
      {group?.playerIds.map((id) => {
        const card = cardById.get(id);
        return card ? <Card key={id} card={card} groupOf={groupOf} assignedTeam={team} /> : null;
      })}
    </div>
  );
}
