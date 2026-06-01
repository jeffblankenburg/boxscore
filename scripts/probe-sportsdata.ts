// SportsDataIO MLB API re-probe — targets the three open gaps left over from
// the issue #28 evaluation. Writes raw JSON shapes (first record only) and
// rate-limit headers to stdout so a human can scan a single run and decide
// whether SportsDataIO is viable for migration off statsapi.mlb.com.
//
// Run:
//   npx tsx --env-file=.env.local scripts/probe-sportsdata.ts
//
// Env: SPORTSDATA_API_KEY must be set.
//
// Three things being probed:
//   1. Transactions / News for current dates (original probe returned 404 —
//      possibly a free-tier scope issue; retry with multiple recent dates).
//   2. PlayerSeasonStats for the current MLB season — verify it carries
//      pitcher win-loss + ERA mid-season, which is what we'd need to hydrate
//      probable pitcher lines without a separate /people stats call.
//   3. Trial scope: what dates does the trial actually allow, and which
//      rate-limit headers come back.
//
// Each block: prints endpoint, HTTP status, useful headers, then a shape
// summary (top-level keys + sample first record). No DB writes, no side
// effects.

const KEY = process.env.SPORTSDATA_API_KEY;
if (!KEY) {
  console.error("SPORTSDATA_API_KEY not set in .env.local");
  process.exit(1);
}

const BASE = "https://api.sportsdata.io/v3/mlb";

// Header set worth surfacing — SDIO publishes rate-limit info per call.
const HEADERS_OF_INTEREST = [
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
  "content-type",
  "cf-cache-status",
];

type ProbeResult = {
  url: string;
  status: number;
  headers: Record<string, string>;
  body: unknown;
  bodyError?: string;
};

async function probe(path: string): Promise<ProbeResult> {
  const url = `${BASE}${path}${path.includes("?") ? "&" : "?"}key=${KEY}`;
  const res = await fetch(url);
  const headers: Record<string, string> = {};
  for (const h of HEADERS_OF_INTEREST) {
    const v = res.headers.get(h);
    if (v) headers[h] = v;
  }
  let body: unknown = null;
  let bodyError: string | undefined;
  const text = await res.text();
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch (e) {
      bodyError = (e as Error).message;
      body = text.slice(0, 300);
    }
  }
  // URL printed without the key for logs.
  return { url: url.replace(/key=[^&]+/, "key=***"), status: res.status, headers, body, bodyError };
}

function summarize(label: string, r: ProbeResult): void {
  console.log(`\n── ${label} ───────────────────────────────────────`);
  console.log(`GET ${r.url}`);
  console.log(`HTTP ${r.status}`);
  if (Object.keys(r.headers).length > 0) {
    for (const [k, v] of Object.entries(r.headers)) console.log(`  ${k}: ${v}`);
  }
  if (r.bodyError) {
    console.log(`body parse error: ${r.bodyError}`);
    console.log(`body (first 300 chars): ${r.body}`);
    return;
  }
  if (r.body === null) {
    console.log(`(empty body)`);
    return;
  }
  if (Array.isArray(r.body)) {
    console.log(`array length: ${r.body.length}`);
    if (r.body.length > 0) {
      const first = r.body[0];
      if (first && typeof first === "object") {
        console.log(`first item keys (${Object.keys(first).length}):`);
        console.log(`  ${Object.keys(first as object).join(", ")}`);
        console.log(`first item sample:`);
        console.log(JSON.stringify(first, null, 2).split("\n").slice(0, 40).join("\n"));
      } else {
        console.log(`first item: ${JSON.stringify(first)}`);
      }
    }
  } else if (typeof r.body === "object") {
    console.log(`object keys: ${Object.keys(r.body as object).join(", ")}`);
    console.log(JSON.stringify(r.body, null, 2).split("\n").slice(0, 30).join("\n"));
  } else {
    console.log(`body: ${JSON.stringify(r.body).slice(0, 300)}`);
  }
}

// Build several recent dates so we can spot trial-window restrictions.
function isoDaysAgo(days: number): string {
  const d = new Date(Date.now() - days * 86400_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

// SDIO uses YYYY-MMM-DD (e.g. 2026-MAY-30) in some path segments. Annoying.
const MONTHS_3 = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
function isoToSdio(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return `${y}-${MONTHS_3[m - 1]}-${String(d).padStart(2, "0")}`;
}

async function main() {
  const today = isoDaysAgo(0);
  const yesterday = isoDaysAgo(1);
  const lastWeek = isoDaysAgo(7);
  const lastMonth = isoDaysAgo(30);
  const season = new Date().getUTCFullYear(); // current year; SDIO seasons line up with calendar year for MLB

  console.log(`Probing SportsDataIO MLB API`);
  console.log(`Today=${today} yesterday=${yesterday} season=${season}`);

  // ── 1. Transactions ──────────────────────────────────────────────────
  // Original probe returned 404. Retry against current dates, and try the
  // alternate paths that exist in SDIO docs.
  summarize(
    `Transactions/${isoToSdio(yesterday)}`,
    await probe(`/stats/json/Transactions/${isoToSdio(yesterday)}`),
  );
  summarize(
    `Transactions/${isoToSdio(lastWeek)}`,
    await probe(`/stats/json/Transactions/${isoToSdio(lastWeek)}`),
  );
  summarize(
    `TransactionsBySeason/${season}`,
    await probe(`/stats/json/TransactionsBySeason/${season}`),
  );

  // ── 2. News (the only other transactions-shaped feed in SDIO) ────────
  summarize(`News`, await probe(`/scores/json/News`));
  summarize(
    `NewsByDate/${isoToSdio(yesterday)}`,
    await probe(`/scores/json/NewsByDate/${isoToSdio(yesterday)}`),
  );

  // ── 3. PlayerSeasonStats — verify pitcher W-L/ERA carry mid-season ───
  // This is the key cross-ref the issue called out: probable pitchers from
  // GamesByDate carry only IDs, so we need PlayerSeasonStats to hydrate
  // W-L/ERA for the rotation lines.
  summarize(
    `PlayerSeasonStats/${season} (full league)`,
    await probe(`/stats/json/PlayerSeasonStats/${season}`),
  );

  // ── 4. GamesByDate — confirm probable pitcher IDs are present today ──
  summarize(
    `GamesByDate/${isoToSdio(today)}`,
    await probe(`/scores/json/GamesByDate/${isoToSdio(today)}`),
  );

  // ── 5. Trial scope — try a date well in the past to see if free tier
  // is locked to current season only.
  summarize(
    `GamesByDate/${isoToSdio(lastMonth)} (one month back)`,
    await probe(`/scores/json/GamesByDate/${isoToSdio(lastMonth)}`),
  );

  console.log(`\n── done.`);
}

main().catch((e) => {
  console.error(`probe failed: ${(e as Error).message}`);
  process.exit(1);
});

export {};
