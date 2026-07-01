// ESPN core API odds fetcher.
//
// Why ESPN: it's the only free MLB odds source we found that exposes
// per-side moneyline values (away + home) and supports historical
// queries. The Site API only carries the favorite's odds in a "BAL -148"
// string; the Core API at sports.core.api.espn.com gives us both sides
// as integers in `awayTeamOdds.moneyLine` / `homeTeamOdds.moneyLine`.
// Single provider (DraftKings), not multi-book consensus — but for a
// single-bettor ROI sim that's actually more honest than a synthetic
// median.
//
// NRFI lines are NOT in this feed. ESPN's prop bets endpoint only
// carries athlete props (Total Strikeouts, etc.). The `nrfi_odds` /
// `yrfi_odds` columns in `daily_odds` exist for the day we plug in a
// real NRFI source — see reference_nrfi_central.md.

const ESPN_SCOREBOARD =
  "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard";
const ESPN_EVENT_ODDS = (eventId: string) =>
  `https://sports.core.api.espn.com/v2/sports/baseball/leagues/mlb/events/${eventId}/competitions/${eventId}/odds`;

// ESPN team abbreviations differ from MLB statsapi's in exactly one
// place we've hit: White Sox. Add overrides here if other mismatches
// turn up in production. Keys are ESPN's abbr, values are our canonical
// (MLB statsapi) abbr.
const ESPN_TO_CANONICAL_ABBR: Record<string, string> = {
  CHW: "CWS",
};

function normalizeAbbr(espnAbbr: string | undefined): string | null {
  if (!espnAbbr) return null;
  const up = espnAbbr.toUpperCase();
  return ESPN_TO_CANONICAL_ABBR[up] ?? up;
}

export type EspnOddsRow = {
  eventId: string;
  awayAbbr: string;
  homeAbbr: string;
  startTimeUtc: string;
  awayMl: number | null;
  homeMl: number | null;
  book: string;            // "DraftKings"
  raw: Record<string, unknown>;
};

type ScoreboardCompetitor = {
  homeAway?: string;
  team?: { abbreviation?: string };
};
type ScoreboardCompetition = {
  date?: string;
  competitors?: ScoreboardCompetitor[];
};
type ScoreboardEvent = {
  id?: string;
  competitions?: ScoreboardCompetition[];
};
type ScoreboardResponse = {
  events?: ScoreboardEvent[];
};

type EventOddsProvider = {
  name?: string;
};
type EventOddsItem = {
  provider?: EventOddsProvider;
  awayTeamOdds?: { moneyLine?: number };
  homeTeamOdds?: { moneyLine?: number };
};
type EventOddsResponse = {
  items?: EventOddsItem[];
};

function isoToEspnDate(iso: string): string {
  return iso.replace(/-/g, "");
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, cache: "no-store" });
  if (!res.ok) {
    throw new Error(`${url} → HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

/** Pulls every MLB game's DraftKings ML odds for a single date from
 *  ESPN. Returns one row per game, with abbrs normalized to our
 *  canonical (statsapi) form so the caller can join on (date, abbr,
 *  abbr) → gamePk via daily_predictions.
 *
 *  Failures on individual events don't fail the batch — those games
 *  show up with `awayMl: null, homeMl: null` so the caller can decide
 *  whether to skip or upsert a partial row. */
export async function fetchEspnOddsForDate(
  isoDate: string,
): Promise<EspnOddsRow[]> {
  const scoreboard = await fetchJson<ScoreboardResponse>(
    `${ESPN_SCOREBOARD}?dates=${isoToEspnDate(isoDate)}`,
  );
  const events = scoreboard.events ?? [];

  const games = events
    .map((e) => {
      const comp = e.competitions?.[0];
      const away = comp?.competitors?.find((c) => c.homeAway === "away");
      const home = comp?.competitors?.find((c) => c.homeAway === "home");
      const awayAbbr = normalizeAbbr(away?.team?.abbreviation);
      const homeAbbr = normalizeAbbr(home?.team?.abbreviation);
      if (!e.id || !awayAbbr || !homeAbbr || !comp?.date) return null;
      return {
        eventId: e.id,
        awayAbbr,
        homeAbbr,
        startTimeUtc: comp.date,
      };
    })
    .filter((g): g is NonNullable<typeof g> => g !== null);

  // Fan out odds fetches in parallel — 30 events max in practice (one
  // slate), so this is well within ESPN's tolerance.
  const settled = await Promise.allSettled(
    games.map(async (g) => {
      const odds = await fetchJson<EventOddsResponse>(ESPN_EVENT_ODDS(g.eventId));
      const dk = (odds.items ?? []).find(
        (it) => it.provider?.name === "DraftKings",
      ) ?? odds.items?.[0];
      return {
        ...g,
        awayMl: typeof dk?.awayTeamOdds?.moneyLine === "number" ? dk.awayTeamOdds.moneyLine : null,
        homeMl: typeof dk?.homeTeamOdds?.moneyLine === "number" ? dk.homeTeamOdds.moneyLine : null,
        book: dk?.provider?.name ?? "DraftKings",
        raw: (dk ?? {}) as Record<string, unknown>,
      };
    }),
  );

  return settled.map((s, i) => {
    if (s.status === "fulfilled") return s.value;
    const g = games[i];
    if (!g) throw new Error(`internal: settled index ${i} has no game`);
    return {
      ...g,
      awayMl: null,
      homeMl: null,
      book: "DraftKings",
      raw: { error: (s.reason as Error).message },
    };
  });
}

/** Same odds row data, indexed by the (canonical away, canonical home)
 *  pair so a caller with daily_predictions in hand can look up odds
 *  without a second pass through the array. */
export function indexOddsByMatchup(rows: EspnOddsRow[]): Map<string, EspnOddsRow> {
  const out = new Map<string, EspnOddsRow>();
  for (const r of rows) {
    out.set(`${r.awayAbbr}|${r.homeAbbr}`, r);
  }
  return out;
}
