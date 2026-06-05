// SportsDataIO probe for the lib/mlb.ts → lib/sportsdata-mlb.ts migration.
// Targets the two parsers in lib/mlb.ts whose SDIO replacements have not yet
// been verified against a live response: Transactions (404 in the original
// issue-#28 probe) and per-player game log (used by player pages).
//
// Per-position fielding splits are a known hard gap — SDIO returns one row
// per player-season with one Position field, no breakdown — and require a
// product decision rather than a probe.
//
// Run:
//   npx tsx --env-file=.env.local scripts/probe-sportsdata-migration.ts
//
// Env: SPORTSDATAIO_API_KEY must be set in .env.local.

const KEY = process.env.SPORTSDATAIO_API_KEY;
if (!KEY) {
  console.error("SPORTSDATAIO_API_KEY not set in .env.local");
  process.exit(1);
}

const BASE = "https://api.sportsdata.io/v3/mlb";

type ProbeResult = {
  url: string;
  status: number;
  headers: Record<string, string>;
  body: unknown;
  bodyError?: string;
};

const HEADERS_OF_INTEREST = [
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
  "content-type",
];

async function probe(path: string): Promise<ProbeResult> {
  const url = `${BASE}${path}${path.includes("?") ? "&" : "?"}key=${KEY}`;
  const res = await fetch(url);
  const headers: Record<string, string> = {};
  for (const h of HEADERS_OF_INTEREST) {
    const v = res.headers.get(h);
    if (v) headers[h] = v;
  }
  const text = await res.text();
  let body: unknown = null;
  let bodyError: string | undefined;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch (e) {
      bodyError = (e as Error).message;
      body = text.slice(0, 300);
    }
  }
  return { url: url.replace(/key=[^&]+/, "key=***"), status: res.status, headers, body, bodyError };
}

function summarize(label: string, r: ProbeResult): void {
  console.log(`\n── ${label} ───────────────────────────────────────`);
  console.log(`GET ${r.url}`);
  console.log(`HTTP ${r.status}`);
  for (const [k, v] of Object.entries(r.headers)) console.log(`  ${k}: ${v}`);
  if (r.bodyError) {
    console.log(`body parse error: ${r.bodyError}`);
    console.log(`body sample: ${r.body}`);
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
        console.log(`first item:`);
        console.log(JSON.stringify(first, null, 2).split("\n").slice(0, 60).join("\n"));
      }
    }
  } else if (typeof r.body === "object") {
    console.log(`object keys: ${Object.keys(r.body as object).join(", ")}`);
    console.log(JSON.stringify(r.body, null, 2).split("\n").slice(0, 40).join("\n"));
  } else {
    console.log(`body: ${JSON.stringify(r.body).slice(0, 300)}`);
  }
}

const MONTHS_3 = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
function isoDaysAgo(days: number): string {
  const d = new Date(Date.now() - days * 86400_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}
function isoToSdio(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return `${y}-${MONTHS_3[m - 1]}-${String(d).padStart(2, "0")}`;
}

async function main() {
  const yesterday = isoDaysAgo(1);
  const weekAgo = isoDaysAgo(7);
  const season = new Date().getUTCFullYear();
  console.log(`SPORTSDATAIO migration probe — season=${season} yesterday=${yesterday} weekAgo=${weekAgo}`);

  // ── 1. Transactions ──────────────────────────────────────────────────
  summarize(
    `Transactions/${isoToSdio(yesterday)}`,
    await probe(`/stats/json/Transactions/${isoToSdio(yesterday)}`),
  );
  summarize(
    `Transactions/${isoToSdio(weekAgo)}`,
    await probe(`/stats/json/Transactions/${isoToSdio(weekAgo)}`),
  );
  summarize(
    `TransactionsBySeason/${season}`,
    await probe(`/stats/json/TransactionsBySeason/${season}`),
  );

  // ── 2. Discover a real PlayerID from yesterday's box scores before
  // testing per-player endpoints — the previously-hardcoded Judge ID
  // returned empty, which could be a stale ID or a tier-gated endpoint.
  const gamesRes = await probe(`/scores/json/GamesByDate/${isoToSdio(yesterday)}`);
  let livePlayerID: number | null = null;
  let livePlayerName = "";
  if (Array.isArray(gamesRes.body) && gamesRes.body.length > 0) {
    const games = gamesRes.body as Array<Record<string, unknown>>;
    const game = games.find((g) => typeof g.GameID === "number") as Record<string, unknown> | undefined;
    if (game?.GameID) {
      const box = await probe(`/stats/json/BoxScore/${game.GameID}`);
      const body = box.body as { PlayerGames?: Array<{ PlayerID?: number; Name?: string }> } | null;
      const players = body?.PlayerGames ?? [];
      const first = players.find((p) => typeof p.PlayerID === "number");
      if (first) {
        livePlayerID = first.PlayerID ?? null;
        livePlayerName = first.Name ?? "";
      }
    }
  }
  console.log(`\nlivePlayerID discovered: ${livePlayerID} (${livePlayerName})`);

  if (livePlayerID != null) {
    summarize(
      `PlayerGameStatsBySeason/${season}/${livePlayerID}/all (live ID)`,
      await probe(`/stats/json/PlayerGameStatsBySeason/${season}/${livePlayerID}/all`),
    );
    summarize(
      `Player/${livePlayerID} (live ID)`,
      await probe(`/scores/json/Player/${livePlayerID}`),
    );
  } else {
    console.log("Could not derive a live PlayerID — skipping per-player probes.");
  }

  // ── 3. Try the bulk "all players" endpoint — covers both per-player
  // profile (we just filter the result) and avoids a per-player tier gate.
  summarize(`Players (bulk)`, await probe(`/scores/json/Players`));

  // ── 4. Player game stats by date — alternate path that may be on the
  // same tier as BoxScore/PlayByPlay (which we know works).
  summarize(
    `PlayerGameStatsByDate/${isoToSdio(yesterday)}`,
    await probe(`/stats/json/PlayerGameStatsByDate/${isoToSdio(yesterday)}`),
  );

  console.log(`\n── done.`);
}

main().catch((e) => {
  console.error(`probe failed: ${(e as Error).message}`);
  process.exit(1);
});

export {};
