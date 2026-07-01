// FanDuel NRFI/YRFI odds fetcher.
//
// Why FanDuel: DraftKings's API endpoints sit behind Akamai bot
// protection — direct HTTP returns 403 or redirects to their HTML
// homepage. FanDuel's content API is reachable with just a referer +
// their static `_ak` token (lives in their public JS bundle, no
// per-request signing). That makes them the only major US book we can
// scrape without spinning up Playwright.
//
// NRFI lives on the "1st Inning 0.5 Runs" market — Under is NRFI (0
// runs scored), Over is YRFI (1+ runs). This is the canonical NRFI
// market on FanDuel (their explicit "NRFI" markets are sub-bets like
// individual-team first-inning NRFI, which isn't what we predict).
//
// This data is INTERNAL ONLY — per memory feedback_scraped_odds_internal_only.md,
// we never render per-game odds publicly. Aggregate ROI math is the
// only public surface.

const FANDUEL_BASE = "https://sbapi.nj.sportsbook.fanduel.com/api";

// Static API key from FanDuel's public JS bundle. Hasn't rotated in
// years per community reverse-engineering; if it ever does, the
// inbound 403/400s will tell us and we'll need to scrape the value
// from their HTML on each run.
const FANDUEL_AK = "FhMFpcPWXMeyZxOx";

const FANDUEL_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Accept": "application/json",
  "Referer": "https://sportsbook.fanduel.com/",
} as const;

const NRFI_MARKET_NAME = "1st Inning 0.5 Runs";

export type FanDuelNrfiRow = {
  eventId: string;
  awayTeamName: string;       // raw FanDuel name, e.g. "Tampa Bay Rays"
  homeTeamName: string;
  startTimeUtc: string;
  /** American odds for NRFI (Under 0.5 runs in 1st inning). */
  nrfiOdds: number | null;
  /** American odds for YRFI (Over 0.5 runs in 1st inning). */
  yrfiOdds: number | null;
  raw: Record<string, unknown>;
};

type FanDuelEvent = {
  eventId?: number;
  name?: string;
  openDate?: string;
  eventTypeId?: number;
};
type FanDuelMlbPage = {
  attachments?: {
    events?: Record<string, FanDuelEvent>;
  };
};

type FanDuelRunner = {
  runnerName?: string;
  winRunnerOdds?: {
    americanDisplayOdds?: {
      americanOddsInt?: number;
    };
  };
};
type FanDuelMarket = {
  marketName?: string;
  runners?: FanDuelRunner[];
};
type FanDuelEventPage = {
  attachments?: {
    events?: Record<string, FanDuelEvent>;
    markets?: Record<string, FanDuelMarket>;
  };
};

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: FANDUEL_HEADERS, cache: "no-store" });
  if (!res.ok) {
    throw new Error(`${url} → HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

/** Parse FanDuel event names like
 *  "Tampa Bay Rays (G Jax) @ Kansas City Royals (N Cameron)"
 *  into clean team names. Returns null if the format doesn't match
 *  (rare, e.g. doubleheader nightcaps occasionally use a slightly
 *  different format). */
export function parseFanDuelEventName(name: string): { away: string; home: string } | null {
  // Drop everything in parens (probable-pitcher hints) then split on @.
  const cleaned = name.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
  const parts = cleaned.split(" @ ");
  if (parts.length !== 2) return null;
  const [away, home] = parts;
  if (!away || !home) return null;
  return { away: away.trim(), home: home.trim() };
}

/** Pulls every NRFI line FanDuel has posted for the date.
 *
 *  Strategy:
 *    1. Fetch the MLB index page to get today's MLB event IDs
 *    2. Filter events to those whose `openDate` falls on the requested
 *       ISO date in ET (FanDuel returns games in UTC; same date in ET
 *       is what we anchor to)
 *    3. Per event, fetch the full market list and pull the
 *       "1st Inning 0.5 Runs" market's Over/Under
 *
 *  Failures on individual events don't fail the batch — those games
 *  come back with `nrfiOdds: null, yrfiOdds: null`. Returns [] when
 *  FanDuel returns no events (e.g. all-star break). */
export async function fetchFanDuelNrfiForDate(
  isoDate: string,
): Promise<FanDuelNrfiRow[]> {
  // MLB content-managed-page lists today's games as "events". The
  // events themselves only carry the headline markets at this level
  // (no NRFI yet); we need per-event fetches for that.
  const page = await fetchJson<FanDuelMlbPage>(
    `${FANDUEL_BASE}/content-managed-page?page=CUSTOM&customPageId=mlb&pbHash=&_ak=${FANDUEL_AK}&timezone=America%2FNew_York`,
  );
  const events = Object.values(page.attachments?.events ?? {});

  // Keep only real matchups whose openDate is on the requested ET date.
  // FanDuel openDate is ISO UTC; an ET-day game starting 7pm ET is 23:00 UTC
  // on the same day, but a 1pm ET game on the next day is 17:00 UTC the next
  // day. To map UTC → ET reliably enough for the slate filter we just
  // subtract 4h (EDT during the season) and compare the resulting ISO date.
  const targetEt = isoDate;
  const games = events
    .filter((e) => {
      if (!e.eventId || !e.openDate || !e.name) return false;
      if (!e.name.includes(" @ ")) return false;
      const utc = new Date(e.openDate).getTime();
      const etIso = new Date(utc - 4 * 60 * 60 * 1000).toISOString().slice(0, 10);
      return etIso === targetEt;
    })
    .map((e) => {
      const parsed = parseFanDuelEventName(e.name ?? "");
      if (!parsed) return null;
      return {
        eventId: String(e.eventId),
        awayTeamName: parsed.away,
        homeTeamName: parsed.home,
        startTimeUtc: e.openDate ?? "",
      };
    })
    .filter((g): g is NonNullable<typeof g> => g !== null);

  // Per-event market fetches in parallel.
  const settled = await Promise.allSettled(
    games.map(async (g) => {
      const ev = await fetchJson<FanDuelEventPage>(
        `${FANDUEL_BASE}/event-page?eventId=${g.eventId}&_ak=${FANDUEL_AK}`,
      );
      const markets = ev.attachments?.markets ?? {};
      const nrfi = Object.values(markets).find(
        (m) => m.marketName === NRFI_MARKET_NAME,
      );
      const over  = nrfi?.runners?.find((r) => r.runnerName === "Over");
      const under = nrfi?.runners?.find((r) => r.runnerName === "Under");
      const yrfiOdds = over?.winRunnerOdds?.americanDisplayOdds?.americanOddsInt;
      const nrfiOdds = under?.winRunnerOdds?.americanDisplayOdds?.americanOddsInt;
      return {
        ...g,
        nrfiOdds: typeof nrfiOdds === "number" ? nrfiOdds : null,
        yrfiOdds: typeof yrfiOdds === "number" ? yrfiOdds : null,
        raw: nrfi ? (nrfi as unknown as Record<string, unknown>) : {},
      };
    }),
  );

  return settled.map((s, i) => {
    if (s.status === "fulfilled") return s.value;
    const g = games[i];
    if (!g) throw new Error(`internal: settled index ${i} has no game`);
    return {
      ...g,
      nrfiOdds: null,
      yrfiOdds: null,
      raw: { error: (s.reason as Error).message },
    };
  });
}

/** Index by (away team name, home team name) for caller-side lookup. */
export function indexFanDuelByMatchup(rows: FanDuelNrfiRow[]): Map<string, FanDuelNrfiRow> {
  const out = new Map<string, FanDuelNrfiRow>();
  for (const r of rows) {
    out.set(`${r.awayTeamName}|${r.homeTeamName}`, r);
  }
  return out;
}
