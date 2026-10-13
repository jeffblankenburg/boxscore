// Sport-neutral playoff bracket for basketball (NBA/WNBA) and hockey (NHL).
//
// ESPN exposes no bracket endpoint, so we RECONSTRUCT the bracket from the
// postseason's scoreboard events: every seasonType=3 game carries its series
// state (round headline, each side's series wins, a "X wins series 3-1"
// summary). Collecting those events across the whole postseason — which we
// already persist in daily_raw every day — and keeping the latest state per
// matchup yields the full ladder: First Round -> Semifinals -> Finals, etc.
//
// The renderer is a columnar bracket: one column per round in order, each
// column a stack of series boxes, the championship round a single box on the
// right. This shape works for a single league-wide ladder (WNBA) and for two
// conference ladders (NBA/NHL) alike, without needing seed data (ESPN's
// curatedRank comes back null here).
//
// Pure: assembleBracket takes plain event rows and returns a Bracket; the
// render functions take a Bracket + a team-link helper. I/O (scanning
// daily_raw) lives in the per-sport loaders.

export type BracketLeague = "nba" | "wnba" | "nhl";

// One game's series context, flattened from a scoreboard event. The loader
// produces these from parsed basketball/hockey events.
export type BracketGameRow = {
  round: string | undefined; // ESPN round headline, e.g. "WNBA Semifinals"
  date: string; // event ISO date, for picking the latest state per series
  bestOf: number; // series length (series.totalCompetitions)
  summary: string; // "ATL wins series 3-0" / "NY leads series 1-0" / ""
  completed: boolean; // series over
  aId: string;
  aAbbr: string;
  aName: string;
  aWins: number;
  hId: string;
  hAbbr: string;
  hName: string;
  hWins: number;
};

// A parsed scoreboard event, structurally shared by basketball and hockey.
export type SeriesEventLike = {
  seasonType: number;
  roundName?: string;
  date: string;
  away: { team: { id: string; abbreviation: string; name: string } };
  home: { team: { id: string; abbreviation: string; name: string } };
  series?: { totalGames: number; summary: string; completed: boolean; awayWins: number; homeWins: number };
};

// Flatten a parsed scoreboard event into a bracket row, or null if it isn't a
// postseason game carrying series context. Shared by the basketball and hockey
// bracket loaders.
export function eventToBracketRow(e: SeriesEventLike): BracketGameRow | null {
  if (e.seasonType !== 3 || !e.series) return null;
  return {
    round: e.roundName,
    date: e.date,
    bestOf: e.series.totalGames,
    summary: e.series.summary,
    completed: e.series.completed,
    aId: e.away.team.id, aAbbr: e.away.team.abbreviation, aName: e.away.team.name, aWins: e.series.awayWins,
    hId: e.home.team.id, hAbbr: e.home.team.abbreviation, hName: e.home.team.name, hWins: e.series.homeWins,
  };
}

export type BracketEntrant = {
  teamId: string;
  abbr: string;
  name: string;
  wins: number;
};

export type BracketSeries = {
  round: string;
  roundOrder: number;
  bestOf: number;
  top: BracketEntrant;
  bottom: BracketEntrant;
  winnerTeamId: string | null;
  summary: string;
};

export type Bracket = {
  league: BracketLeague;
  rounds: string[]; // ordered round labels present
  series: BracketSeries[]; // all series, any order
};

// Map a round headline to a sort order. Keyword-based so it survives ESPN's
// slightly different labels across leagues ("First Round", "Conference
// Semifinals", "WNBA Finals", "Stanley Cup Final"). Higher = later round.
function roundOrder(round: string): number {
  const r = round.toLowerCase();
  if (r.includes("play-in") || r.includes("play in")) return 0;
  if (r.includes("first round") || r.includes("1st round")) return 1;
  if (r.includes("conference semifinal") || r.includes("second round") || r.includes("2nd round")) return 2;
  // "Semifinals" (WNBA league-wide) sits one rung below its final.
  if (r.includes("semifinal")) return 2;
  if (r.includes("conference final")) return 3;
  if (r.includes("stanley cup")) return 4;
  if (r.includes("final")) return 4; // NBA/WNBA Finals
  return 5; // unknown -> sort last
}

// Which team a "X wins series" summary names as the winner, matched to one of
// the two entrants by abbreviation. Returns null while the series is live.
function winnerFromSummary(summary: string, a: BracketEntrant, h: BracketEntrant): string | null {
  const m = /^([A-Z]{2,4})\s+wins series/i.exec(summary.trim());
  if (!m) return null;
  const abbr = m[1]!.toUpperCase();
  if (abbr === a.abbr.toUpperCase()) return a.teamId;
  if (abbr === h.abbr.toUpperCase()) return h.teamId;
  return null;
}

// Collapse all postseason game rows into one series per matchup, keeping the
// most advanced state (latest date / highest combined win count). Orders each
// series' two entrants with the leader on top so the box reads "ATL 3 / NY 0".
export function assembleBracket(league: BracketLeague, rows: BracketGameRow[]): Bracket {
  const byPair = new Map<string, BracketGameRow>();
  for (const row of rows) {
    if (!row.aId || !row.hId) continue;
    const key = [row.aId, row.hId].sort().join("-");
    const prev = byPair.get(key);
    const prevGames = prev ? prev.aWins + prev.hWins : -1;
    const curGames = row.aWins + row.hWins;
    // Keep the row with the most series progress; tie-break on later date.
    if (!prev || curGames > prevGames || (curGames === prevGames && row.date > prev.date)) {
      byPair.set(key, row);
    }
  }

  const series: BracketSeries[] = [];
  for (const row of byPair.values()) {
    const round = row.round ?? "Playoffs";
    const away: BracketEntrant = { teamId: row.aId, abbr: row.aAbbr, name: row.aName, wins: row.aWins };
    const home: BracketEntrant = { teamId: row.hId, abbr: row.hAbbr, name: row.hName, wins: row.hWins };
    const [top, bottom] =
      home.wins > away.wins
        ? [home, away]
        : away.wins > home.wins
          ? [away, home]
          : [away, home].sort((x, y) => x.abbr.localeCompare(y.abbr)) as [BracketEntrant, BracketEntrant];
    series.push({
      round,
      roundOrder: roundOrder(round),
      bestOf: row.bestOf,
      top,
      bottom,
      winnerTeamId: row.completed ? winnerFromSummary(row.summary, away, home) : null,
      summary: row.summary,
    });
  }

  // Ordered, de-duplicated list of round labels actually present.
  const roundLabels = [...new Set(series.map((s) => s.round))].sort(
    (a, b) => roundOrder(a) - roundOrder(b),
  );

  return { league, rounds: roundLabels, series };
}

// ---- Rendering ------------------------------------------------------------

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

type LinkFn = (name: string) => string; // team name -> anchor HTML

function entrantRow(e: BracketEntrant, isWinner: boolean, link: LinkFn): string {
  const cls = isWinner ? "pb-team pb-win" : "pb-team";
  return `<div class="${cls}"><span class="pb-nm">${link(e.name)}</span><span class="pb-w">${e.wins}</span></div>`;
}

function seriesBox(s: BracketSeries, link: LinkFn): string {
  const topWin = s.winnerTeamId === s.top.teamId;
  const botWin = s.winnerTeamId === s.bottom.teamId;
  return `<div class="pb-series">
    ${entrantRow(s.top, topWin, link)}
    ${entrantRow(s.bottom, botWin, link)}
  </div>`;
}

// Columnar bracket: one column per round, each a stack of that round's series.
// Rounds render left (earliest) to right (championship).
export function renderBracket(bracket: Bracket, link: LinkFn): string {
  if (bracket.series.length === 0) return "";
  const cols = bracket.rounds
    .map((round) => {
      const inRound = bracket.series.filter((s) => s.round === round);
      const boxes = inRound.map((s) => seriesBox(s, link)).join("");
      return `<div class="pb-col">
    <div class="pb-round-label">${esc(round)}</div>
    <div class="pb-round-body">${boxes}</div>
  </div>`;
    })
    .join("");
  return `<section class="bb-section">
  <h2 class="bb-section-title">Playoff bracket</h2>
  <div class="pb-bracket">${cols}</div>
</section>`;
}
