// NBA playoff bracket adapter. Converts ESPN scoreboard + standings data
// into a PlayoffBracketData tree the universal bracket renderer can draw.
//
// Inputs:
//   • events: every playoff-tagged event from the digest's date plus the
//     upcoming-window scoreboard. Each event carries ESPN's series context
//     (awayWins / homeWins / completed / totalGames).
//   • standings: regular-season standings envelope. ESPN populates
//     `playoffSeed` (1–8 per conference) on each entry once the postseason
//     bracket is set, so we don't need a separate postseason standings pull.
//
// Output: PlayoffBracketData with both conferences, or null when we don't
// have enough information to build a bracket (pre-playoffs, missing seeds,
// wrong conference ids — any of these mean ESPN hasn't set the bracket yet).

import type {
  BasketballConferenceStandings,
  BasketballScoreboardEvent,
  BasketballStandings,
} from "./basketball";
import type { PlayoffBracketData } from "./basketball-daily";
import type { Bracket, BracketNode, SeriesResult } from "./render-bracket";

// ESPN conference ids are stable: 5 = Eastern, 6 = Western for NBA.
const EAST_CONF_ID = "5";
const WEST_CONF_ID = "6";

// Standard NBA seed pairings for round 1, ordered so the resulting subtree
// matches a conventional bracket layout: 1/8 top, 4/5 directly below it
// (top half of conference), then 3/6 and 2/7 (bottom half).
const ROUND_ONE_PAIRS: Array<[number, number]> = [
  [1, 8],
  [4, 5],
  [3, 6],
  [2, 7],
];

type TeamRec = { teamId: string; abbr: string; seed: number };

// Series wins keyed by sorted team-id pair. Multiple events share the same
// series context (one per game played); we keep whichever event observed the
// highest total wins, which is the latest snapshot ESPN has shown us.
type SeriesRec = {
  teamAId: string;
  teamAWins: number;
  teamBId: string;
  teamBWins: number;
  completed: boolean;
};

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function collectSeries(events: BasketballScoreboardEvent[]): Map<string, SeriesRec> {
  const out = new Map<string, SeriesRec>();
  for (const ev of events) {
    if (ev.seasonType !== 3) continue;
    const s = ev.series;
    if (!s) continue;
    const awayId = ev.away.team.id;
    const homeId = ev.home.team.id;
    const key = pairKey(awayId, homeId);
    const total = s.awayWins + s.homeWins;
    const existing = out.get(key);
    if (existing) {
      const existingTotal = existing.teamAWins + existing.teamBWins;
      if (total < existingTotal && !s.completed) continue;
    }
    const aIsAway = awayId < homeId;
    out.set(key, {
      teamAId: aIsAway ? awayId : homeId,
      teamAWins: aIsAway ? s.awayWins : s.homeWins,
      teamBId: aIsAway ? homeId : awayId,
      teamBWins: aIsAway ? s.homeWins : s.awayWins,
      completed: s.completed,
    });
  }
  return out;
}

function seedTeamsForConference(conf: BasketballConferenceStandings): TeamRec[] | null {
  const out: TeamRec[] = [];
  for (const e of conf.entries) {
    const seedStat = e.stats.playoffSeed;
    if (!seedStat) continue;
    const seed = seedStat.value;
    if (!Number.isFinite(seed) || seed < 1 || seed > 8) continue;
    out.push({ teamId: e.team.id, abbr: e.team.abbreviation, seed });
  }
  if (out.length < 8) return null;
  out.sort((a, b) => a.seed - b.seed);
  return out.slice(0, 8);
}

// Resolve a series between two known teams. Returns the SeriesResult to
// place at the corresponding tree node, plus the winning team (so the parent
// node can be assembled). Unknown teams (e.g. earlier round still in flight)
// produce { not_started, null }.
function lookupSeries(
  series: Map<string, SeriesRec>,
  upper: TeamRec | null,
  lower: TeamRec | null,
): { result: SeriesResult; winner: TeamRec | null } {
  if (!upper || !lower) return { result: { kind: "not_started" }, winner: null };
  const rec = series.get(pairKey(upper.teamId, lower.teamId));
  if (!rec) return { result: { kind: "not_started" }, winner: null };

  const upperWins = rec.teamAId === upper.teamId ? rec.teamAWins : rec.teamBWins;
  const lowerWins = rec.teamAId === upper.teamId ? rec.teamBWins : rec.teamAWins;

  if (rec.completed) {
    const winner = upperWins > lowerWins ? upper : lower;
    const winnerScore = Math.max(upperWins, lowerWins);
    return {
      result: { kind: "decided", winner: { abbr: winner.abbr, seed: winner.seed }, winnerScore },
      winner,
    };
  }
  if (upperWins === 0 && lowerWins === 0) {
    return { result: { kind: "not_started" }, winner: null };
  }
  return {
    result: { kind: "in_progress", upperScore: upperWins, lowerScore: lowerWins },
    winner: null,
  };
}

function leaf(team: TeamRec): BracketNode {
  return { kind: "team", team: { abbr: team.abbr, seed: team.seed }, score: null };
}

function buildConferenceRoot(
  teams: TeamRec[],
  series: Map<string, SeriesRec>,
): BracketNode {
  const bySeed = new Map<number, TeamRec>();
  for (const t of teams) bySeed.set(t.seed, t);

  const r1Nodes = ROUND_ONE_PAIRS.map(([upperSeed, lowerSeed]) => {
    const upperTeam = bySeed.get(upperSeed)!;
    const lowerTeam = bySeed.get(lowerSeed)!;
    const { result, winner } = lookupSeries(series, upperTeam, lowerTeam);
    const node: BracketNode = {
      kind: "series",
      result,
      upper: leaf(upperTeam),
      lower: leaf(lowerTeam),
    };
    return { node, winner };
  });

  const buildHigher = (
    top: { node: BracketNode; winner: TeamRec | null },
    bot: { node: BracketNode; winner: TeamRec | null },
  ): { node: BracketNode; winner: TeamRec | null } => {
    const { result, winner } = lookupSeries(series, top.winner, bot.winner);
    return {
      node: { kind: "series", result, upper: top.node, lower: bot.node },
      winner,
    };
  };

  const semiTop = buildHigher(r1Nodes[0]!, r1Nodes[1]!);
  const semiBot = buildHigher(r1Nodes[2]!, r1Nodes[3]!);
  return buildHigher(semiTop, semiBot).node;
}

export function buildNbaBracket(
  events: BasketballScoreboardEvent[],
  standings: BasketballStandings,
): PlayoffBracketData | null {
  const east = standings.conferences.find((c) => c.id === EAST_CONF_ID);
  const west = standings.conferences.find((c) => c.id === WEST_CONF_ID);
  if (!east || !west) return null;

  const eastTeams = seedTeamsForConference(east);
  const westTeams = seedTeamsForConference(west);
  if (!eastTeams || !westTeams) return null;

  const series = collectSeries(events);
  const eastRoot = buildConferenceRoot(eastTeams, series);
  const westRoot = buildConferenceRoot(westTeams, series);

  const eastBracket: Bracket = {
    title: "Eastern Conference",
    direction: "ltr",
    root: eastRoot,
  };
  const westBracket: Bracket = {
    title: "Western Conference",
    direction: "rtl",
    root: westRoot,
  };

  const champ = (root: BracketNode): string | null =>
    root.kind === "series" && root.result.kind === "decided"
      ? root.result.winner.abbr
      : null;

  return {
    conferences: [eastBracket, westBracket],
    finals: { eastChamp: champ(eastRoot), westChamp: champ(westRoot) },
  };
}
