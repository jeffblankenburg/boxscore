// Season-to-date aggregations computed from cached `daily_raw` payloads.
// Powers the next iteration of the predictions model — team 1st-inning
// run-scoring rates, team bullpen quality, and per-pitcher 1st-inning
// ERA. All three are sums over the season's already-stored box scores;
// nothing new is fetched from statsapi.
//
// Design choice: zero new tables, zero new crons. Each call walks
// `daily_raw` rows for the season, sums the relevant fields, returns
// in-memory Maps. ~180 rows for a full season, each row ~1MB JSON —
// fast enough for the page render under Next.js's default fetch cache
// once we measure it. If aggregation cost becomes a problem we can
// snapshot to a nightly cache table; until then in-memory is honest.

import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase";

// ─── Public types ────────────────────────────────────────────────────────

export type TeamFirstInningStats = {
  teamId: number;
  games: number;
  runs: number;
  runsPerGame: number;
};

export type TeamBullpenStats = {
  teamId: number;
  innings: number;
  earnedRuns: number;
  walks: number;
  strikeouts: number;
  era: number;        // 9*ER/IP — null clamped to LG_AVG when not enough innings
  k9: number;
  bb9: number;
};

export type SpFirstInningStats = {
  pitcherId: number;
  starts: number;
  runs: number;
  era: number;        // 9*runs/starts since each start = 1 first-inning
};

// Rolling-window forms — captures hot/cold streaks the full-season
// Pythagorean record washes out. Empty (games=0) when the team or
// pitcher has no recent activity in the window.
export type TeamRecentForm = {
  teamId: number;
  games: number;
  runsScored: number;
  runsAllowed: number;
};
export type SpRecentForm = {
  pitcherId: number;
  starts: number;
  earnedRuns: number;
  innings: number;
  era: number;        // 9*ER/IP; null when innings = 0
};

export type SeasonAggregates = {
  asOfDate: string;
  daysCovered: number;
  team1stInning: Map<number, TeamFirstInningStats>;
  teamBullpen:   Map<number, TeamBullpenStats>;
  spFirstInning: Map<number, SpFirstInningStats>;
  /** Last-21-day team RS/RA for blending with the season-long
   *  pythagorean expected win pct. */
  teamRecentForm: Map<number, TeamRecentForm>;
  /** Last-N-starts per-pitcher ERA for blending with season ERA. */
  spRecentForm:   Map<number, SpRecentForm>;
  league: {
    avgFirstInningRpg: number;     // average 1st-inning runs per TEAM per game
    avgBullpenEra:     number;     // league-wide bullpen ERA
    avgSpFirstInningEra: number;   // league-wide SP 1st-inning ERA
  };
};

// Tunable. Recent-form window in days. 21 = three weeks, enough for
// ~18 games / ~4-5 starts per starter — big enough for signal, small
// enough to detect hot/cold runs the full season doesn't see.
export const RECENT_FORM_WINDOW_DAYS = 21;

// ─── Raw payload subset ──────────────────────────────────────────────────

type Inning = {
  num?: number;
  away?: { runs?: number };
  home?: { runs?: number };
};
type ScheduleGame = {
  gamePk?: number;
  status?: { detailedState?: string; abstractGameState?: string };
  teams?: {
    away?: { team?: { id?: number }; score?: number };
    home?: { team?: { id?: number }; score?: number };
  };
  linescore?: { innings?: Inning[] };
};
type Schedule = { dates?: Array<{ games?: ScheduleGame[] }> };

type PitchingStats = Partial<{
  inningsPitched: string;
  earnedRuns: number;
  baseOnBalls: number;
  strikeOuts: number;
}>;
type BoxPlayer = {
  person?: { id?: number };
  stats?: { pitching?: PitchingStats };
};
type BoxSide = {
  team?: { id?: number };
  pitchers?: number[];                              // appearance order
  players?: Record<string, BoxPlayer>;              // keyed by "ID<personId>"
};
type BoxGame = {
  boxscore?: {
    teams?: { away?: BoxSide; home?: BoxSide };
  };
};

type Payload = {
  schedule?: Schedule;
  games?: Record<string, BoxGame>;
};

// ─── Helpers ─────────────────────────────────────────────────────────────

function ipStringToDecimal(s: string | null | undefined): number {
  if (!s) return 0;
  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  const whole = Math.trunc(n);
  const tenths = Math.round((n - whole) * 10);
  return whole + (tenths === 1 ? 1 / 3 : tenths === 2 ? 2 / 3 : 0);
}

// Mutating accumulators keyed by id. Slightly chubbier than returning
// new Maps each iteration, but avoids allocation in the hot loop.
function bumpTeamFirstInning(
  acc: Map<number, { games: number; runs: number }>,
  teamId: number,
  runs: number,
): void {
  const cur = acc.get(teamId) ?? { games: 0, runs: 0 };
  cur.games += 1;
  cur.runs  += runs;
  acc.set(teamId, cur);
}

function bumpBullpen(
  acc: Map<number, { innings: number; earnedRuns: number; walks: number; strikeouts: number }>,
  teamId: number,
  ip: number,
  er: number,
  bb: number,
  k: number,
): void {
  const cur = acc.get(teamId) ?? { innings: 0, earnedRuns: 0, walks: 0, strikeouts: 0 };
  cur.innings    += ip;
  cur.earnedRuns += er;
  cur.walks      += bb;
  cur.strikeouts += k;
  acc.set(teamId, cur);
}

function bumpSpFirstInning(
  acc: Map<number, { starts: number; runs: number }>,
  pitcherId: number,
  runs: number,
): void {
  const cur = acc.get(pitcherId) ?? { starts: 0, runs: 0 };
  cur.starts += 1;
  cur.runs   += runs;
  acc.set(pitcherId, cur);
}

// ─── Public loader ───────────────────────────────────────────────────────

// React cache() dedupes within a request. Page render + snapshot cron
// hit this once each; the dedup matters when other future surfaces start
// pulling aggregates too. Module-level memo on top so warm serverless
// instances skip the work entirely until they go cold.
const memo = new Map<string, { result: SeasonAggregates; ts: number }>();
const MEMO_TTL_MS = 6 * 60 * 60 * 1000;   // 6 hours; aggregates only move overnight

export const loadSeasonAggregates = cache(async function loadSeasonAggregates(
  season: number,
  throughDate: string,
): Promise<SeasonAggregates> {
  const memoKey = `${season}|${throughDate}`;
  const cached = memo.get(memoKey);
  if (cached && Date.now() - cached.ts < MEMO_TTL_MS) return cached.result;
  const out = await loadSeasonAggregatesUncached(season, throughDate);
  memo.set(memoKey, { result: out, ts: Date.now() });
  return out;
});

async function loadSeasonAggregatesUncached(
  season: number,
  throughDate: string,
): Promise<SeasonAggregates> {
  // Each daily_raw row is ~1MB of JSON; pulling 100+ in one request
  // blows past Supabase's response-size limit (522 timeout from
  // Cloudflare). Pull one date at a time. Slower (N round trips) but
  // reliable. With ~120 days, ~50ms each, this is ~6s — well within
  // page-render budget.
  const sb = supabaseAdmin();
  const { data: dateRows, error: datesErr } = await sb
    .from("daily_raw")
    .select("date")
    .eq("sport", "mlb")
    .gte("date", `${season}-03-01`)        // before Opening Day for the buffer
    .lte("date", throughDate)
    .order("date", { ascending: true });
  if (datesErr) throw new Error(`loadSeasonAggregates dates: ${datesErr.message}`);

  const rawTeam1st = new Map<number, { games: number; runs: number }>();
  const rawBullpen = new Map<number, { innings: number; earnedRuns: number; walks: number; strikeouts: number }>();
  const rawSp1st   = new Map<number, { starts: number; runs: number }>();
  // Recent-form windows: only games whose date is within the last
  // RECENT_FORM_WINDOW_DAYS of throughDate. Pre-compute the cutoff so
  // the comparison is integer math in the hot loop.
  const cutoff = new Date(throughDate + "T00:00:00Z");
  cutoff.setUTCDate(cutoff.getUTCDate() - RECENT_FORM_WINDOW_DAYS);
  const cutoffMs = cutoff.getTime();
  const rawTeamRecent = new Map<number, { games: number; rs: number; ra: number }>();
  const rawSpRecent = new Map<number, { starts: number; er: number; ip: number }>();
  let daysCovered = 0;

  const rows: Array<{ date: string; payload: Payload }> = [];
  for (const dRow of (dateRows ?? []) as Array<{ date: string }>) {
    const { data: oneRow, error } = await sb
      .from("daily_raw")
      .select("date, payload")
      .eq("sport", "mlb")
      .eq("date", dRow.date)
      .maybeSingle();
    if (error) throw new Error(`loadSeasonAggregates row(${dRow.date}): ${error.message}`);
    if (oneRow) rows.push(oneRow as unknown as { date: string; payload: Payload });
  }

  for (const row of rows) {
    daysCovered++;
    const payload = row.payload ?? {};
    const scheduleGames = (payload.schedule?.dates ?? []).flatMap((d) => d.games ?? []);
    const rowDateMs = new Date(row.date + "T00:00:00Z").getTime();
    const inRecentWindow = rowDateMs >= cutoffMs;

    for (const g of scheduleGames) {
      if (typeof g.gamePk !== "number") continue;
      // Only Final games count toward season aggregates. Postponed,
      // suspended, mid-game live states get skipped.
      const state = g.status?.detailedState ?? g.status?.abstractGameState ?? "";
      if (!/final/i.test(state)) continue;

      const awayTeamId = g.teams?.away?.team?.id;
      const homeTeamId = g.teams?.home?.team?.id;
      if (typeof awayTeamId !== "number" || typeof homeTeamId !== "number") continue;

      // Recent-form team RS/RA — straight from final scores. We can
      // grab these without touching the box, so very cheap.
      if (inRecentWindow) {
        const awayScore = g.teams?.away?.score;
        const homeScore = g.teams?.home?.score;
        if (typeof awayScore === "number" && typeof homeScore === "number") {
          const a = rawTeamRecent.get(awayTeamId) ?? { games: 0, rs: 0, ra: 0 };
          a.games += 1; a.rs += awayScore; a.ra += homeScore;
          rawTeamRecent.set(awayTeamId, a);
          const h = rawTeamRecent.get(homeTeamId) ?? { games: 0, rs: 0, ra: 0 };
          h.games += 1; h.rs += homeScore; h.ra += awayScore;
          rawTeamRecent.set(homeTeamId, h);
        }
      }

      // 1st-inning runs from linescore. Skip if either side is missing
      // so we don't pollute the rate with half-data games.
      const first = g.linescore?.innings?.find((i) => i.num === 1);
      const awayRuns1 = first?.away?.runs;
      const homeRuns1 = first?.home?.runs;
      if (typeof awayRuns1 === "number" && typeof homeRuns1 === "number") {
        bumpTeamFirstInning(rawTeam1st, awayTeamId, awayRuns1);
        bumpTeamFirstInning(rawTeam1st, homeTeamId, homeRuns1);
      }

      // Per-game box for pitcher splits.
      const box = payload.games?.[String(g.gamePk)]?.boxscore;
      if (!box) continue;
      for (const side of ["away", "home"] as const) {
        const half = box.teams?.[side];
        if (!half) continue;
        const teamId = half.team?.id;
        const pitchers = half.pitchers ?? [];
        if (typeof teamId !== "number" || pitchers.length === 0) continue;

        // SP gave up the 1st-inning runs charged to the opposing batter
        // line — i.e. SP=away allowed home's runs in the bottom of 1st,
        // and SP=home allowed away's runs in the top of 1st. The first
        // entry in `pitchers[]` is the starter (statsapi appearance order).
        const spId = pitchers[0];
        if (typeof spId === "number") {
          const allowed = side === "away" ? homeRuns1 : awayRuns1;
          if (typeof allowed === "number") bumpSpFirstInning(rawSp1st, spId, allowed);

          // Recent-form per-SP ERA — pull the starter's full pitching
          // line (not just the 1st inning) to accumulate ER/IP across
          // his last ~3-5 starts.
          if (inRecentWindow) {
            const sp = half.players?.[`ID${spId}`];
            const pi = sp?.stats?.pitching;
            if (pi) {
              const ip = ipStringToDecimal(pi.inningsPitched);
              if (ip > 0) {
                const cur = rawSpRecent.get(spId) ?? { starts: 0, er: 0, ip: 0 };
                cur.starts += 1;
                cur.er     += pi.earnedRuns ?? 0;
                cur.ip     += ip;
                rawSpRecent.set(spId, cur);
              }
            }
          }
        }

        // Bullpen = pitchers AFTER the starter. Sum their lines from
        // players[ID<n>].stats.pitching.
        for (let i = 1; i < pitchers.length; i++) {
          const id = pitchers[i];
          if (typeof id !== "number") continue;
          const p = half.players?.[`ID${id}`];
          const pi = p?.stats?.pitching;
          if (!pi) continue;
          const ip = ipStringToDecimal(pi.inningsPitched);
          if (ip <= 0) continue;
          bumpBullpen(rawBullpen, teamId, ip, pi.earnedRuns ?? 0, pi.baseOnBalls ?? 0, pi.strikeOuts ?? 0);
        }
      }
    }
  }

  // ─── Materialize rate stats ───────────────────────────────────────────

  const team1stInning = new Map<number, TeamFirstInningStats>();
  let leagueFirstInningRuns = 0, leagueFirstInningGames = 0;
  for (const [teamId, s] of rawTeam1st) {
    const rpg = s.games > 0 ? s.runs / s.games : 0;
    team1stInning.set(teamId, { teamId, games: s.games, runs: s.runs, runsPerGame: rpg });
    leagueFirstInningRuns  += s.runs;
    leagueFirstInningGames += s.games;
  }
  const avgFirstInningRpg = leagueFirstInningGames > 0 ? leagueFirstInningRuns / leagueFirstInningGames : 0.55;

  const teamBullpen = new Map<number, TeamBullpenStats>();
  let leagueRelIp = 0, leagueRelEr = 0;
  for (const [teamId, s] of rawBullpen) {
    const era = s.innings > 0 ? (9 * s.earnedRuns) / s.innings : 0;
    const k9  = s.innings > 0 ? (9 * s.strikeouts) / s.innings : 0;
    const bb9 = s.innings > 0 ? (9 * s.walks)       / s.innings : 0;
    teamBullpen.set(teamId, { teamId, innings: s.innings, earnedRuns: s.earnedRuns,
                              walks: s.walks, strikeouts: s.strikeouts, era, k9, bb9 });
    leagueRelIp += s.innings;
    leagueRelEr += s.earnedRuns;
  }
  const avgBullpenEra = leagueRelIp > 0 ? (9 * leagueRelEr) / leagueRelIp : 4.20;

  const spFirstInning = new Map<number, SpFirstInningStats>();
  let leagueSpStarts = 0, leagueSpRuns = 0;
  for (const [pitcherId, s] of rawSp1st) {
    const era = s.starts > 0 ? (9 * s.runs) / s.starts : 0;  // each start = 1 IP for this metric
    spFirstInning.set(pitcherId, { pitcherId, starts: s.starts, runs: s.runs, era });
    leagueSpStarts += s.starts;
    leagueSpRuns   += s.runs;
  }
  const avgSpFirstInningEra = leagueSpStarts > 0 ? (9 * leagueSpRuns) / leagueSpStarts : 4.50;

  const teamRecentForm = new Map<number, TeamRecentForm>();
  for (const [teamId, s] of rawTeamRecent) {
    teamRecentForm.set(teamId, { teamId, games: s.games, runsScored: s.rs, runsAllowed: s.ra });
  }

  const spRecentForm = new Map<number, SpRecentForm>();
  for (const [pitcherId, s] of rawSpRecent) {
    const era = s.ip > 0 ? (9 * s.er) / s.ip : 0;
    spRecentForm.set(pitcherId, { pitcherId, starts: s.starts, earnedRuns: s.er, innings: s.ip, era });
  }

  return {
    asOfDate: throughDate,
    daysCovered,
    team1stInning,
    teamBullpen,
    spFirstInning,
    teamRecentForm,
    spRecentForm,
    league: { avgFirstInningRpg, avgBullpenEra, avgSpFirstInningEra },
  };
}
