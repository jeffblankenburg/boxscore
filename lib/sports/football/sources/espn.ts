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

// The envelope persisted to daily_raw.payload and consumed by the adapter.
export type FootballRaw = {
  league: FootballLeagueConfig["league"];
  date: string;                             // YYYY-MM-DD
  scoreboard: unknown;                      // /scoreboard?dates=
  summaries: Record<string, unknown>;       // event id → /summary?event=
  standings: unknown | null;                // /standings; null if the fetch failed
  rankings: unknown | null;                 // /rankings (college only); null otherwise
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
  return `${FOOTBALL_WEB_BASE}/${cfg.espnSlug}/standings?season=${season}`;
}

export function rankingsUrl(cfg: FootballLeagueConfig): string {
  return `${FOOTBALL_BASE}/${cfg.espnSlug}/rankings`;
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

  const standings = await getJson(standingsUrl(cfg, season)).catch(() => null);
  const rankings = cfg.hasRankings
    ? await getJson(rankingsUrl(cfg)).catch(() => null)
    : null;

  return {
    league: cfg.league,
    date,
    scoreboard: slimScoreboard(fullScoreboard),
    summaries,
    standings,
    rankings,
  };
}
