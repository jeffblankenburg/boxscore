// Data assembler for the daily per-game lineup card (issue #140). Pulls one
// game's pregame picture from statsapi: both starting lineups (batting order +
// position), the probable starters, each batter's career line vs the opposing
// starter (vsPlayerTotal), broadcasts (TV + radio), start time, and venue.
//
// Odds are attached separately via loadCardOdds() (fresh ESPN for ML/run-line/
// total + FanDuel NRFI from daily_odds) — loadLineupCard itself leaves `odds` null.

import { fetchEspnOddsForDate, indexOddsByMatchup } from "./odds-espn";
import { fetchFanDuelNrfiForDate } from "./odds-fanduel";
import { TEAMS } from "@/lib/teams";

const BASE = "https://statsapi.mlb.com/api";

async function getJson(path: string): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`statsapi ${res.status} for ${path}`);
  return res.json();
}
function rec(v: unknown): Record<string, unknown> { return v && typeof v === "object" ? v as Record<string, unknown> : {}; }
function arr(v: unknown): unknown[] { return Array.isArray(v) ? v : []; }
function str(v: unknown): string { return typeof v === "string" ? v : v == null ? "" : String(v); }
function num(v: unknown): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }

export type LineupCardBatter = {
  order: number;      // 1-9
  pos: string;        // "SS"
  name: string;
  id: number;
  bats: string;       // "L" | "R" | "S" (switch); "" if unknown
  // Season line — the classic hitting stats.
  ba: string;         // ".285"
  ops: string;        // ".812"
  r: number;
  hr: number;
  rbi: number;
  sb: number;
  vsLine: string;     // career vs the opposing starter: "6-19, 2 HR" | "first meeting"
};

export type LineupCardPitcher = {
  id: number;
  name: string;
  hand: string;        // "R" | "L" | ""
  wl: string;          // "10-9"
  era: string;         // "3.61"
  whip: string;        // "1.10"
  k9: string;          // "9.3"
  bb9: string;         // "1.8"
  hr9: string;         // "1.6"
  firstEra: string;    // first-inning ERA, "2.86"
  ipPerApp: string;    // avg innings per appearance (outs/3/gamesPitched), "4.6"
};

export type LineupCardBroadcasts = { tv: string[]; radio: string[] };

export type LineupCardTeam = {
  abbr: string;
  name: string;
  teamName: string;    // nickname ("Mets") — the social hashtag lookup key
  record: string;      // "74-88" (leagueRecord); "" if unavailable
  probable: LineupCardPitcher | null;
  batters: LineupCardBatter[];
  broadcasts: LineupCardBroadcasts;
};

export type LineupCardOdds = {
  awayMl: number | null;
  homeMl: number | null;
  // Run line, both sides: line is "+1.5"/"-1.5", odds the American juice.
  runLine: { away: { line: string; odds: number | null }; home: { line: string; odds: number | null } } | null;
  total: number | null;
  overOdds: number | null;    // juice on the over
  underOdds: number | null;   // juice on the under
  nrfi: number | null;   // No Runs First Inning (FanDuel), American odds
  yrfi: number | null;   // Yes Runs First Inning (FanDuel), American odds
  book: string;          // "DraftKings" — source of the game lines
  capturedAt: string;    // ISO — when we pulled the lines (render time)
} | null;

export type LineupCardData = {
  gamePk: number;
  date: string;         // games date (YYYY-MM-DD)
  startUtc: string;     // ISO
  venue: string;
  weather: string;      // "62°, Rain, Wind 14 mph L To R"; "" if not posted yet
  away: LineupCardTeam;
  home: LineupCardTeam;
  national: string[];   // national TV, if any
  odds: LineupCardOdds;
};

type BatterStats = { ba: string; ops: string; r: number; hr: number; rbi: number; sb: number; vsLine: string };

// One call per batter returns BOTH the season line (AVG/HR/SB) and the career
// line vs the opposing starter. "first meeting" when they've never faced him.
async function batterStats(batterId: number, pitcherId: number | null, season: number): Promise<BatterStats> {
  const empty: BatterStats = { ba: "—", ops: "—", r: 0, hr: 0, rbi: 0, sb: 0, vsLine: pitcherId ? "first meeting" : "" };
  try {
    const opp = pitcherId ? `&opposingPlayerId=${pitcherId}` : "";
    const raw = await getJson(`/v1/people/${batterId}/stats?stats=season,vsPlayerTotal&group=hitting&season=${season}${opp}&sportId=1`);
    const blocks = arr(rec(raw).stats).map(rec);
    const blockStat = (name: string) => {
      const b = blocks.find((x) => str(rec(x.type).displayName) === name);
      return rec(arr(rec(b).splits)[0]).stat;
    };
    const season0 = blockStat("season");
    const ba = str(rec(season0).avg) || "—";
    const ops = str(rec(season0).ops) || "—";

    let vsLine = pitcherId ? "first meeting" : "";
    if (pitcherId) {
      const vs = blockStat("vsPlayerTotal");
      if (num(rec(vs).plateAppearances) > 0) {
        const h = num(rec(vs).hits), ab = num(rec(vs).atBats), vhr = num(rec(vs).homeRuns);
        vsLine = vhr > 0 ? `${h}-${ab}, ${vhr} HR` : `${h}-${ab}`;
      }
    }
    return {
      ba,
      ops,
      r: num(rec(season0).runs),
      hr: num(rec(season0).homeRuns),
      rbi: num(rec(season0).rbi),
      sb: num(rec(season0).stolenBases),
      vsLine,
    };
  } catch {
    return empty;
  }
}

// statsapi weather is a forecast until ~a few hours pre-game, then game-time
// conditions. Empty ({}) far out; posts by the time a card fires. "" if absent.
function formatWeather(game: Record<string, unknown>): string {
  const w = rec(game.weather);
  const cond = str(w.condition);
  const temp = str(w.temp);
  const wind = str(w.wind);
  const parts: string[] = [];
  if (temp) parts.push(`${temp}°`);
  if (cond) parts.push(cond);
  if (wind) parts.push(`Wind ${wind.replace(/,\s*/, " ")}`);   // "14 mph, L To R" -> "14 mph L To R"
  return parts.join(", ");
}

function broadcastsFor(game: Record<string, unknown>): { away: LineupCardBroadcasts; home: LineupCardBroadcasts; national: string[] } {
  const away: LineupCardBroadcasts = { tv: [], radio: [] };
  const home: LineupCardBroadcasts = { tv: [], radio: [] };
  const national: string[] = [];
  for (const b of arr(game.broadcasts).map(rec)) {
    const name = str(b.name) || str(b.callSign);
    if (!name) continue;
    const isTv = str(b.type).toUpperCase() === "TV";
    if (b.isNational === true && isTv) { national.push(name); continue; }
    const side = str(b.homeAway) === "home" ? home : away;
    if (isTv) {
      side.tv.push(name);
    } else {
      // Radio names are verbose ("Audacy Mets Radio WHSQ 880AM"); the call sign
      // ("WHSQ 880AM") is the clean, recognizable label when it looks like one.
      const cs = str(b.callSign);
      side.radio.push(/\d|AM|FM/i.test(cs) ? cs : name);
    }
  }
  return { away, home, national };
}

async function pitcherFrom(side: Record<string, unknown>, season: number): Promise<LineupCardPitcher | null> {
  const p = rec(side.probablePitcher);
  const id = num(p.id);
  if (!id) return null;
  let hand = "";
  let st: Record<string, unknown> = {};
  let fst: Record<string, unknown> = {};
  try {
    // One hydrated call for hand + season line; a second for the first-inning
    // split (first-inning ERA — the NRFI-adjacent number the sharps look at).
    const [personRaw, splitRaw] = await Promise.all([
      getJson(`/v1/people/${id}?hydrate=stats(group=[pitching],type=[season],season=${season})`),
      getJson(`/v1/people/${id}/stats?stats=statSplits&group=pitching&sitCodes=i01&season=${season}`).catch(() => null),
    ]);
    const person = rec(arr(rec(personRaw).people)[0]);
    hand = str(rec(person.pitchHand).code);
    st = rec(rec(arr(rec(arr(rec(person).stats)[0]).splits)[0]).stat);
    fst = rec(rec(arr(rec(arr(rec(splitRaw).stats)[0]).splits)[0]).stat);
  } catch { /* stats optional */ }

  const one = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n.toFixed(1) : "—"; };
  // Innings per APPEARANCE — season totals can't separate starter-only innings,
  // and dividing total outs by starts double-counts a swingman's relief work
  // (Manaea: 452 outs over 33 games / 19 starts would read a bogus 7.9). Outs
  // per game pitched is the honest, unambiguous "how long per outing."
  const gp = num(st.gamesPitched);
  const outs = num(st.outs);
  return {
    id, name: str(p.fullName), hand,
    wl: `${num(st.wins)}-${num(st.losses)}`,
    era: str(st.era) || "—",
    whip: str(st.whip) || "—",
    k9: one(st.strikeoutsPer9Inn),
    bb9: one(st.walksPer9Inn),
    hr9: one(st.homeRunsPer9),
    firstEra: str(fst.era) || "—",
    ipPerApp: gp > 0 ? (outs / 3 / gp).toFixed(1) : "—",
  };
}

// Bat side (L/R/S) for a set of players in one batched call — the lineup nodes
// don't carry it, so we hydrate it from /people?personIds=.
async function batSidesFor(ids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (ids.length === 0) return out;
  try {
    const raw = await getJson(`/v1/people?personIds=${ids.join(",")}`);
    for (const p of arr(rec(raw).people).map(rec)) {
      out.set(num(p.id), str(rec(p.batSide).code));
    }
  } catch { /* bat side optional */ }
  return out;
}

async function teamFrom(
  side: Record<string, unknown>,
  players: unknown[],
  opposingPitcherId: number | null,
  broadcasts: LineupCardBroadcasts,
  season: number,
): Promise<LineupCardTeam> {
  const team = rec(side.team);
  const lr = rec(side.leagueRecord);
  const record = lr.wins != null && lr.losses != null ? `${num(lr.wins)}-${num(lr.losses)}` : "";
  const lineup = arr(players).map(rec);
  const [probable, bats] = await Promise.all([
    pitcherFrom(side, season),
    batSidesFor(lineup.map((pl) => num(pl.id))),
  ]);
  const batters = await Promise.all(lineup.map(async (pl, i): Promise<LineupCardBatter> => {
    const id = num(pl.id);
    const s = await batterStats(id, opposingPitcherId, season);
    return {
      order: i + 1,
      pos: str(rec(pl.primaryPosition).abbreviation),
      name: str(pl.fullName),
      id,
      bats: bats.get(id) ?? "",
      ba: s.ba, ops: s.ops, r: s.r, hr: s.hr, rbi: s.rbi, sb: s.sb, vsLine: s.vsLine,
    };
  }));
  return { abbr: str(team.abbreviation), name: str(team.name), teamName: str(team.teamName), record, probable, batters, broadcasts };
}

export type SlateGame = { gamePk: number; startUtc: string; state: string };

// The day's MLB slate as lightweight rows (gamePk + first-pitch time + coarse
// status), so the poll cron can pick which games are pregame + inside the
// posting window before doing the heavy per-game card load. One schedule call.
export async function loadSlate(date: string): Promise<SlateGame[]> {
  const sched = await getJson(`/v1/schedule?sportId=1&date=${date}`);
  const games = arr(rec(arr(rec(sched).dates)[0]).games).map(rec);
  return games.map((g) => ({
    gamePk: num(g.gamePk),
    startUtc: str(g.gameDate),
    state: str(rec(g.status).abstractGameState),   // "Preview" | "Live" | "Final"
  }));
}

// One game's full pregame card data. Returns null if the game isn't found or the
// lineups aren't posted yet (both sides must have a 9-man lineup).
export async function loadLineupCard(gamePk: number): Promise<LineupCardData | null> {
  const sched = await getJson(`/v1/schedule?sportId=1&gamePk=${gamePk}&hydrate=lineups,probablePitcher,broadcasts(all),team,venue,weather`);
  const game = rec(arr(rec(arr(rec(sched).dates)[0]).games)[0]);
  if (!game.gamePk) return null;

  const teams = rec(game.teams);
  const awaySide = rec(teams.away);
  const homeSide = rec(teams.home);
  const lineups = rec(game.lineups);
  const awayPlayers = arr(lineups.awayPlayers);
  const homePlayers = arr(lineups.homePlayers);
  if (awayPlayers.length < 9 || homePlayers.length < 9) return null;   // lineups not posted yet

  const awayProbId = num(rec(awaySide.probablePitcher).id) || null;
  const homeProbId = num(rec(homeSide.probablePitcher).id) || null;
  const bc = broadcastsFor(game);
  const gameDate = str(game.officialDate) || str(game.gameDate).slice(0, 10);
  const season = Number(gameDate.slice(0, 4));

  // Away batters face the HOME starter; home batters face the AWAY starter.
  const [away, home] = await Promise.all([
    teamFrom(awaySide, awayPlayers, homeProbId, bc.away, season),
    teamFrom(homeSide, homePlayers, awayProbId, bc.home, season),
  ]);

  return {
    gamePk: num(game.gamePk),
    date: gameDate,
    startUtc: str(game.gameDate),
    venue: str(rec(game.venue).name),
    weather: formatWeather(game),
    away,
    home,
    national: bc.national,
    odds: null,
  };
}

// Canonical MLB team name → abbreviation, so FanDuel's full names ("Boston Red
// Sox") key into the same abbr-pair index the ESPN lines use. The `.`-stripped
// variant tolerates the "St. Louis" vs "St Louis" trap.
const MLB_NAME_TO_ABBR: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const t of TEAMS) {
    if (t.sport !== "mlb") continue;
    m.set(t.name.toLowerCase(), t.abbreviation);
    m.set(t.name.toLowerCase().replace(/\./g, ""), t.abbreviation);
  }
  return m;
})();
function abbrForFanDuelName(name: string): string | null {
  const k = name.toLowerCase();
  return MLB_NAME_TO_ABBR.get(k) ?? MLB_NAME_TO_ABBR.get(k.replace(/\./g, "")) ?? null;
}

// A resolver for a whole slate's odds, so the poll cron fetches the books once
// and reuses the result across every card it renders. ML/run-line/total come
// live from ESPN (DraftKings); NRFI/YRFI come live from FanDuel's "1st Inning
// 0.5 Runs" market. Both fetched fresh here — no dependency on the odds-poll
// cron or daily_odds, so the card's first-inning line is always current.
export type CardOddsResolver = (awayAbbr: string, homeAbbr: string) => LineupCardOdds;

export async function loadCardOdds(date: string): Promise<CardOddsResolver> {
  const [espnRows, fdRows] = await Promise.all([
    fetchEspnOddsForDate(date).catch(() => []),
    fetchFanDuelNrfiForDate(date).catch(() => []),
  ]);
  const espn = indexOddsByMatchup(espnRows);
  // Index FanDuel first-inning lines by canonical abbr pair (matches ESPN key).
  const firstInn = new Map<string, { nrfi: number | null; yrfi: number | null }>();
  for (const r of fdRows) {
    const a = abbrForFanDuelName(r.awayTeamName);
    const h = abbrForFanDuelName(r.homeTeamName);
    if (a && h) firstInn.set(`${a}|${h}`, { nrfi: r.nrfiOdds, yrfi: r.yrfiOdds });
  }
  // Stamp the pull time once for the whole slate — these are live lines, so
  // "captured at" is when this resolver was built (render/poll time).
  const capturedAt = new Date().toISOString();
  return (awayAbbr, homeAbbr) => {
    const row = espn.get(`${awayAbbr}|${homeAbbr}`);
    const fi = firstInn.get(`${awayAbbr}|${homeAbbr}`);
    const nrfi = fi?.nrfi ?? null;
    const yrfi = fi?.yrfi ?? null;
    if (!row && nrfi == null && yrfi == null) return null;
    return {
      awayMl: row?.awayMl ?? null,
      homeMl: row?.homeMl ?? null,
      runLine: row?.awayRlLine && row.homeRlLine
        ? {
            away: { line: row.awayRlLine, odds: row.awayRlOdds },
            home: { line: row.homeRlLine, odds: row.homeRlOdds },
          }
        : null,
      total: row?.total ?? null,
      overOdds: row?.overOdds ?? null,
      underOdds: row?.underOdds ?? null,
      nrfi,
      yrfi,
      book: row?.book ?? "DraftKings",
      capturedAt,
    };
  };
}
