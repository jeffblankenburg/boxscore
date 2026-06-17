// Pure transform: a SportsDataIO daily payload → CanonicalDailyData.
// Mirrors from-statsapi.ts in shape; the canonical preview tool feeds
// one or the other adapter the same way and gets identical canonical
// types either way. This is the only file that knows SDIO's vocabulary
// AND the canonical model — everything downstream sees canonical.
//
// Coverage today: games, box scores, standings, leaders, transactions
// — the four sections the canonical renderer ships. Player profiles,
// rosters, splits, fielding live elsewhere when we expand the preview.
//
// Quirk worth flagging:
//
//   Game type collapse. SDIO's SeasonType=3 covers every post-season
//   round (WC, DS, LCS, WS). We tag them all "world-series" today —
//   good enough for a final-status digest but refine if we ever render
//   bracket-aware copy.
//
// Leader qualification follows MLB's official rate-stat rule (3.1 PA ×
// team games for batting, 1.0 IP × team games for pitching) — not a
// hardcoded constant. SDIO doesn't pre-apply this, so we compute team
// games from Standings (W + L) and enforce it in leaderboardsFromRaw.

import { canonicalTeamRefForRef } from "@/lib/teams";
import { lastName } from "@/lib/names";
import type { SdioDailyPayload } from "../sources/sdio-fetch-daily";
import { sortGamesCanonically, type CanonicalDailyData } from "../canonical";
import { playerRef } from "../player-ref";
import type {
  MlbBoxBatting,
  MlbBoxInfo,
  MlbBoxPitching,
  MlbBoxPlayer,
  MlbBoxScore,
  MlbBoxTeam,
  MlbBoxTeamTotals,
  MlbDivision,
  MlbDivisionStandings,
  MlbGame,
  MlbGameStatus,
  MlbGameType,
  MlbInningLine,
  MlbLeaderboard,
  MlbLeaderCategory,
  MlbLeaderEntry,
  MlbLeague,
  MlbRecord,
  MlbScoringPlay,
  MlbStandingRow,
  MlbTeamRef,
  MlbTransaction,
  MlbWildCardStandings,
} from "../types";

// ─── SDIO-shape narrowings (private) ─────────────────────────────────────

type SdioTeam = {
  TeamID: number;
  Key:    string;
  Active: boolean;
  City:   string;
  Name:   string;
  League: string;
  Division: string;
};

type SdioInning = {
  InningNumber: number;
  AwayTeamRuns: number | null;
  HomeTeamRuns: number | null;
};

type SdioGame = {
  GameID: number;
  Status: string;
  SeasonType: number;
  DateTime: string | null;
  Day: string | null;
  AwayTeam: string;
  HomeTeam: string;
  AwayTeamID: number;
  HomeTeamID: number;
  AwayTeamRuns: number | null;
  HomeTeamRuns: number | null;
  AwayTeamHits: number | null;
  HomeTeamHits: number | null;
  AwayTeamErrors: number | null;
  HomeTeamErrors: number | null;
  Innings: SdioInning[];
  AwayTeamProbablePitcherID:  number | null;
  HomeTeamProbablePitcherID:  number | null;
  AwayTeamProbablePitcherName?: string | null;
  HomeTeamProbablePitcherName?: string | null;
  AwayTeamStartingPitcher: string | null;
  HomeTeamStartingPitcher: string | null;
  WinningPitcherID:  number | null;
  WinningPitcherName?: string | null;
  LosingPitcherID:   number | null;
  LosingPitcherName?: string | null;
  SavingPitcherID:   number | null;
  SavingPitcherName?: string | null;
  StadiumID:         number | null;
  StadiumName?:      string | null;
  // Box-score footer fields. Times are ET local strings ("2026-06-15T18:40:00"
  // — no Z suffix). GameEndDateTime - DateTime gives us the canonical
  // "T" (time of game) info row.
  GameEndDateTime?:   string | null;
  Attendance?:        number | null;
  ForecastTempHigh?:  number | null;
  ForecastTempLow?:   number | null;
  ForecastDescription?: string | null;
  ForecastWindSpeed?: number | null;
};

type SdioPlayerGame = {
  PlayerID: number;
  TeamID:   number;
  Name:     string;
  Position: string;
  Started:  number;
  BattingOrder: number | null;
  // Sub-slot tracking from the box: SubstituteBattingOrder is the slot
  // the sub replaced (Hill's 7 = subbed for Rincones at slot 7); the
  // Sequence orders multiple subs that took the same slot (1, 2, …).
  SubstituteBattingOrder:         number | null;
  SubstituteBattingOrderSequence: number | null;
  AtBats:        number;
  Runs:          number;
  Hits:          number;
  Doubles:       number;
  Triples:       number;
  HomeRuns:      number;
  RunsBattedIn:  number;
  BattingAverage: number | null;
  OnBasePlusSlugging: number | null;
  StolenBases:   number;
  Walks:         number;
  Strikeouts:    number;
  PlateAppearances: number;
  // Pitching
  EarnedRunAverage: number | null;
  InningsPitchedDecimal: number;
  PitchingHits: number;
  PitchingRuns: number;
  PitchingEarnedRuns: number;
  PitchingWalks: number;
  PitchingStrikeouts: number;
  PitchingHomeRuns: number;
  PitchesThrown: number;
  PitchesThrownStrikes: number;
  PitchingPlateAppearances: number;
  // Inning the pitcher first appeared in (1 = top/bottom of 1st). Drives
  // the pitcher-row sort so the canonical box matches statsapi's order
  // (starter, then relievers in chronological entry order).
  PitchingInningStarted: number | null;
};
type SdioTeamGame = {
  TeamID:      number;
  AtBats:      number;
  Runs:        number;
  Hits:        number;
  HomeRuns:    number;
  Walks:       number;
  Strikeouts:  number;
};
type SdioBoxScore = {
  Game:        SdioGame;
  Innings:     SdioInning[];
  PlayerGames: SdioPlayerGame[];
  TeamGames:   SdioTeamGame[];
};

type SdioStanding = {
  TeamID: number;
  Key: string;
  Name: string;
  City: string;
  League: string;
  Division: string;
  Wins: number;
  Losses: number;
  Percentage: number;
  GamesBehind: number;
  DivisionRank: number;
  WildCardRank: number | null;
  WildCardGamesBehind: number | null;
  HomeWins: number;
  HomeLosses: number;
  AwayWins: number;
  AwayLosses: number;
  LastTenGamesWins: number;
  LastTenGamesLosses: number;
  // SDIO returns this pre-formatted ("W1", "L2", "W3") — same string
  // shape as the canonical `streak` display field — so no conversion.
  Streak: string;
  RunsScored: number;
  RunsAgainst: number;
  ClinchedDivision: boolean;
  ClinchedWildCard: boolean;
  EliminatedFromPlayoffContention: boolean;
};

type SdioPlayerSeason = {
  TeamID: number;
  PlayerID: number;
  Name: string;
  Position: string;
  PlateAppearances: number;
  Doubles: number;
  Triples: number;
  HomeRuns: number;
  RunsBattedIn: number;
  StolenBases: number;
  BattingAverage:     number | null;
  OnBasePercentage:   number | null;
  SluggingPercentage: number | null;
  OnBasePlusSlugging: number | null;
  Wins: number;
  Losses: number;
  Saves: number;
  EarnedRunAverage: number | null;
  InningsPitchedDecimal: number;
  PitchingStrikeouts: number;
  WalksHitsPerInningsPitched: number | null;
};

// One row out of the StartingLineups feed's HomeBattingLineup /
// AwayBattingLineup arrays. Starter-only by construction — SDIO doesn't
// surface mid-game substitutes here, so this is the authoritative source
// for a starter's INITIAL position, paired with PlayerGame.Position
// (final) to render multi-position chains like "DH-C".
type SdioStartingLineupRow = {
  PlayerID:     number;
  TeamID:       number;
  BattingOrder: number | null;
  Position:     string | null;
  Starting:     boolean;
};

type SdioStartingLineupEnvelope = {
  GameID:              number;
  HomeTeamID:          number;
  AwayTeamID:          number;
  HomeBattingLineup:   SdioStartingLineupRow[] | null;
  AwayBattingLineup:   SdioStartingLineupRow[] | null;
};

type SdioPlay = {
  PlayID:        number;
  PlayNumber:    number;
  InningNumber:  number;
  InningHalf:    string;          // "T" | "B"
  AwayTeamRuns:  number;
  HomeTeamRuns:  number;
  RunsBattedIn:  number;
  Result:        string | null;
  Description:   string | null;
  Hit:           boolean;
  Walk:          boolean;
  Strikeout:     boolean;
  Sacrifice:     boolean;
  Error:         boolean;
  Out:           boolean;
  // Plus actor fields used for sub/position reconstruction. HitterPosition
  // is the batter's defensive position AT THE START of the game (doesn't
  // change with mid-game position swaps) — actual position changes come
  // from the description parsing.
  HitterID:       number | null;
  HitterName:     string | null;
  HitterTeamID:   number | null;
  HitterPosition: string | null;
  PitcherID:      number | null;
  PitcherTeamID:  number | null;
};
type SdioPlayByPlay = {
  Game:  SdioGame;
  Plays: SdioPlay[];
};

type SdioTransaction = {
  Date: string;
  Name: string;
  PlayerID: number | null;
  Team:       string | null;
  TeamID:     number | null;
  FormerTeam: string | null;
  FormerTeamID: number | null;
  Type: string;
  Note: string | null;
};

// Subset of /scores/json/Players row the adapter reads. Pulled daily so
// the day's fresh IL placements can be synthesized as transactions
// (SDIO's TransactionsByDate doesn't surface IL movements at all).
type SdioPlayerRoster = {
  PlayerID: number;
  TeamID: number | null;
  Team: string | null;
  FirstName: string;
  LastName: string;
  Position: string | null;
  Status: string | null;            // "60-Day Injured List", "Active", etc.
  InjuryStatus: string | null;      // Out / Day-to-Day / etc.
  InjuryBodyPart: string | null;
  InjuryStartDate: string | null;   // "2026-06-15T00:00:00" ET-local
  InjuryNotes: string | null;
};

// ─── Mapping helpers ─────────────────────────────────────────────────────

// Map keyed by the VENDOR team id (SDIO numeric TeamID) — adapter-internal.
// Values hold the canonical slug as their `id` so vendor SDIO ids never
// escape this file.
function teamRefIndex(teamsRaw: unknown): Map<number, MlbTeamRef> {
  const map = new Map<number, MlbTeamRef>();
  const teams = (teamsRaw as SdioTeam[] | null) ?? [];
  for (const t of teams) {
    if (typeof t.TeamID !== "number") continue;
    const vendorName = t.City && t.Name ? `${t.City} ${t.Name}` : (t.Name ?? `Team ${t.TeamID}`);
    const vendorAbbr = t.Key ?? "";
    map.set(t.TeamID, canonicalTeamRefForRef({ id: t.TeamID, name: vendorName, abbr: vendorAbbr }));
  }
  return map;
}

function teamRefBy(idx: Map<number, MlbTeamRef>, id: number, fallbackName?: string, fallbackAbbr?: string): MlbTeamRef {
  const cached = idx.get(id);
  if (cached) return cached;
  const name = fallbackName ?? `Team ${id}`;
  const abbr = fallbackAbbr ?? name.slice(0, 3).toUpperCase();
  return canonicalTeamRefForRef({ id, name, abbr });
}

// SDIO returns DateTime as a local-clock string in America/New_York
// without a timezone marker ("2026-06-16T18:40:00"). statsapi returns
// proper UTC ISO with Z. Canonical contract is UTC ISO, so normalize
// SDIO's value by finding the ET offset on that date and constructing
// the equivalent UTC Date. Falls back to the input string when SDIO
// returns null (e.g. TBD games).
function sdioDateTimeToIsoUtc(local: string | null): string {
  if (!local || local.includes("Z") || /[+-]\d\d:?\d\d$/.test(local)) {
    return local ?? "";
  }
  const probe = new Date(local + "Z");
  if (Number.isNaN(probe.getTime())) return local;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "longOffset",
  }).formatToParts(probe);
  const offsetRaw = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT-04:00";
  const m = offsetRaw.match(/GMT([+-]\d{2}):(\d{2})/);
  const offset = m ? `${m[1]}:${m[2]}` : "-04:00";
  return new Date(local + offset).toISOString();
}

function statusFromSdio(s: string): MlbGameStatus {
  switch (s) {
    case "Final":     return "final";
    case "InProgress":return "live";
    case "Scheduled": return "scheduled";
    case "Postponed": return "postponed";
    case "Suspended": return "suspended";
    case "Canceled":
    case "Cancelled": return "cancelled";
    default:          return "unknown";
  }
}

function gameTypeFromSdio(t: number): MlbGameType {
  switch (t) {
    case 1: return "regular";
    case 2: return "spring";
    case 3: return "world-series";
    case 5: return "all-star";
    default: return "regular";
  }
}

function leagueFromSdio(s: string | null | undefined): MlbLeague | null {
  if (s === "AL") return "AL";
  if (s === "NL") return "NL";
  return null;
}

function divisionFromSdio(s: string | null | undefined): MlbDivision | null {
  if (s === "East")    return "East";
  if (s === "Central") return "Central";
  if (s === "West")    return "West";
  return null;
}

function record(wins: number, losses: number): MlbRecord {
  const total = wins + losses;
  return { wins, losses, pct: total ? wins / total : 0 };
}

// Normalize SDIO's streak string to the canonical display format. SDIO
// returns "W1"/"L2"; empty or null lands as "-" to match statsapi's
// empty-streak display.
function streakOrDash(s: string | null | undefined): string {
  if (!s) return "-";
  return s;
}

// ─── Section adapters ────────────────────────────────────────────────────

// SDIO doesn't carry probable pitcher records inline on the schedule
// envelope and only inconsistently includes pitcher names on game
// decisions (the schedule envelope often has WinningPitcherID but
// WinningPitcherName=null). Both ride on PlayerSeasonStats, so we
// build one map keyed by PlayerID that everything else looks against.
type PitcherStatsMap = Map<number, { wins: number; losses: number; era: number | null; name: string }>;
function pitcherStatsLookup(playerStatsRaw: unknown): PitcherStatsMap {
  const m: PitcherStatsMap = new Map();
  for (const p of ((playerStatsRaw as SdioPlayerSeason[] | null) ?? [])) {
    if (typeof p.PlayerID !== "number") continue;
    m.set(p.PlayerID, {
      wins:   p.Wins ?? 0,
      losses: p.Losses ?? 0,
      era:    p.EarnedRunAverage,
      name:   p.Name ?? "",
    });
  }
  return m;
}

function adaptProbablePitcher(
  id:   number | null | undefined,
  name: string | null | undefined,
  stats: PitcherStatsMap,
) {
  if (!id) return null;
  const s = stats.get(id);
  const ref = playerRef("sdio", id, name ?? "—");
  return {
    id:       ref.id,
    fullName: ref.fullName,
    mlbId:    ref.mlbId,
    wins:   s ? s.wins   : null,
    losses: s ? s.losses : null,
    era:    s?.era ?? null,
  };
}

function adaptGame(g: SdioGame, idx: Map<number, MlbTeamRef>, pitcherStats: PitcherStatsMap): MlbGame {
  const away = teamRefBy(idx, g.AwayTeamID, undefined, g.AwayTeam);
  const home = teamRefBy(idx, g.HomeTeamID, undefined, g.HomeTeam);
  const innings: MlbInningLine[] = (g.Innings ?? []).map((i) => ({
    num: i.InningNumber,
    awayRuns: i.AwayTeamRuns ?? null,
    homeRuns: i.HomeTeamRuns ?? null,
  }));
  return {
    id: g.GameID,
    startTime: sdioDateTimeToIsoUtc(g.DateTime ?? null) || (g.Day ?? ""),
    gameType: gameTypeFromSdio(g.SeasonType),
    status: statusFromSdio(g.Status),
    statusDetail: g.Status,
    awayTeam: away,
    homeTeam: home,
    awayScore: g.AwayTeamRuns,
    homeScore: g.HomeTeamRuns,
    innings,
    awayHits:   g.AwayTeamHits,
    homeHits:   g.HomeTeamHits,
    awayErrors: g.AwayTeamErrors,
    homeErrors: g.HomeTeamErrors,
    awayProbablePitcher: adaptProbablePitcher(
      g.AwayTeamProbablePitcherID,
      g.AwayTeamProbablePitcherName ?? g.AwayTeamStartingPitcher,
      pitcherStats,
    ),
    homeProbablePitcher: adaptProbablePitcher(
      g.HomeTeamProbablePitcherID,
      g.HomeTeamProbablePitcherName ?? g.HomeTeamStartingPitcher,
      pitcherStats,
    ),
    // SDIO often returns just the pitcher ID without the name on the
    // schedule envelope — fall back to the name in PlayerSeasonStats
    // so renderers don't print "—".
    decisions: (g.WinningPitcherID || g.LosingPitcherID || g.SavingPitcherID)
      ? {
          winner: g.WinningPitcherID
            ? playerRef("sdio", g.WinningPitcherID, g.WinningPitcherName ?? pitcherStats.get(g.WinningPitcherID)?.name ?? "—")
            : null,
          loser:  g.LosingPitcherID
            ? playerRef("sdio", g.LosingPitcherID,  g.LosingPitcherName  ?? pitcherStats.get(g.LosingPitcherID)?.name  ?? "—")
            : null,
          save:   g.SavingPitcherID
            ? playerRef("sdio", g.SavingPitcherID,  g.SavingPitcherName  ?? pitcherStats.get(g.SavingPitcherID)?.name  ?? "—")
            : null,
        }
      : null,
    venueName: g.StadiumName ?? null,
  };
}

function batting(pg: SdioPlayerGame): MlbBoxBatting {
  // Always emit a batting line for any non-pitcher appearance, even
  // when PA=0 (defensive sub). Without a zero-stat line, late-inning
  // defensive replacements vanish from the box entirely. The team-box
  // adapter is responsible for excluding pitchers who didn't bat —
  // batting() itself is unconditional.
  return {
    atBats:         pg.AtBats        ?? 0,
    runs:           pg.Runs          ?? 0,
    hits:           pg.Hits          ?? 0,
    rbi:            pg.RunsBattedIn  ?? 0,
    baseOnBalls:    pg.Walks         ?? 0,
    strikeOuts:     pg.Strikeouts    ?? 0,
    homeRuns:       pg.HomeRuns      ?? 0,
    doubles:        pg.Doubles       ?? 0,
    triples:        pg.Triples       ?? 0,
    stolenBases:    pg.StolenBases   ?? 0,
    battingAverage: null,
    ops:            null,
  };
}

// SDIO ships InningsPitchedDecimal as a true decimal (0.6667 = ⅔), but the
// canonical convention — shared with statsapi and our renderer's fmtIp — is
// the .0/.1/.2 baseball form (0.2 = ⅔). Convert at adapter boundary so the
// renderer never sees the SDIO native form.
function ipDecimalToMlb(d: number): number {
  if (!Number.isFinite(d) || d <= 0) return 0;
  const whole = Math.floor(d);
  const frac  = d - whole;
  if (frac < 1 / 6)     return whole;       // < ⅙ → .0
  if (frac < 1 / 2)     return whole + 0.1; // ⅙..½ → .1
  if (frac < 5 / 6)     return whole + 0.2; // ½..⅚ → .2
  return whole + 1;                         // ≥ ⅚ → next whole
}

function pitching(pg: SdioPlayerGame): MlbBoxPitching | null {
  if (pg.InningsPitchedDecimal === 0 && pg.PitchingPlateAppearances === 0) return null;
  return {
    inningsPitched: ipDecimalToMlb(pg.InningsPitchedDecimal),
    hits:           pg.PitchingHits,
    runs:           pg.PitchingRuns,
    earnedRuns:     pg.PitchingEarnedRuns,
    baseOnBalls:    pg.PitchingWalks,
    strikeOuts:     pg.PitchingStrikeouts,
    homeRuns:       pg.PitchingHomeRuns,
    pitchesThrown:  pg.PitchesThrown,
    strikes:        pg.PitchesThrownStrikes,
    battersFaced:   pg.PitchingPlateAppearances,
    era:            null,
    // SDIO doesn't carry a pre-formatted decision note — leave null and
    // let the renderer derive a "(W, 2-1)" form from canonical decisions
    // when we add that, if we want parity later.
    decisionNote:   null,
  };
}

// PlayerSeasonStats join: SDIO's PlayerGame.BattingAverage/OPS are this
// game's values, NOT season totals. Real season stats live in the
// PlayerSeasonStats blob. The batter lookup keys on PlayerID and
// exposes everything the canonical box player needs.
type BatterSeasonMap = Map<number, SdioPlayerSeason>;
function batterSeasonLookup(playerStatsRaw: unknown): BatterSeasonMap {
  const m: BatterSeasonMap = new Map();
  for (const p of ((playerStatsRaw as SdioPlayerSeason[] | null) ?? [])) {
    if (typeof p.PlayerID !== "number") continue;
    m.set(p.PlayerID, p);
  }
  return m;
}

function adaptPlayer(
  pg:        SdioPlayerGame,
  isPitcher: boolean,
  season:    BatterSeasonMap,
  pbpPositions: Set<string> | undefined,
  resolvedSlot: number | null,
  startingPosition: string | null,
): MlbBoxPlayer {
  const bat = batting(pg);
  const pit = isPitcher ? pitching(pg) : null;
  const s   = season.get(pg.PlayerID);
  // Position chain in chronological order:
  //   1. lineup-card position from StartingLineupsByDate (starters only;
  //      authoritative for "DH-X" type moves invisible to PBP since DH
  //      doesn't field)
  //   2. mid-game positions discovered via PBP description scanning
  //      ("second baseman X" etc.) for fielding role changes
  //   3. PlayerGame.Position — the final/primary position from SDIO
  // Set preserves insertion order so the rendered chain reads left-to-
  // right in chronological order ("DH-C", not "C-DH").
  const positions = new Set<string>();
  if (startingPosition) positions.add(startingPosition);
  for (const p of pbpPositions ?? []) positions.add(p);
  if (pg.Position) positions.add(pg.Position);
  const allPositionsAbbr = positions.size > 1 ? [...positions] : null;
  return {
    player:        playerRef("sdio", pg.PlayerID, pg.Name),
    positionAbbr:  pg.Position,
    jerseyNumber:  null,
    // startingOrder now carries the lineup slot for SUBS too (inferred
    // via PBP), not just starters. isStarter distinguishes the two.
    startingOrder: resolvedSlot,
    isStarter:     pg.Started === 1,
    allPositionsAbbr,
    batting:       bat,
    pitching:      pit,
    // Season batting from PlayerSeasonStats (not PlayerGame). Counting
    // stats hydrated from the same row so hittingExtras' running-total
    // "(N)" annotation in the box-score notes shows real numbers.
    seasonBatting:  bat ? {
      battingAverage: s?.BattingAverage     ?? null,
      ops:            s?.OnBasePlusSlugging ?? null,
      doubles:        s?.Doubles            ?? 0,
      triples:        s?.Triples            ?? 0,
      homeRuns:       s?.HomeRuns           ?? 0,
      stolenBases:    s?.StolenBases        ?? 0,
      rbi:            s?.RunsBattedIn       ?? 0,
    } : null,
    // Season pitching from PlayerSeasonStats too — game-level ERA was
    // misleading for relievers whose 1.0 IP appearance might be 0.00
    // ERA but full season is 4.20.
    seasonPitching: pit ? {
      era:    s?.EarnedRunAverage ?? null,
      wins:   s?.Wins   ?? null,
      losses: s?.Losses ?? null,
      saves:  s?.Saves  ?? null,
    } : null,
  };
}

// ─── Multi-position reconstruction from PBP ─────────────────────────────
//
// Sub lineup slots come directly from PlayerGame.SubstituteBattingOrder
// (catches everyone, including pure defensive subs like Hill). Multi-
// position handling has no direct field though — when a player switched
// positions mid-game (Sosa 3B → SS) the schedule envelope still shows
// only the primary. We recover it from PlayByPlayFinal by scanning each
// play description for position-word + Capitalized-Name patterns and
// building a per-player set. Plain English parsing is noisy (accents
// truncate, multi-word names) but covers ~95% of cases — single
// positions are pulled from PlayerGame.Position and combined.

// Capture a 1–3 part personal name. \p{L} catches accented letters
// ("Hernández"). The period is ONLY allowed inside the suffix alternation
// (Jr./Sr.) — earlier versions allowed `\.?` on any name part, which let
// "Hernández. Bryce" eat past the sentence terminator and yield a fragment
// no canonical name could match.
const NAME = String.raw`\p{Lu}\p{L}+(?:\s+\p{Lu}\p{L}+)?(?:\s+(?:Jr\.|Sr\.|II|III))?`;
const POSITION_WORD_RE: Array<[RegExp, string]> = [
  [new RegExp(String.raw`\bpitcher\s+(${NAME})`,         "gu"), "P"],
  [new RegExp(String.raw`\bcatcher\s+(${NAME})`,         "gu"), "C"],
  [new RegExp(String.raw`\bfirst baseman\s+(${NAME})`,   "gu"), "1B"],
  [new RegExp(String.raw`\bsecond baseman\s+(${NAME})`,  "gu"), "2B"],
  [new RegExp(String.raw`\bthird baseman\s+(${NAME})`,   "gu"), "3B"],
  [new RegExp(String.raw`\bshortstop\s+(${NAME})`,        "gu"), "SS"],
  [new RegExp(String.raw`\bleft fielder\s+(${NAME})`,    "gu"), "LF"],
  [new RegExp(String.raw`\bcenter fielder\s+(${NAME})`,  "gu"), "CF"],
  [new RegExp(String.raw`\bright fielder\s+(${NAME})`,   "gu"), "RF"],
];

function nameMatches(canonicalFullName: string, fragment: string): boolean {
  // Defensive mentions sometimes drop accents or suffixes (e.g. PBP says
  // "Hernández" but the regex captures "Hern" before the accented char).
  // Match if the fragment is a substring of the canonical name OR the
  // canonical name's last name shows up in the fragment.
  if (canonicalFullName.includes(fragment)) return true;
  if (fragment.length >= 4 && canonicalFullName.toLowerCase().includes(fragment.toLowerCase())) return true;
  return false;
}

function multiPositionsFromPbp(
  pbpForGame:    SdioPlayByPlay | undefined,
  knownPlayers:  SdioPlayerGame[],
): Map<number, Set<string>> {
  const positionsByPid = new Map<number, Set<string>>();
  if (!pbpForGame?.Plays) return positionsByPid;
  for (const play of pbpForGame.Plays) {
    if (!play.Description) continue;
    for (const [re, pos] of POSITION_WORD_RE) {
      re.lastIndex = 0;
      for (const m of play.Description.matchAll(re)) {
        const fragment = m[1]!.trim();
        for (const p of knownPlayers) {
          if (nameMatches(p.Name, fragment)) {
            (positionsByPid.get(p.PlayerID) ?? positionsByPid.set(p.PlayerID, new Set()).get(p.PlayerID)!).add(pos);
            break;
          }
        }
      }
    }
  }
  return positionsByPid;
}

function adaptTeamBox(
  teamId: number,
  playerGames: SdioPlayerGame[],
  teamGame: SdioTeamGame | undefined,
  idx: Map<number, MlbTeamRef>,
  season: BatterSeasonMap,
  pbp: SdioPlayByPlay | undefined,
  startingPositions: Map<number, string>,
): MlbBoxTeam {
  const players = playerGames.filter((p) => p.TeamID === teamId);
  // Multi-position recovery via PBP description parsing — see header.
  const positionsByPid = multiPositionsFromPbp(pbp, players);
  // First-play number per pitcher — used as the within-inning tiebreaker
  // when two relievers share PitchingInningStarted. Without this, the
  // SDIO pitcher row order can flip pairs that statsapi displays in
  // chronological entry order (Ferguson/Petty in 06-15 NYM@CIN).
  const firstPlayByPitcher = new Map<number, number>();
  for (const play of pbp?.Plays ?? []) {
    if (play.PitcherID && !firstPlayByPitcher.has(play.PitcherID)) {
      firstPlayByPitcher.set(play.PitcherID, play.PlayNumber);
    }
  }

  // Lineup slot resolution: starters carry BattingOrder, subs carry
  // SubstituteBattingOrder. Pure defensive subs who never batted are
  // included via SubstituteBattingOrder too (Hill at 7 in our 06-15
  // PHI sample). No PBP inference needed — the field is canonical.
  const slotFor = (p: SdioPlayerGame): number | null => {
    if (p.Started === 1 && p.BattingOrder) return p.BattingOrder;
    return p.SubstituteBattingOrder ?? null;
  };

  const pitchers = players
    .filter((p) => p.InningsPitchedDecimal > 0 || p.PitchingPlateAppearances > 0)
    // Display order: starter first (Started=1), then relievers by inning
    // of first appearance, with PBP first-play as the within-inning
    // tiebreaker. Matches statsapi's chronological entry order. The old
    // "sort relievers by IP descending" buried late-game high-leverage
    // arms behind earlier multi-inning relievers.
    .sort((a, b) =>
      (b.Started - a.Started)
      || ((a.PitchingInningStarted ?? 99) - (b.PitchingInningStarted ?? 99))
      || ((firstPlayByPitcher.get(a.PlayerID) ?? Infinity) - (firstPlayByPitcher.get(b.PlayerID) ?? Infinity))
    )
    .map((p) => adaptPlayer(p, true, season, positionsByPid.get(p.PlayerID), null, startingPositions.get(p.PlayerID) ?? null));
  // Batters list: anyone with a lineup slot, regardless of whether
  // they also pitched. Relief pitchers who entered via a double-switch
  // take someone else's batting-order slot (Kempner at slot 8 in our
  // 06-15 MIA-@-PHI sample). Pitchers without a lineup slot (typical
  // mid-inning relievers) stay out.
  const batters = players
    .filter((p) => {
      if (p.Started === 1 && p.BattingOrder !== null) return true;
      if (p.SubstituteBattingOrder !== null) return true;
      return false;
    })
    .sort((a, b) => {
      const aSlot = slotFor(a) ?? 99;
      const bSlot = slotFor(b) ?? 99;
      if (aSlot !== bSlot) return aSlot - bSlot;
      // Same slot: starter first, then subs ordered by SDIO's sub
      // sequence (1, 2, …) for multiple replacements at the same slot.
      if (a.Started !== b.Started) return b.Started - a.Started;
      return (a.SubstituteBattingOrderSequence ?? 99) - (b.SubstituteBattingOrderSequence ?? 99);
    })
    .map((p) => adaptPlayer(p, false, season, positionsByPid.get(p.PlayerID), slotFor(p), startingPositions.get(p.PlayerID) ?? null));
  // SDIO TeamGame doesn't carry RBI as a team total — sum from the
  // batters' game lines so the canonical team-totals row still has a
  // value to render. AB/R/H/etc. come from TeamGame which matches the
  // statsapi-side semantics.
  const teamRbi = players.reduce((s, p) => s + (p.RunsBattedIn ?? 0), 0);
  const totals: MlbBoxTeamTotals = {
    atBats:      teamGame?.AtBats     ?? 0,
    runs:        teamGame?.Runs       ?? 0,
    hits:        teamGame?.Hits       ?? 0,
    rbi:         teamRbi,
    homeRuns:    teamGame?.HomeRuns   ?? 0,
    baseOnBalls: teamGame?.Walks      ?? 0,
    strikeOuts:  teamGame?.Strikeouts ?? 0,
  };
  return { team: teamRefBy(idx, teamId), totals, batters, pitchers };
}

// Box-score footer rows ("Weather", "T", "Att"). Built from the SDIO
// Game envelope, which carries attendance, start/end times, and weather
// forecast fields. Umpires are NOT in any SDIO endpoint we've found —
// statsapi-only data, so the SDIO box doesn't carry an Umpires row.
// Format matches the statsapi-side strings the renderer's infoOrder
// loop already knows how to print.
function infoFromSdioGame(g: SdioGame): MlbBoxInfo[] {
  const out: MlbBoxInfo[] = [];

  // Weather: "{temp} degrees, {description}." Use ForecastTempHigh as the
  // best proxy for game-time temperature (most games are afternoon/evening
  // when the daily high is closest). statsapi has the actual gametime
  // reading; SDIO ships forecast only, so a small temp drift vs statsapi
  // is expected and tracked as a known vendor difference.
  const desc = g.ForecastDescription?.trim();
  const temp = g.ForecastTempHigh;
  if (temp != null && desc) {
    out.push({ label: "Weather", value: `${temp} degrees, ${desc}.` });
  } else if (desc) {
    out.push({ label: "Weather", value: `${desc}.` });
  }

  // T: HH:MM duration between game start and end. Both ET-local strings
  // ("YYYY-MM-DDTHH:MM:SS"), no timezone suffix — they're already in the
  // same wall-clock zone, so a direct epoch diff via Date.parse() is
  // safe regardless of the runtime's TZ.
  const start = g.DateTime ? Date.parse(g.DateTime) : NaN;
  const end   = g.GameEndDateTime ? Date.parse(g.GameEndDateTime) : NaN;
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
    const totalMin = Math.round((end - start) / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    out.push({ label: "T", value: `${h}:${String(m).padStart(2, "0")}.` });
  }

  // Att: locale-formatted integer with thousands separators, trailing
  // period to match statsapi.
  if (typeof g.Attendance === "number" && g.Attendance > 0) {
    out.push({ label: "Att", value: `${g.Attendance.toLocaleString("en-US")}.` });
  }

  return out;
}

// Build a per-game lookup of starting position by PlayerID. Sourced from
// StartingLineupsByDate. Empty when the endpoint 401'd (free-tier keys)
// — adapter falls back to single-position display for that day's games.
function startingPositionsByGame(
  raw: unknown,
): Map<number, Map<number, string>> {
  const out = new Map<number, Map<number, string>>();
  const envelopes = (raw as SdioStartingLineupEnvelope[] | null) ?? [];
  for (const env of envelopes) {
    const game = new Map<number, string>();
    const rows = [
      ...(env.HomeBattingLineup ?? []),
      ...(env.AwayBattingLineup ?? []),
    ];
    for (const r of rows) {
      if (r.PlayerID && r.Position) game.set(r.PlayerID, r.Position);
    }
    out.set(env.GameID, game);
  }
  return out;
}

function boxScoresFromRaw(
  raw: unknown,
  games: MlbGame[],
  idx: Map<number, MlbTeamRef>,
  season: BatterSeasonMap,
  playByPlay: Record<string, unknown>,
  startingLineups: Map<number, Map<number, string>>,
): Map<number, MlbBoxScore> {
  const out = new Map<number, MlbBoxScore>();
  const boxes = (raw as SdioBoxScore[] | null) ?? [];
  for (const box of boxes) {
    const gameId = box.Game.GameID;
    const game = games.find((g) => g.id === gameId);
    if (!game) continue;
    const pbp = playByPlay[String(gameId)] as SdioPlayByPlay | undefined;
    const startPositions = startingLineups.get(gameId) ?? new Map<number, string>();
    const away = adaptTeamBox(
      box.Game.AwayTeamID,
      box.PlayerGames,
      box.TeamGames.find((t) => t.TeamID === box.Game.AwayTeamID),
      idx,
      season,
      pbp,
      startPositions,
    );
    const home = adaptTeamBox(
      box.Game.HomeTeamID,
      box.PlayerGames,
      box.TeamGames.find((t) => t.TeamID === box.Game.HomeTeamID),
      idx,
      season,
      pbp,
      startPositions,
    );
    out.set(gameId, { game, away, home, info: infoFromSdioGame(box.Game) });
  }
  return out;
}

// Build canonical standings + wild-card from the same SDIO Standings
// envelope in one pass. We deliberately DON'T trust SDIO's
// WildCardRank / WildCardGamesBehind columns — they don't follow MLB's
// rule (they appear to mix division leaders into the WC ordering).
// canonical wildCardGamesBehind is computed in wildCardFromRaw against
// the correct cutoff; the row-level field here just mirrors SDIO so
// callers that read team.wildCardGamesBehind without going through the
// WC table see something, but the WC table is the load-bearing path.
function teamRowFromSdio(r: SdioStanding, idx: Map<number, MlbTeamRef>): MlbStandingRow {
  const team = teamRefBy(idx, r.TeamID, r.City && r.Name ? `${r.City} ${r.Name}` : r.Name, r.Key);
  return {
    team,
    wins:                   r.Wins,
    losses:                 r.Losses,
    gamesBehind:            r.GamesBehind,
    divisionRank:           r.DivisionRank,
    wildCardRank:           r.WildCardRank,
    wildCardGamesBehind:    r.WildCardGamesBehind,
    streak:                 streakOrDash(r.Streak),
    runsScored:             r.RunsScored,
    runsAllowed:            r.RunsAgainst,
    homeRecord:             record(r.HomeWins, r.HomeLosses),
    awayRecord:             record(r.AwayWins, r.AwayLosses),
    lastTenRecord:          record(r.LastTenGamesWins, r.LastTenGamesLosses),
    leagueRecord:           record(r.Wins, r.Losses),  // SDIO lacks inter-league split
    clinchedDivision:       r.ClinchedDivision,
    clinchedWildCard:       r.ClinchedWildCard,
    eliminatedFromPlayoffs: r.EliminatedFromPlayoffContention,
  };
}

// MLB's wild card standings (since 2022): three wild-card slots per
// league go to the top three non-division-leaders by record. Division
// leaders are NOT in the wild card race and never appear in the WC
// standings table. The "wild card cutoff" is the 3rd-best non-leader;
// their WCGB is 0. Contenders ahead of them get negative WCGB; teams
// behind get positive.
//
// Games behind formula (MLB convention):
//   GB(team vs cutoff) = ((cutoff.wins - team.wins) + (team.losses - cutoff.losses)) / 2
//
// Tiebreakers between teams with identical W-L go by Percentage; further
// MLB tiebreakers (head-to-head, intra-division, etc.) live outside the
// snapshot. Anything finer needs game-log data SDIO returns separately.
function wildCardFromRaw(raw: unknown, idx: Map<number, MlbTeamRef>): MlbWildCardStandings[] {
  const rows = (raw as SdioStanding[] | null) ?? [];
  // Re-rank within each division first so the division-leader filter
  // uses MLB-correct ranks, not SDIO's (which may misorder ties). A
  // team that's tied for first by W-L but not the highest win pct
  // ends up at DivisionRank > 1 and is eligible for wild card.
  const byDivision = new Map<string, SdioStanding[]>();
  for (const r of rows) {
    const key = `${r.League}/${r.Division}`;
    (byDivision.get(key) ?? byDivision.set(key, []).get(key)!).push(r);
  }
  const corrected: SdioStanding[] = [];
  for (const [, divRows] of byDivision) corrected.push(...rerankDivision(divRows));

  const byLeague = new Map<MlbLeague, SdioStanding[]>();
  for (const r of corrected) {
    if (r.DivisionRank === 1) continue;   // division leaders aren't in the WC race
    const league = leagueFromSdio(r.League);
    if (!league) continue;
    (byLeague.get(league) ?? byLeague.set(league, []).get(league)!).push(r);
  }
  const out: MlbWildCardStandings[] = [];
  for (const [league, contenders] of byLeague) {
    const sorted = [...contenders].sort((a, b) => {
      if (a.Percentage !== b.Percentage) return b.Percentage - a.Percentage;
      if (a.Losses !== b.Losses)         return a.Losses - b.Losses;
      return b.Wins - a.Wins;
    });
    const cutoff = sorted[2];
    const teams: MlbStandingRow[] = sorted.map((r, i) => {
      const base = teamRowFromSdio(r, idx);
      const wcgb = cutoff
        ? ((cutoff.Wins - r.Wins) + (r.Losses - cutoff.Losses)) / 2
        : null;
      return { ...base, wildCardRank: i + 1, wildCardGamesBehind: wcgb };
    });
    out.push({ league, teams });
  }
  return out;
}

// Re-rank SDIO standings by actual win percentage rather than trusting
// SDIO's DivisionRank field. SDIO has been observed to put a team with
// more wins ahead of a team with a higher win percentage (e.g. CLE 39-33
// .542 listed above CHW 38-32 .543). MLB's rule is win pct first, with
// wins/losses as secondary tiebreakers, then league-defined head-to-head
// rules (which we don't have visibility into in this snapshot).
function rerankDivision(rows: SdioStanding[]): SdioStanding[] {
  const sorted = [...rows].sort((a, b) => {
    if (a.Percentage !== b.Percentage) return b.Percentage - a.Percentage;
    if (a.Wins !== b.Wins)             return b.Wins - a.Wins;
    return a.Losses - b.Losses;
  });
  return sorted.map((r, i) => ({ ...r, DivisionRank: i + 1 }));
}

function standingsFromRaw(raw: unknown, idx: Map<number, MlbTeamRef>): MlbDivisionStandings[] {
  const rows = (raw as SdioStanding[] | null) ?? [];
  // Group by division, then recompute DivisionRank from win pct.
  const byDivision = new Map<string, SdioStanding[]>();
  for (const r of rows) {
    const league   = leagueFromSdio(r.League);
    const division = divisionFromSdio(r.Division);
    if (!league || !division) continue;
    const key = `${league}/${division}`;
    (byDivision.get(key) ?? byDivision.set(key, []).get(key)!).push(r);
  }
  const grouped = new Map<string, MlbStandingRow[]>();
  for (const [key, divRows] of byDivision) {
    grouped.set(key, rerankDivision(divRows).map((r) => teamRowFromSdio(r, idx)));
  }
  const out: MlbDivisionStandings[] = [];
  for (const [key, teams] of grouped) {
    const [league, division] = key.split("/") as [MlbLeague, MlbDivision];
    teams.sort((a, b) => a.divisionRank - b.divisionRank);
    out.push({ league, division, teams });
  }
  return out;
}

// Leader category → SDIO PlayerSeason field + sort direction + rate-stat
// flag. `rate` decides which qualification rule applies:
//   - "batting":  3.1 PA × team games played  (MLB rule 9.22(a))
//   - "pitching": 1.0 IP × team games played  (MLB rule 9.22(b)/(c))
//   - undefined:  counting stat — no qualification, every player eligible
//
// We never hardcode thresholds. Teams play a different number of games
// at any point in the season, so each player's bar moves with their
// team's games-played count.
type LeaderSpec = {
  field:     (r: SdioPlayerSeason) => number | null;
  ascending: boolean;
  rate?:     "batting" | "pitching";
};
const LEADER_SPECS: Partial<Record<MlbLeaderCategory, LeaderSpec>> = {
  battingAverage:     { field: (r) => r.BattingAverage,        ascending: false, rate: "batting" },
  homeRuns:           { field: (r) => r.HomeRuns,              ascending: false },
  runsBattedIn:       { field: (r) => r.RunsBattedIn,          ascending: false },
  stolenBases:        { field: (r) => r.StolenBases,           ascending: false },
  wins:               { field: (r) => r.Wins,                  ascending: false },
  earnedRunAverage:   { field: (r) => r.EarnedRunAverage,      ascending: true,  rate: "pitching" },
  strikeoutsPitching: { field: (r) => r.PitchingStrikeouts,    ascending: false },
  saves:              { field: (r) => r.Saves,                 ascending: false },
};

// MLB official rate-stat qualification — rule 9.22. Batting needs
// 3.1 × team games played; pitching needs 1.0 × team games played IP.
function meetsRateQualification(
  p: SdioPlayerSeason,
  spec: LeaderSpec,
  teamGames: Map<number, number>,
): boolean {
  if (!spec.rate) return true;
  const games = teamGames.get(p.TeamID) ?? 0;
  if (spec.rate === "batting")  return p.PlateAppearances      >= 3.1 * games;
  if (spec.rate === "pitching") return p.InningsPitchedDecimal >= 1.0 * games;
  return true;
}


// Team games played, derived from SDIO Standings W+L. The same shape
// statsapi gives us internally — both vendors agree on win/loss totals.
function buildTeamGames(standingsRaw: unknown): Map<number, number> {
  const out = new Map<number, number>();
  const rows = (standingsRaw as SdioStanding[] | null) ?? [];
  for (const r of rows) {
    if (typeof r.TeamID === "number") {
      out.set(r.TeamID, r.Wins + r.Losses);
    }
  }
  return out;
}

function leaderboardsFromRaw(
  playerStatsRaw: unknown,
  teamsRaw:       unknown,
  standingsRaw:   unknown,
  idx:            Map<number, MlbTeamRef>,
  limit = 20,
): MlbLeaderboard[] {
  const players = (playerStatsRaw as SdioPlayerSeason[] | null) ?? [];
  if (players.length === 0) return [];
  // Build TeamID → League lookup from the raw teams envelope so we can
  // split leaders by league without re-querying.
  const teamLeague = new Map<number, MlbLeague>();
  for (const t of (teamsRaw as SdioTeam[] | null) ?? []) {
    const lg = leagueFromSdio(t.League);
    if (lg) teamLeague.set(t.TeamID, lg);
  }
  const teamGames = buildTeamGames(standingsRaw);
  const out: MlbLeaderboard[] = [];
  const leagues: MlbLeague[] = ["AL", "NL"];
  for (const league of leagues) {
    for (const [cat, spec] of Object.entries(LEADER_SPECS) as Array<[MlbLeaderCategory, LeaderSpec]>) {
      const pool = players.filter((p) => {
        if (teamLeague.get(p.TeamID) !== league) return false;
        if (!meetsRateQualification(p, spec, teamGames)) return false;
        const v = spec.field(p);
        return typeof v === "number" && Number.isFinite(v);
      });
      // Sort: primary by raw stat value (asc for ERA/WHIP, desc otherwise);
      // alphabetical-by-last-name as the tiebreaker. Matches what MLB's
      // leaders endpoint does — when two players have genuinely identical
      // raw values (integer counters like HR), the alpha-sorted name
      // determines display order. Float values like AVG rarely tie at
      // raw precision even when they tie at display precision.
      pool.sort((a, b) => {
        const av = spec.field(a) ?? 0;
        const bv = spec.field(b) ?? 0;
        if (av !== bv) return spec.ascending ? av - bv : bv - av;
        return lastName(a.Name).localeCompare(lastName(b.Name));
      });
      // Rank assignment: standard MLB 1224 — players with genuinely
      // equal raw values share the same rank; the next distinct value
      // skips ahead to its sorted position. So three players tied at
      // 18 HR get rank 5/5/5, and the next player at 17 HR gets rank 8.
      let prevValue: number | null = null;
      let prevRank  = 0;
      const entries: MlbLeaderEntry[] = pool.slice(0, limit).map((p, i) => {
        const v = spec.field(p) ?? 0;
        const rank = prevValue !== null && v === prevValue
          ? prevRank
          : i + 1;
        prevValue = v;
        prevRank  = rank;
        return {
          rank,
          value: v,
          player: playerRef("sdio", p.PlayerID, p.Name),
          team:   teamRefBy(idx, p.TeamID),
        };
      });
      out.push({ league, category: cat, entries });
    }
  }
  return out;
}

// SDIO doesn't flag scoring plays directly. Detect a scoring play by the
// run-delta from the previous play in the same game (sorted by PlayNumber).
function scoringPlaysFromSdioPbp(plays: SdioPlay[]): MlbScoringPlay[] {
  const sorted = [...plays].sort((a, b) => a.PlayNumber - b.PlayNumber);
  const out: MlbScoringPlay[] = [];
  let prevAway = 0;
  let prevHome = 0;
  for (const p of sorted) {
    if (p.AwayTeamRuns > prevAway || p.HomeTeamRuns > prevHome) {
      out.push({
        inning:      p.InningNumber,
        half:        p.InningHalf === "T" ? "top" : "bottom",
        event:       p.Result || (p.Hit ? "Hit" : p.Walk ? "Walk" : "Play"),
        description: p.Description ?? "",
        awayScore:   p.AwayTeamRuns,
        homeScore:   p.HomeTeamRuns,
        rbi:         p.RunsBattedIn ?? 0,
      });
    }
    prevAway = p.AwayTeamRuns;
    prevHome = p.HomeTeamRuns;
  }
  return out;
}

function scoringPlaysFromRaw(playByPlay: Record<string, unknown>): Map<number, MlbScoringPlay[]> {
  const out = new Map<number, MlbScoringPlay[]>();
  for (const [id, env] of Object.entries(playByPlay)) {
    const pbp = env as SdioPlayByPlay | null;
    if (!pbp) continue;
    out.set(Number(id), scoringPlaysFromSdioPbp(pbp.Plays ?? []));
  }
  return out;
}

// IL placements as synthesized transactions. Pull-criteria: every player
// whose InjuryStartDate matches the digest date AND whose Status is one
// of the Injured List variants. Only NEW placements show up — chronic
// IL'd players don't repeat. SDIO's TransactionsByDate endpoint doesn't
// emit IL movements at all, so without this synthesis the SDIO digest
// is silent about every player placed on the IL today.
function injuryTransactionsFromRoster(
  rosterRaw: unknown,
  date: string,
  idx: Map<number, MlbTeamRef>,
): MlbTransaction[] {
  const roster = (rosterRaw as SdioPlayerRoster[] | null) ?? [];
  const out: MlbTransaction[] = [];
  for (const p of roster) {
    if (!p.InjuryStartDate) continue;
    if (p.InjuryStartDate.slice(0, 10) !== date) continue;
    if (!p.Status || !/Injured List/i.test(p.Status)) continue;
    const team = p.TeamID ? teamRefBy(idx, p.TeamID, undefined, p.Team ?? undefined) : null;
    // "60-Day Injured List" → "60-day IL" — keep the digest line tight.
    const ilLabel = p.Status
      .replace(/Injured List/i, "IL")
      .replace(/(\d+)-Day/i, "$1-day");
    const bodyPart = p.InjuryBodyPart ? ` (${p.InjuryBodyPart.toLowerCase()})` : "";
    const playerLine = `${p.LastName} placed on ${ilLabel}${bodyPart}.`;
    const description = team ? `${team.abbr}: ${playerLine}` : playerLine;
    out.push({
      date,
      typeLabel: "Injured List",
      description,
      player: playerRef("sdio", p.PlayerID, `${p.FirstName} ${p.LastName}`),
      fromTeam: null,
      toTeam: team,
    });
  }
  return out;
}

function transactionsFromRaw(
  raw: unknown,
  date: string,
  idx: Map<number, MlbTeamRef>,
): MlbTransaction[] {
  const txns = (raw as SdioTransaction[] | null) ?? [];
  return txns
    .filter((t) => t.Note || t.Type)
    .map<MlbTransaction>((t) => {
      const fromTeam = t.FormerTeamID ? teamRefBy(idx, t.FormerTeamID, undefined, t.FormerTeam ?? undefined) : null;
      const toTeam   = t.TeamID       ? teamRefBy(idx, t.TeamID,       undefined, t.Team       ?? undefined) : null;
      // SDIO's Note field starts with the player's surname and never
      // includes team context ("Morgan has been optioned to the minor
      // leagues."). statsapi bakes the team into the description prose
      // ("Kansas City Royals optioned…"). Prepend the team name(s) so
      // both vendors render with the same team-first shape — trades get
      // "From → To", regular moves get the single team responsible.
      const baseNote = t.Note ?? `${t.Type ?? "Transaction"}: ${t.Name ?? ""}`.trim();
      const teamPrefix =
        fromTeam && toTeam ? `${fromTeam.abbr} → ${toTeam.abbr}`
        : toTeam            ? toTeam.abbr
        : fromTeam          ? fromTeam.abbr
        : null;
      const description = teamPrefix ? `${teamPrefix}: ${baseNote}` : baseNote;
      return {
        date:        t.Date ?? date,
        typeLabel:   t.Type ?? "",
        description,
        player:      t.PlayerID ? playerRef("sdio", t.PlayerID, t.Name) : null,
        fromTeam,
        toTeam,
      };
    });
}

// ─── Public adapter ──────────────────────────────────────────────────────

export function adaptSdioDailyPayload(date: string, payload: SdioDailyPayload): CanonicalDailyData {
  const idx          = teamRefIndex(payload.teams);
  const pitcherStats = pitcherStatsLookup(payload.playerStats);
  const games        = sortGamesCanonically(((payload.games        as SdioGame[] | null) ?? []).map((g) => adaptGame(g, idx, pitcherStats)));
  const nextDayGames = sortGamesCanonically(((payload.nextDayGames as SdioGame[] | null) ?? []).map((g) => adaptGame(g, idx, pitcherStats)));
  const startingPositions = startingPositionsByGame(payload.startingLineups);
  return {
    date,
    games,
    boxScores:    boxScoresFromRaw(payload.boxScores, games, idx, batterSeasonLookup(payload.playerStats), payload.playByPlay ?? {}, startingPositions),
    scoringPlays: scoringPlaysFromRaw(payload.playByPlay ?? {}),
    nextDayGames,
    standings:    standingsFromRaw(payload.standings, idx),
    wildCard:     wildCardFromRaw(payload.standings, idx),
    leaderboards: leaderboardsFromRaw(payload.playerStats, payload.teams, payload.standings, idx),
    // IL placements lead — they're the highest-signal moves of the day
    // (a starter going down reshapes the next two weeks). Regular roster
    // moves follow in SDIO's native order.
    transactions: [
      ...injuryTransactionsFromRoster(payload.players, date, idx),
      ...transactionsFromRaw(payload.transactions, date, idx),
    ],
  };
}
