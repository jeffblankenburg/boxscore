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
  seed?: number | null; // playoff seed when known (null for leagues without one)
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

// Colors matched to the MLB postseason bracket (lib/sports/mlb/render/postseason
// .ts) so the two read identically — including how mail clients invert the
// white boxes in dark mode.
const BK_LINE = "#333333";
const BK_WON = "#000000";
const BK_LOST = "#999999";
const BOX_W = 66;
const CONN_W = 14;
const FONT = "Arial,Helvetica,sans-serif";

// ---- Tree reconstruction --------------------------------------------------

type Tree = {
  byRound: BracketSeries[][];
  childrenOf: Map<BracketSeries, [BracketSeries, BracketSeries]>;
  topOf: Map<BracketSeries, number>;
  rows: number;
};

// A bracket is a binary tree, but assembleBracket only knows the flat per-round
// series list — not which series feeds which. Reconstruct the edges by matching
// each series' two teams back to the prior round's series that contained them.
// Returns null when the structure isn't a clean, balanced single-rooted tree
// (then the caller falls back to the columnar list).
function buildTree(bracket: Bracket): Tree | null {
  const byRound = bracket.rounds.map((r) => bracket.series.filter((s) => s.round === r));
  if (byRound.length < 2 || byRound.some((g) => g.length === 0)) return null;
  const last = byRound[byRound.length - 1]!;
  if (last.length !== 1) return null; // one champion series at the top

  const childrenOf = new Map<BracketSeries, [BracketSeries, BracketSeries]>();
  for (let k = 1; k < byRound.length; k++) {
    const prev = byRound[k - 1]!;
    for (const s of byRound[k]!) {
      const child = (teamId: string) => prev.find((c) => c.top.teamId === teamId || c.bottom.teamId === teamId);
      const a = child(s.top.teamId);
      const b = child(s.bottom.teamId);
      if (!a || !b || a === b) return null; // can't resolve a clean tree
      childrenOf.set(s, [a, b]);
    }
  }

  // In-order leaf assignment: each leaf (first-round series) gets a 4-row slot,
  // each internal node sits at the midpoint of its two children.
  const topOf = new Map<BracketSeries, number>();
  let slot = 0;
  const assign = (s: BracketSeries): number => {
    const kids = childrenOf.get(s);
    const t = kids ? (assign(kids[0]) + assign(kids[1])) / 2 : (slot++ * 4);
    topOf.set(s, t);
    return t;
  };
  assign(last[0]!);
  if (slot !== byRound[0]!.length) return null; // not balanced

  return { byRound, childrenOf, topOf, rows: slot * 4 - 2 };
}

// ---- Table (connector-line) bracket ---------------------------------------

function teamCell(e: BracketEntrant | undefined, isWinner: boolean, decided: boolean): string {
  if (!e) return "";
  const color = decided && !isWinner ? BK_LOST : BK_WON;
  const weight = isWinner ? 700 : 400;
  const seed = e.seed != null ? `<span style="color:${BK_LOST};font-weight:700">${e.seed}</span> ` : "";
  return `${seed}<span style="color:${color};font-weight:${weight}">${esc(e.abbr)}</span>`
    + ` <span style="color:${color};font-weight:${weight}">${e.wins}</span>`;
}

function boxTd(content: string): string {
  return `<td width="${BOX_W}" style="border:1px solid ${BK_LINE};padding:4px 6px;`
    + `font-family:${FONT};font-size:12px;line-height:1.2;white-space:nowrap;background:#ffffff">${content}</td>`;
}
const emptyTd = `<td width="${BOX_W}"></td>`;
function connTd(bottom: boolean, right: boolean): string {
  const b = [bottom ? `border-bottom:1px solid ${BK_LINE}` : "", right ? `border-right:1px solid ${BK_LINE}` : ""].filter(Boolean);
  return `<td width="${CONN_W}" style="${b.join(";")}"></td>`;
}

// Short column header — drop the league/conference prefix so it fits the box.
function roundHeader(label: string): string {
  const short = label.replace(/^(WNBA|NBA|NHL|Eastern|Western)\s+/i, "");
  return `<td style="font-family:${FONT};font-size:10px;font-weight:700;letter-spacing:.04em;`
    + `text-transform:uppercase;color:${BK_LINE};text-align:center;padding:0 0 3px">${esc(short)}</td>`;
}

function renderBracketTree(bracket: Bracket, t: Tree): string {
  const nRounds = t.byRound.length;
  // Header row: a label over each box column, blanks over the connectors.
  const headerCells: string[] = [];
  for (let c = 0; c < nRounds; c++) {
    headerCells.push(roundHeader(bracket.rounds[c]!));
    if (c < nRounds - 1) headerCells.push(`<td></td>`);
  }

  const bodyRows: string[] = [];
  for (let row = 0; row < t.rows; row++) {
    const cells: string[] = [];
    for (let c = 0; c < nRounds; c++) {
      // Box column: top team at topOf, bottom team at topOf+1.
      const s = t.byRound[c]!.find((x) => t.topOf.get(x) === row || t.topOf.get(x) === row - 1);
      if (s && t.topOf.get(s) === row) cells.push(boxTd(teamCell(s.top, s.winnerTeamId === s.top.teamId, s.winnerTeamId != null)));
      else if (s) cells.push(boxTd(teamCell(s.bottom, s.winnerTeamId === s.bottom.teamId, s.winnerTeamId != null)));
      else cells.push(emptyTd);
      // Connector column into the next round.
      if (c < nRounds - 1) {
        let bottom = false, right = false;
        for (const parent of t.byRound[c + 1]!) {
          const kids = t.childrenOf.get(parent);
          if (!kids) continue;
          let a = t.topOf.get(kids[0])!, b = t.topOf.get(kids[1])!;
          if (a > b) [a, b] = [b, a];
          if (row === a || row === b) bottom = true;
          if (row > a && row <= b) right = true;
        }
        cells.push(connTd(bottom, right));
      }
    }
    bodyRows.push(`<tr>${cells.join("")}</tr>`);
  }

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" `
    + `style="border-collapse:collapse;margin:2px 0 6px"><tr>${headerCells.join("")}</tr>${bodyRows.join("")}</table>`;
}

// ---- Columnar fallback (non-tree brackets) --------------------------------

function entrantRow(e: BracketEntrant, isWinner: boolean, link: LinkFn): string {
  const cls = isWinner ? "pb-team pb-win" : "pb-team";
  return `<div class="${cls}"><span class="pb-nm">${link(e.name)}</span><span class="pb-w">${e.wins}</span></div>`;
}

function renderBracketColumnar(bracket: Bracket, link: LinkFn): string {
  const cols = bracket.rounds
    .map((round) => {
      const boxes = bracket.series.filter((s) => s.round === round).map((s) =>
        `<div class="pb-series">${entrantRow(s.top, s.winnerTeamId === s.top.teamId, link)}${entrantRow(s.bottom, s.winnerTeamId === s.bottom.teamId, link)}</div>`,
      ).join("");
      return `<div class="pb-col"><div class="pb-round-label">${esc(round)}</div><div class="pb-round-body">${boxes}</div></div>`;
    })
    .join("");
  return `<div class="pb-bracket">${cols}</div>`;
}

// Visual connector-line bracket (matches the MLB postseason bracket). Falls back
// to the columnar list when the series can't be resolved into a clean tree.
export function renderBracket(bracket: Bracket, link: LinkFn): string {
  if (bracket.series.length === 0) return "";
  const tree = buildTree(bracket);
  const inner = tree ? renderBracketTree(bracket, tree) : renderBracketColumnar(bracket, link);
  return `<section class="bb-section">
  <h2 class="bb-section-title">Playoff bracket</h2>
  ${inner}
</section>`;
}
