// Pure transform: an ESPN football raw envelope (./sources/espn.ts) →
// CanonicalFootballDailyData. No network, no Supabase, no globals — give it
// a FootballRaw blob (live or replayed from daily_raw) and it returns the
// canonical bundle every renderer downstream consumes. Mirrors
// lib/sports/mlb/adapters/from-statsapi.ts in spirit.
//
// The ESPN feed stores per-player box stats as positional string arrays
// aligned to a per-group `labels` header ("C/ATT", "YDS", …). Rather than
// trust label ORDER, we build a label→index map per group and pull each
// stat by name, so a feed reshuffle doesn't silently shift columns. Compound
// cells ("17/32", "1-8", "7-14") are split into their numeric parts here so
// the renderer never re-parses a vendor string.

import type { FootballLeagueConfig } from "../leagues";
import type { FootballRaw } from "../sources/espn";
import { sortGamesCanonically, type CanonicalFootballDailyData } from "../canonical";
import type {
  FootballTeamRef,
  FootballPlayerRef,
  FootballGame,
  FootballGameStatus,
  FootballSeasonType,
  FootballPeriodLine,
  FootballBoxScore,
  FootballTeamBox,
  FootballTeamTotals,
  FootballPassingLine,
  FootballRushingLine,
  FootballReceivingLine,
  FootballDefensiveLine,
  FootballKickingLine,
  FootballScoringPlay,
  FootballDrive,
  FootballRanking,
  FootballRankingEntry,
  FootballStandingsGroup,
  FootballStandingsRow,
} from "../types";

// ─── Small parsing helpers ────────────────────────────────────────────────

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" ? (v as Rec) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (v == null ? "" : String(v));

/** Parse a numeric cell, tolerating "—", "", commas, and trailing text.
 *  Returns 0 for unparseable numeric stats (a missing tackle count is 0),
 *  which the caller overrides with null where absence is meaningful. */
function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = parseFloat(str(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** null-preserving numeric parse: "" / "—" / undefined → null. */
function numOrNull(v: unknown): number | null {
  const s = str(v).trim();
  if (s === "" || s === "-" || s === "—") return null;
  const n = parseFloat(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Split a "made/att" or "conv-att" pair ("17/32", "7-14", "1-8") into two
 *  numbers. Falls back to [n, 0] for a bare number, [0, 0] for junk. */
function splitPair(v: unknown): [number, number] {
  const parts = str(v).split(/[\/-]/);
  if (parts.length >= 2) return [num(parts[0]), num(parts[1])];
  return [num(v), 0];
}

/** URL-safe player slug from a display name. Not globally unique in a first
 *  pass; stable per name. */
function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function playerRef(athlete: unknown): FootballPlayerRef {
  const a = rec(athlete);
  const fullName = str(a.displayName || a.fullName || a.shortName);
  return { id: str(a.id), fullName, slug: slugifyName(fullName) };
}

/** Build a canonical team ref from an ESPN team object. Canonical slug is
 *  the lowercased ESPN abbreviation — stable, and the value the NFL
 *  registry in lib/teams.ts is keyed to. `rank`/`conference` are attached
 *  by the caller for NCAAF. */
function teamRef(team: unknown, extra?: { rank?: number | null; conference?: string | null }): FootballTeamRef {
  const t = rec(team);
  const abbr = str(t.abbreviation || t.shortDisplayName || t.name).toUpperCase();
  return {
    id: abbr.toLowerCase(),
    name: str(t.displayName || t.name),
    abbr,
    espnId: str(t.id),
    rank: extra?.rank ?? null,
    conference: extra?.conference ?? null,
  };
}

// Map an ESPN status.type block to our coarse status. ESPN `state` is
// pre|in|post; specific descriptions carry postponed/canceled.
function mapStatus(statusType: Rec): FootballGameStatus {
  const state = str(statusType.state).toLowerCase();
  const name = str(statusType.name).toUpperCase();
  if (name.includes("POSTPONED")) return "postponed";
  if (name.includes("CANCELED") || name.includes("CANCELLED")) return "canceled";
  if (state === "pre") return "scheduled";
  if (state === "in") return "live";
  if (state === "post") return "final";
  return "unknown";
}

function mapSeasonType(seasonTypeNum: unknown): FootballSeasonType {
  switch (num(seasonTypeNum)) {
    case 1: return "pre";
    case 2: return "regular";
    case 3: return "post";
    default: return "unknown";
  }
}

function periodLines(linescores: unknown): FootballPeriodLine[] {
  return arr(linescores).map((ls) => {
    const l = rec(ls);
    return { period: num(l.period), points: numOrNull(l.value) };
  });
}

// ─── Scoreboard event → FootballGame ──────────────────────────────────────

function adaptGame(cfg: FootballLeagueConfig, event: unknown): FootballGame | null {
  const ev = rec(event);
  const comp = rec(arr(ev.competitions)[0]);
  const competitors = arr(comp.competitors).map(rec);
  const away = competitors.find((c) => str(c.homeAway) === "away");
  const home = competitors.find((c) => str(c.homeAway) === "home");
  if (!away || !home) return null;

  const season = rec(ev.season);
  const statusType = rec(rec(comp.status).type);

  const curatedRank = (c: Rec): number | null => {
    const r = num(rec(c.curatedRank).current);
    // ESPN uses 99 as the "unranked" sentinel.
    return r > 0 && r <= 25 ? r : null;
  };

  // Conference display is resolved from the standings feed, not the
  // scoreboard (which only carries a numeric conferenceId), so refs here
  // leave `conference` null; the standings section owns that mapping.
  const awayRef = teamRef(away.team, { rank: cfg.hasRankings ? curatedRank(away) : null });
  const homeRef = teamRef(home.team, { rank: cfg.hasRankings ? curatedRank(home) : null });

  const weekNum = numOrNull(rec(ev.week).number);
  const notes = arr(comp.notes).map(rec);
  const postseasonLabel = notes.length ? str(notes[0]!.headline) || null : null;

  return {
    id: str(ev.id),
    league: cfg.league,
    startTime: str(ev.date),
    seasonType: mapSeasonType(season.type),
    seasonYear: num(season.year),
    week: weekNum,
    postseasonLabel,
    status: mapStatus(statusType),
    statusDetail: str(statusType.shortDetail || statusType.detail || statusType.description),
    awayTeam: awayRef,
    homeTeam: homeRef,
    awayScore: numOrNull(away.score),
    homeScore: numOrNull(home.score),
    awayLine: periodLines(away.linescores),
    homeLine: periodLines(home.linescores),
    neutralSite: Boolean(comp.neutralSite),
    conferenceGame: Boolean(comp.conferenceCompetition),
    venueName: str(rec(comp.venue).fullName) || null,
  };
}

// ─── Summary → FootballBoxScore ───────────────────────────────────────────

// Build a label→index map for a stat group so stats are pulled by name.
function labelIndex(labels: unknown): Record<string, number> {
  const map: Record<string, number> = {};
  arr(labels).forEach((l, i) => { map[str(l).toUpperCase()] = i; });
  return map;
}

// Pull a cell from an athlete's positional stats array by label name.
function cell(stats: unknown[], idx: Record<string, number>, label: string): unknown {
  const i = idx[label.toUpperCase()];
  return i == null ? undefined : stats[i];
}

function findGroup(groups: Rec[], name: string): Rec | undefined {
  return groups.find((g) => str(g.name).toLowerCase() === name);
}

function adaptTeamBox(playersEntry: unknown, teamsEntry: unknown, cfg: FootballLeagueConfig): FootballTeamBox {
  const pe = rec(playersEntry);
  const groups = arr(pe.statistics).map(rec);
  const ref = teamRef(pe.team);

  const passing: FootballPassingLine[] = [];
  const rushing: FootballRushingLine[] = [];
  const receiving: FootballReceivingLine[] = [];
  const defense: FootballDefensiveLine[] = [];
  const kicking: FootballKickingLine[] = [];

  const pg = findGroup(groups, "passing");
  if (pg) {
    const idx = labelIndex(pg.labels);
    for (const a of arr(pg.athletes).map(rec)) {
      const s = arr(a.stats);
      const [cmp, att] = splitPair(cell(s, idx, "C/ATT"));
      const [sk, skyd] = splitPair(cell(s, idx, "SACKS"));
      passing.push({
        player: playerRef(a.athlete),
        completions: cmp, attempts: att,
        yards: num(cell(s, idx, "YDS")),
        touchdowns: num(cell(s, idx, "TD")),
        interceptions: num(cell(s, idx, "INT")),
        sacks: sk, sackYards: skyd,
        qbr: numOrNull(cell(s, idx, "QBR")),
        rating: numOrNull(cell(s, idx, "RTG")),
      });
    }
  }

  const rg = findGroup(groups, "rushing");
  if (rg) {
    const idx = labelIndex(rg.labels);
    for (const a of arr(rg.athletes).map(rec)) {
      const s = arr(a.stats);
      rushing.push({
        player: playerRef(a.athlete),
        carries: num(cell(s, idx, "CAR")),
        yards: num(cell(s, idx, "YDS")),
        touchdowns: num(cell(s, idx, "TD")),
        long: num(cell(s, idx, "LONG")),
      });
    }
  }

  const rcg = findGroup(groups, "receiving");
  if (rcg) {
    const idx = labelIndex(rcg.labels);
    for (const a of arr(rcg.athletes).map(rec)) {
      const s = arr(a.stats);
      receiving.push({
        player: playerRef(a.athlete),
        receptions: num(cell(s, idx, "REC")),
        yards: num(cell(s, idx, "YDS")),
        touchdowns: num(cell(s, idx, "TD")),
        long: num(cell(s, idx, "LONG")),
        targets: numOrNull(cell(s, idx, "TGTS")),
      });
    }
  }

  const dg = findGroup(groups, "defensive");
  if (dg) {
    const idx = labelIndex(dg.labels);
    for (const a of arr(dg.athletes).map(rec)) {
      const s = arr(a.stats);
      const [sk] = splitPair(cell(s, idx, "SACKS"));
      defense.push({
        player: playerRef(a.athlete),
        tackles: num(cell(s, idx, "TOT")),
        soloTackles: num(cell(s, idx, "SOLO")),
        sacks: sk,
        tacklesForLoss: num(cell(s, idx, "TFL")),
        passesDefended: num(cell(s, idx, "PD")),
        qbHits: num(cell(s, idx, "QB HTS")),
        touchdowns: num(cell(s, idx, "TD")),
      });
    }
  }

  const kg = findGroup(groups, "kicking");
  if (kg) {
    const idx = labelIndex(kg.labels);
    for (const a of arr(kg.athletes).map(rec)) {
      const s = arr(a.stats);
      const [fgm, fga] = splitPair(cell(s, idx, "FG"));
      const [xpm, xpa] = splitPair(cell(s, idx, "XP"));
      kicking.push({
        player: playerRef(a.athlete),
        fgMade: fgm, fgAttempts: fga,
        longFg: num(cell(s, idx, "LONG")),
        xpMade: xpm, xpAttempts: xpa,
        points: num(cell(s, idx, "PTS")),
      });
    }
  }

  return { team: ref, totals: teamTotals(teamsEntry), passing, rushing, receiving, defense, kicking };
}

// boxscore.teams[] carries ~25 labeled team stats as {name,displayValue}.
function teamTotals(teamsEntry: unknown): FootballTeamTotals {
  const te = rec(teamsEntry);
  const byName: Record<string, string> = {};
  for (const s of arr(te.statistics).map(rec)) byName[str(s.name)] = str(s.displayValue);
  const [thirdConv, thirdAtt] = splitPair(byName.thirdDownEff);
  const [pen, penYds] = splitPair(byName.totalPenaltiesYards);
  return {
    firstDowns: numOrNull(byName.firstDowns),
    totalPlays: numOrNull(byName.totalOffensivePlays),
    totalYards: numOrNull(byName.totalYards),
    passingYards: numOrNull(byName.netPassingYards),
    rushingYards: numOrNull(byName.rushingYards),
    turnovers: numOrNull(byName.turnovers),
    thirdDownConversions: byName.thirdDownEff ? thirdConv : null,
    thirdDownAttempts: byName.thirdDownEff ? thirdAtt : null,
    penalties: byName.totalPenaltiesYards ? pen : null,
    penaltyYards: byName.totalPenaltiesYards ? penYds : null,
    possession: byName.possessionTime || null,
  };
}

function adaptScoringPlays(summary: Rec): FootballScoringPlay[] {
  return arr(summary.scoringPlays).map(rec).map((p) => ({
    period: num(rec(p.period).number),
    clock: str(rec(p.clock).displayValue),
    team: teamRef(p.team),
    scoringType: str(rec(p.scoringType).name || p.type),
    text: str(p.text),
    awayScore: num(p.awayScore),
    homeScore: num(p.homeScore),
  }));
}

function adaptDrives(summary: Rec): FootballDrive[] {
  const previous = arr(rec(summary.drives).previous).map(rec);
  return previous.map((d) => ({
    team: teamRef(d.team),
    result: str(d.result || d.shortDisplayResult),
    description: str(d.description),
    plays: num(d.offensivePlays),
    yards: num(d.yards),
    scored: Boolean(d.isScore),
  }));
}

function adaptBoxScore(cfg: FootballLeagueConfig, gameId: string, summary: unknown): FootballBoxScore | null {
  const s = rec(summary);
  const box = rec(s.boxscore);
  const players = arr(box.players).map(rec);
  if (players.length < 2) return null; // no box yet (scheduled/just-kicked)

  const teams = arr(box.teams).map(rec);
  const totalsFor = (espnTeamId: string) =>
    teams.find((t) => str(rec(t.team).id) === espnTeamId);

  // players[] order isn't guaranteed home/away, so pair each player entry
  // with its matching team-totals entry by team id.
  const boxes = players.map((pe) => {
    const espnTeamId = str(rec(pe.team).id);
    return adaptTeamBox(pe, totalsFor(espnTeamId), cfg);
  });

  // Determine home/away from the header competitors.
  const competitors = arr(rec(arr(rec(s.header).competitions)[0]).competitors).map(rec);
  const homeId = str(rec(competitors.find((c) => str(c.homeAway) === "home")?.team).id);
  const away = boxes.find((b) => b.team.espnId !== homeId) ?? boxes[0]!;
  const home = boxes.find((b) => b.team.espnId === homeId) ?? boxes[1]!;

  const gameInfo = rec(s.gameInfo);
  const weather = rec(gameInfo.weather);

  return {
    gameId,
    away,
    home,
    scoringPlays: adaptScoringPlays(s),
    drives: adaptDrives(s),
    venueName: str(rec(gameInfo.venue).fullName) || null,
    attendance: numOrNull(gameInfo.attendance),
    weather: str(weather.displayValue) || null,
  };
}

// ─── Rankings (NCAAF) ─────────────────────────────────────────────────────

function adaptRankings(raw: FootballRaw): FootballRanking[] {
  const lists = arr(rec(raw.rankings).rankings).map(rec);
  return lists
    // Keep the polls that matter to an FBS recap; drop FCS / Div II / III.
    .filter((l) => /AP Top 25|Coaches Poll|College Football Playoff|CFP/i.test(str(l.name)) && !/FCS|Division/i.test(str(l.name)))
    .map((l): FootballRanking => ({
      poll: str(l.name),
      entries: arr(l.ranks).map(rec).map((r): FootballRankingEntry => ({
        rank: num(r.current),
        team: teamRef(r.team),
        record: (() => {
          const summary = str(rec(arr(r.stats).map(rec).find((st) => str(st.name) === "overall")).displayValue);
          return summary || str(r.recordSummary) || null;
        })(),
        points: numOrNull(r.points),
        firstPlaceVotes: numOrNull(r.firstPlaceVotes),
        previousRank: (() => { const p = num(r.previous); return p > 0 ? p : null; })(),
      })),
    }));
}

// ─── Standings ────────────────────────────────────────────────────────────
//
// ESPN's standings payload nests groups (conference → division for the NFL,
// conference for college) under `children`, each with a `standings.entries`
// array where every entry has a team and a `stats` array keyed by `name`.
// Tolerant by design: unexpected shapes yield [] rather than throwing, since
// standings are a secondary section behind the scoreboard + boxes.

function statByName(stats: Rec[], name: string): unknown {
  return rec(stats.find((s) => str(s.name) === name)).value;
}

function adaptStandingsGroup(node: Rec, parentConference: string | null): FootballStandingsGroup[] {
  const groupName = str(node.name || node.abbreviation);
  const children = arr(node.children).map(rec);
  if (children.length) {
    // A conference with divisions (NFL): recurse, tagging conference.
    return children.flatMap((c) => adaptStandingsGroup(c, groupName || parentConference));
  }
  const entries = arr(rec(node.standings).entries).map(rec);
  if (!entries.length) return [];
  const rows: FootballStandingsRow[] = entries.map((e) => {
    const stats = arr(e.stats).map(rec);
    return {
      team: teamRef(e.team),
      wins: num(statByName(stats, "wins")),
      losses: num(statByName(stats, "losses")),
      ties: num(statByName(stats, "ties")),
      pct: numOrNull(statByName(stats, "winPercent")),
      confWins: numOrNull(statByName(stats, "vsConf_wins")),
      confLosses: numOrNull(statByName(stats, "vsConf_losses")),
      pointsFor: numOrNull(statByName(stats, "pointsFor")),
      pointsAgainst: numOrNull(statByName(stats, "pointsAgainst")),
      streak: str(rec(stats.find((s) => str(s.name) === "streak")).displayValue) || null,
    };
  });
  return [{ group: groupName, conference: parentConference, rows }];
}

function adaptStandings(raw: FootballRaw): FootballStandingsGroup[] {
  const root = rec(raw.standings);
  // ESPN returns either {children:[...]} or {standings:{entries}} at top level.
  const top = arr(root.children).map(rec);
  if (top.length) return top.flatMap((c) => adaptStandingsGroup(c, null));
  return adaptStandingsGroup(root, null);
}

// ─── Top-level adapter ────────────────────────────────────────────────────

export function adaptEspnFootball(
  cfg: FootballLeagueConfig,
  raw: FootballRaw,
): CanonicalFootballDailyData {
  const events = arr(rec(raw.scoreboard).events);
  const games = sortGamesCanonically(
    events.map((e) => adaptGame(cfg, e)).filter((g): g is FootballGame => g != null),
  );

  const boxScores = new Map<string, FootballBoxScore>();
  for (const [id, summary] of Object.entries(raw.summaries)) {
    const box = adaptBoxScore(cfg, id, summary);
    if (box) boxScores.set(id, box);
  }

  return {
    date: raw.date,
    league: cfg.league,
    games,
    boxScores,
    rankings: cfg.hasRankings ? adaptRankings(raw) : [],
    standings: adaptStandings(raw),
  };
}
