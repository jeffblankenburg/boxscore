// ESPN fetch layer for football — the ONLY I/O in the football module.
// Everything else (adapter, renderers) is a pure transform over the raw
// envelope this file produces. Mirrors lib/basketball.ts's ESPN client;
// the shapes diverge because football has per-event box summaries, drives,
// and (for college) poll rankings.
//
// A day's raw is: the scoreboard for that date, one box `summary` per
// event on the slate, the season standings, and (NCAAF only) the current
// poll rankings. We cache the whole envelope as one JSON blob in daily_raw
// keyed by (sport, date) — same table MLB and basketball use — so the
// adapter can rebuild the canonical bundle offline with no network.

import type { FootballLeagueConfig } from "../leagues";

const FOOTBALL_BASE = "https://site.api.espn.com/apis/site/v2/sports/football";
const FOOTBALL_WEB_BASE = "https://site.web.api.espn.com/apis/v2/sports/football";
const FOOTBALL_LEADERS_BASE = "https://site.web.api.espn.com/apis/common/v3/sports/football";

// How many days past the recap date the "Next Matchups" window covers — a bit
// over two weeks catches the next NFL week even across the regular-season →
// playoff gap, and the next Saturday for college.
const NEXT_WINDOW_DAYS = 16;

// Season leaders to surface, in display order. `category` is the byathlete
// category name used to READ the athlete's values; `sortCategory` (when it
// differs) is the case-sensitive prefix the `sort=` param needs — ESPN reads
// "defensiveinterceptions" but only sorts on "defensiveInterceptions".
export const FOOTBALL_LEADER_STATS: ReadonlyArray<{ category: string; stat: string; label: string; sortCategory?: string }> = [
  { category: "passing", stat: "passingYards", label: "Passing Yards" },
  { category: "passing", stat: "passingTouchdowns", label: "Passing TD" },
  { category: "rushing", stat: "rushingYards", label: "Rushing Yards" },
  { category: "rushing", stat: "rushingTouchdowns", label: "Rushing TD" },
  { category: "receiving", stat: "receivingYards", label: "Receiving Yards" },
  { category: "receiving", stat: "receivingTouchdowns", label: "Receiving TD" },
  { category: "receiving", stat: "receptions", label: "Receptions" },
  { category: "defensive", stat: "sacks", label: "Sacks" },
  { category: "defensive", stat: "totalTackles", label: "Tackles" },
  { category: "defensive", stat: "tacklesForLoss", label: "Tackles For Loss" },
];

// The envelope persisted to daily_raw.payload and consumed by the adapter.
export type FootballRaw = {
  league: FootballLeagueConfig["league"];
  date: string;                             // YYYY-MM-DD
  scoreboard: unknown;                      // /scoreboard?dates=
  nextScoreboard: unknown | null;           // /scoreboard for the upcoming window (Next Matchups)
  summaries: Record<string, unknown>;       // event id → /summary?event=
  standings: unknown | null;                // /standings; null if the fetch failed
  rankings: unknown | null;                 // /rankings (college only); null otherwise
  leaders: unknown | null;                  // /statistics/byathlete season leaders
  transactions: unknown | null;             // /transactions recent roster moves
};

// ---- Network --------------------------------------------------------------

async function getJson(url: string): Promise<unknown> {
  // One retry with linear backoff, matching the basketball client: ESPN
  // serves the occasional 5xx during cache rebuilds, and a single retry
  // covers it without becoming a thundering herd when they're truly down.
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetch(url, { cache: "no-store" });
    if (res.ok) return res.json();
    if (attempt === 2 || res.status < 500) {
      throw new Error(`ESPN ${res.status} for ${url}`);
    }
    await new Promise((r) => setTimeout(r, 750));
  }
  throw new Error("unreachable");
}

// Run `fn` over `items` with bounded concurrency. A full FBS Saturday is
// ~60–80 box summaries; firing them all at once invites rate-limiting, so
// we keep a small window in flight. Failures reject so the caller decides.
async function pooledMap<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

// ---- URL builders (exported for the smoke script / tests) -----------------

export function scoreboardUrl(cfg: FootballLeagueConfig, date: string): string {
  const espnDate = date.replace(/-/g, "");
  const params = new URLSearchParams({ dates: espnDate, limit: String(cfg.scoreboardLimit) });
  if (cfg.scoreboardGroups != null) params.set("groups", String(cfg.scoreboardGroups));
  return `${FOOTBALL_BASE}/${cfg.espnSlug}/scoreboard?${params}`;
}

export function summaryUrl(cfg: FootballLeagueConfig, eventId: string): string {
  return `${FOOTBALL_BASE}/${cfg.espnSlug}/summary?event=${eventId}`;
}

export function standingsUrl(cfg: FootballLeagueConfig, season: number): string {
  const level = cfg.standingsLevel != null ? `&level=${cfg.standingsLevel}` : "";
  return `${FOOTBALL_WEB_BASE}/${cfg.espnSlug}/standings?season=${season}${level}`;
}

export function rankingsUrl(cfg: FootballLeagueConfig): string {
  return `${FOOTBALL_BASE}/${cfg.espnSlug}/rankings`;
}

// Upcoming slate for the "Next Matchups" section — the scoreboard over an
// inclusive date range starting the day after the recap date.
export function nextScoreboardUrl(cfg: FootballLeagueConfig, date: string, windowDays: number): string {
  const start = addDaysIso(date, 1).replace(/-/g, "");
  const end = addDaysIso(date, windowDays).replace(/-/g, "");
  const params = new URLSearchParams({ dates: `${start}-${end}`, limit: String(cfg.scoreboardLimit) });
  if (cfg.scoreboardGroups != null) params.set("groups", String(cfg.scoreboardGroups));
  return `${FOOTBALL_BASE}/${cfg.espnSlug}/scoreboard?${params}`;
}

// Season stat leaders (byathlete): one big blob carrying every athlete's
// per-category stat values, which the adapter sorts into per-stat top-N lists.
// byathlete sorted by a specific stat — the endpoint's default (unsorted) blob
// is QB-heavy and misses the rushing/receiving/sack leaders, so we ask for each
// stat's own top-6 via `sort=category.stat:desc`.
export function leaderStatUrl(cfg: FootballLeagueConfig, season: number, category: string, stat: string): string {
  // limit=20 (not 6) leaves headroom for "top 5 through ties" — TD and sack
  // leaders routinely have many players tied at the 5th-place value.
  return `${FOOTBALL_LEADERS_BASE}/${cfg.espnSlug}/statistics/byathlete?season=${season}&seasontype=2&limit=20&sort=${category}.${stat}:desc`;
}

export function transactionsUrl(cfg: FootballLeagueConfig): string {
  return `${FOOTBALL_BASE}/${cfg.espnSlug}/transactions`;
}

// Add whole days to an ISO date (UTC math, no timezone drift).
function addDaysIso(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, d!) + days * 86_400_000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

// ---- Payload slimming -----------------------------------------------------
//
// ESPN's per-game summary is ~470 KB — dominated by full play-by-play
// (drives[].plays), win-probability, news, and logo arrays the adapter never
// reads. Storing 80 of those for an FBS Saturday blows past Supabase's
// request-body limit (the write fails with "fetch failed"). We slim each
// summary and scoreboard event to an allow-list of exactly the fields
// adapters/from-espn.ts consumes, cutting ~470 KB → ~24 KB per game (an FBS
// Saturday lands ~1.9 MB, in the same range as MLB's daily_raw rows).
//
// IMPORTANT: this allow-list must stay in sync with what from-espn.ts reads.
// Adding a field to the adapter means adding it here, or it'll be null on
// replayed (cached) rows while working on a fresh fetch — a subtle drift.

type Any = Record<string, unknown>;
const obj = (v: unknown): Any => (v && typeof v === "object" ? (v as Any) : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (v == null ? "" : String(v));
const pick = (v: unknown, keys: string[]): Any => {
  const o = obj(v);
  const out: Any = {};
  for (const k of keys) out[k] = o[k];
  return out;
};

// Team reference fields the adapter's teamRef() reads.
const slimTeam = (t: unknown): Any =>
  pick(t, ["id", "abbreviation", "displayName", "name", "shortDisplayName"]);

function slimSummary(summary: unknown): Any {
  const s = obj(summary);
  const box = obj(s.boxscore);
  return {
    boxscore: {
      players: list(box.players).map((p) => {
        const pe = obj(p);
        return {
          team: slimTeam(pe.team),
          statistics: list(pe.statistics).map((g) => {
            const grp = obj(g);
            return {
              name: grp.name,
              labels: grp.labels,
              athletes: list(grp.athletes).map((a) => {
                const ae = obj(a);
                return {
                  athlete: pick(ae.athlete, ["id", "displayName", "fullName", "shortName"]),
                  stats: ae.stats,
                };
              }),
            };
          }),
        };
      }),
      teams: list(box.teams).map((t) => {
        const te = obj(t);
        return {
          team: { id: obj(te.team).id },
          statistics: list(te.statistics).map((st) => pick(st, ["name", "displayValue"])),
        };
      }),
    },
    scoringPlays: list(s.scoringPlays).map((p) => {
      const pe = obj(p);
      return {
        period: pe.period,
        clock: pe.clock,
        team: slimTeam(pe.team),
        scoringType: pe.scoringType,
        type: pe.type,
        text: pe.text,
        awayScore: pe.awayScore,
        homeScore: pe.homeScore,
      };
    }),
    drives: {
      previous: list(obj(s.drives).previous).map((d) => {
        const de = obj(d);
        return {
          team: slimTeam(de.team),
          result: de.result,
          shortDisplayResult: de.shortDisplayResult,
          description: de.description,
          offensivePlays: de.offensivePlays,
          yards: de.yards,
          isScore: de.isScore,
        };
      }),
    },
    gameInfo: {
      venue: { fullName: obj(obj(s.gameInfo).venue).fullName },
      attendance: obj(s.gameInfo).attendance,
      weather: obj(s.gameInfo).weather,
    },
    header: {
      competitions: [
        {
          competitors: list(obj(list(obj(s.header).competitions)[0]).competitors).map((c) => {
            const ce = obj(c);
            return { homeAway: ce.homeAway, team: { id: obj(ce.team).id } };
          }),
        },
      ],
    },
  };
}

function slimScoreboard(scoreboard: unknown): Any {
  const sb = obj(scoreboard);
  return {
    events: list(sb.events).map((e) => {
      const ev = obj(e);
      const comp = obj(list(ev.competitions)[0]);
      return {
        id: ev.id,
        date: ev.date,
        season: pick(ev.season, ["year", "type"]),
        week: pick(ev.week, ["number"]),
        competitions: [
          {
            neutralSite: comp.neutralSite,
            conferenceCompetition: comp.conferenceCompetition,
            venue: { fullName: obj(comp.venue).fullName },
            status: { type: pick(obj(comp.status).type, ["state", "name", "shortDetail", "detail", "description"]) },
            notes: list(comp.notes).map((n) => pick(n, ["headline"])),
            competitors: list(comp.competitors).map((c) => {
              const ce = obj(c);
              return {
                homeAway: ce.homeAway,
                score: ce.score,
                linescores: ce.linescores,
                curatedRank: pick(ce.curatedRank, ["current"]),
                team: slimTeam(ce.team),
              };
            }),
          },
        ],
      };
    }),
  };
}

// One stat's leader response (already sorted by the stat). Keep the category's
// schema `names` (to find the value index) and, per athlete, identity + that
// category's positional `values`.
function slimLeaderStat(spec: { category: string; stat: string; label: string }, response: unknown): Any {
  const r = obj(response);
  const catSchema = list(r.categories).map(obj).find((c) => str(c.name) === spec.category);
  return {
    category: spec.category,
    stat: spec.stat,
    label: spec.label,
    names: catSchema ? catSchema.names : [],
    athletes: list(r.athletes).map((a) => {
      const ae = obj(a);
      const ath = obj(ae.athlete);
      const cat = list(ae.categories).map(obj).find((c) => str(c.name) === spec.category);
      // `teamShortName` is the player's CURRENT team; `teams[0]` is the team
      // they played for in THIS season — use the latter so a leader from a past
      // season shows the right team even after a trade (e.g. Garrett was CLE in
      // 2025, not his later team).
      const seasonTeam = str(obj(list(ath.teams)[0]).abbreviation) || str(ath.teamShortName);
      return {
        athlete: {
          id: ath.id,
          displayName: ath.displayName,
          teamAbbr: seasonTeam,
          position: { abbreviation: obj(ath.position).abbreviation },
        },
        values: cat ? cat.values : [],
      };
    }),
  };
}

function slimTransactions(transactions: unknown): Any {
  return {
    transactions: list(obj(transactions).transactions).map((t) => {
      const te = obj(t);
      return { date: te.date, description: te.description, team: { abbreviation: obj(te.team).abbreviation } };
    }),
  };
}

// ---- Raw envelope assembly ------------------------------------------------

// Pull the event ids out of a scoreboard payload. Minimal structural read —
// just enough to know which box summaries to fetch. Full parsing is the
// adapter's job.
export function eventIdsFromScoreboard(scoreboard: unknown): string[] {
  const events = (scoreboard as { events?: Array<{ id?: unknown }> } | null)?.events ?? [];
  return events
    .map((e) => (e?.id == null ? null : String(e.id)))
    .filter((id): id is string => id != null);
}

/**
 * Fetch a full day's raw football envelope from ESPN. Fetches the
 * scoreboard, a box summary for every event on the slate, the season
 * standings, and (NCAAF only) poll rankings. Standings and rankings are
 * best-effort — a failure there yields null rather than sinking the whole
 * day's digest, since the scoreboard + boxes are the core content.
 */
export async function fetchFootballRaw(
  cfg: FootballLeagueConfig,
  date: string,
  season: number,
): Promise<FootballRaw> {
  const fullScoreboard = await getJson(scoreboardUrl(cfg, date));
  const ids = eventIdsFromScoreboard(fullScoreboard);

  const summaryList = await pooledMap(ids, 6, async (id) => {
    try {
      // Slim immediately so the ~470 KB full summary is never held for the
      // whole slate at once, only the ~24 KB allow-listed version.
      return [id, slimSummary(await getJson(summaryUrl(cfg, id)))] as const;
    } catch {
      // A single flaky box shouldn't drop the whole slate; the adapter
      // renders the scoreboard row without a box when a summary is missing.
      return [id, null] as const;
    }
  });
  const summaries: Record<string, unknown> = {};
  for (const [id, payload] of summaryList) {
    if (payload != null) summaries[id] = payload;
  }

  // Secondary sections — all best-effort (null on failure) so a hiccup in any
  // one doesn't sink the digest. Fetched after the boxes to keep peak
  // concurrency down.
  const standings = await getJson(standingsUrl(cfg, season)).catch(() => null);
  const rankings = cfg.hasRankings
    ? await getJson(rankingsUrl(cfg)).catch(() => null)
    : null;
  const nextRaw = await getJson(nextScoreboardUrl(cfg, date, NEXT_WINDOW_DAYS)).catch(() => null);
  const leaders = (await pooledMap([...FOOTBALL_LEADER_STATS], 4, async (spec) => {
    try {
      return slimLeaderStat(spec, await getJson(leaderStatUrl(cfg, season, spec.sortCategory ?? spec.category, spec.stat)));
    } catch {
      return null;
    }
  })).filter((x): x is Any => x != null);
  const transactionsRaw = await getJson(transactionsUrl(cfg)).catch(() => null);

  return {
    league: cfg.league,
    date,
    scoreboard: slimScoreboard(fullScoreboard),
    nextScoreboard: nextRaw ? slimScoreboard(nextRaw) : null,
    summaries,
    standings,
    rankings,
    leaders: leaders.length ? leaders : null,
    transactions: transactionsRaw ? slimTransactions(transactionsRaw) : null,
  };
}
