// Season-to-date roster stat tables, aggregated from a team's box scores. Pure:
// takes the parsed boxes for the games played through the as-of date plus the
// team's abbreviation, sums each player's per-category lines, and emits display
// tables. Point-in-time is the caller's job (pass only games through the date).

import type { FootballBoxScore, FootballTeamBox, FootballPlayerRef } from "./types";
import type { FootballRosterTable } from "./team-canonical";

// This team's side of a box, matched by abbreviation.
function teamSide(box: FootballBoxScore, teamAbbr: string): FootballTeamBox | null {
  const want = teamAbbr.toUpperCase();
  if (box.home.team.abbr.toUpperCase() === want) return box.home;
  if (box.away.team.abbr.toUpperCase() === want) return box.away;
  return null;
}

type Row<T> = { player: FootballPlayerRef; acc: T };
// Accumulate per-player across games, keyed by athlete id, applying `add` to
// fold each game's line into the running total.
function accumulate<L extends { player: FootballPlayerRef }, T>(
  lines: L[][],
  init: () => T,
  add: (acc: T, line: L) => void,
): Array<Row<T>> {
  const by = new Map<string, Row<T>>();
  for (const game of lines) {
    for (const line of game) {
      const key = line.player.id || line.player.fullName;
      let row = by.get(key);
      if (!row) {
        row = { player: line.player, acc: init() };
        by.set(key, row);
      }
      add(row.acc, line);
    }
  }
  return [...by.values()];
}

const rosterPlayer = (p: FootballPlayerRef) => ({ id: p.id, slug: p.slug, fullName: p.fullName });

export function aggregateRosterTables(
  boxes: FootballBoxScore[],
  teamAbbr: string,
): FootballRosterTable[] {
  const sides = boxes.map((b) => teamSide(b, teamAbbr)).filter((s): s is FootballTeamBox => s != null);
  if (sides.length === 0) return [];

  const tables: FootballRosterTable[] = [];

  // Passing
  const passing = accumulate(
    sides.map((s) => s.passing),
    () => ({ c: 0, a: 0, yds: 0, td: 0, int: 0 }),
    (acc, l) => {
      acc.c += l.completions; acc.a += l.attempts; acc.yds += l.yards;
      acc.td += l.touchdowns; acc.int += l.interceptions;
    },
  ).filter((r) => r.acc.a > 0).sort((x, y) => y.acc.yds - x.acc.yds);
  if (passing.length) {
    tables.push({
      label: "Passing",
      columns: ["Player", "CMP", "ATT", "YDS", "TD", "INT"],
      rows: passing.map((r) => ({
        player: rosterPlayer(r.player),
        values: [`${r.acc.c}/${r.acc.a}`, r.acc.a, r.acc.yds, r.acc.td, r.acc.int],
      })),
    });
  }

  // Rushing
  const rushing = accumulate(
    sides.map((s) => s.rushing),
    () => ({ car: 0, yds: 0, td: 0, lg: 0 }),
    (acc, l) => { acc.car += l.carries; acc.yds += l.yards; acc.td += l.touchdowns; acc.lg = Math.max(acc.lg, l.long); },
  ).filter((r) => r.acc.car > 0).sort((x, y) => y.acc.yds - x.acc.yds);
  if (rushing.length) {
    tables.push({
      label: "Rushing",
      columns: ["Player", "CAR", "YDS", "TD", "LG"],
      rows: rushing.map((r) => ({
        player: rosterPlayer(r.player),
        values: [r.acc.car, r.acc.yds, r.acc.td, r.acc.lg],
      })),
    });
  }

  // Receiving
  const receiving = accumulate(
    sides.map((s) => s.receiving),
    () => ({ rec: 0, yds: 0, td: 0, lg: 0 }),
    (acc, l) => { acc.rec += l.receptions; acc.yds += l.yards; acc.td += l.touchdowns; acc.lg = Math.max(acc.lg, l.long); },
  ).filter((r) => r.acc.rec > 0).sort((x, y) => y.acc.yds - x.acc.yds);
  if (receiving.length) {
    tables.push({
      label: "Receiving",
      columns: ["Player", "REC", "YDS", "TD", "LG"],
      rows: receiving.map((r) => ({
        player: rosterPlayer(r.player),
        values: [r.acc.rec, r.acc.yds, r.acc.td, r.acc.lg],
      })),
    });
  }

  // Defense
  const defense = accumulate(
    sides.map((s) => s.defense),
    () => ({ tot: 0, solo: 0, sack: 0, tfl: 0, pd: 0 }),
    (acc, l) => {
      acc.tot += l.tackles; acc.solo += l.soloTackles; acc.sack += l.sacks;
      acc.tfl += l.tacklesForLoss; acc.pd += l.passesDefended;
    },
  ).filter((r) => r.acc.tot > 0).sort((x, y) => y.acc.tot - x.acc.tot);
  if (defense.length) {
    tables.push({
      label: "Defense",
      columns: ["Player", "TOT", "SOLO", "SACK", "TFL", "PD"],
      rows: defense.map((r) => ({
        player: rosterPlayer(r.player),
        values: [r.acc.tot, r.acc.solo, r.acc.sack, r.acc.tfl, r.acc.pd],
      })),
    });
  }

  // Kicking
  const kicking = accumulate(
    sides.map((s) => s.kicking),
    () => ({ fgm: 0, fga: 0, xpm: 0, xpa: 0, pts: 0 }),
    (acc, l) => { acc.fgm += l.fgMade; acc.fga += l.fgAttempts; acc.xpm += l.xpMade; acc.xpa += l.xpAttempts; acc.pts += l.points; },
  ).filter((r) => r.acc.fga > 0 || r.acc.xpa > 0).sort((x, y) => y.acc.pts - x.acc.pts);
  if (kicking.length) {
    tables.push({
      label: "Kicking",
      columns: ["Player", "FG", "XP", "PTS"],
      rows: kicking.map((r) => ({
        player: rosterPlayer(r.player),
        values: [`${r.acc.fgm}/${r.acc.fga}`, `${r.acc.xpm}/${r.acc.xpa}`, r.acc.pts],
      })),
    });
  }

  return tables;
}
