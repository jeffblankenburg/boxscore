// Coverage probe: for every parser in lib/mlb.ts, hit the SDIO endpoint we'd
// migrate to and record whether it succeeds, is tier-gated (401), missing
// (404), or returns empty. Output feeds the SDIO parity gap document.
//
// Run:
//   npx tsx --env-file=.env.local scripts/probe-sportsdata-coverage.ts

const KEY = process.env.SPORTSDATAIO_API_KEY;
if (!KEY) {
  console.error("SPORTSDATAIO_API_KEY not set in .env.local");
  process.exit(1);
}

const BASE = "https://api.sportsdata.io/v3/mlb";

type Result = {
  label: string;
  url: string;
  status: number;
  outcome: "OK" | "EMPTY" | "TIER_GATED" | "NOT_FOUND" | "ERROR";
  notes: string;
};

async function probe(label: string, path: string): Promise<Result> {
  const url = `${BASE}${path}${path.includes("?") ? "&" : "?"}key=${KEY}`;
  const safeUrl = url.replace(/key=[^&]+/, "key=***");
  try {
    const res = await fetch(url);
    const text = await res.text();
    let body: unknown = null;
    try { body = text.length > 0 ? JSON.parse(text) : null; } catch { body = text.slice(0, 200); }

    let outcome: Result["outcome"];
    let notes = "";
    if (res.status === 401) {
      outcome = "TIER_GATED";
      const desc = (body as { Description?: string } | null)?.Description ?? "";
      notes = desc.slice(0, 100);
    } else if (res.status === 404) {
      outcome = "NOT_FOUND";
      const msg = (body as { message?: string } | null)?.message ?? "";
      notes = msg.slice(0, 100);
    } else if (res.status >= 400) {
      outcome = "ERROR";
      notes = `HTTP ${res.status}`;
    } else if (Array.isArray(body)) {
      outcome = body.length === 0 ? "EMPTY" : "OK";
      notes = `array length ${body.length}` +
        (body.length > 0 && typeof body[0] === "object"
          ? ` — first item ${Object.keys(body[0] as object).length} fields`
          : "");
    } else if (body && typeof body === "object") {
      outcome = "OK";
      notes = `object — ${Object.keys(body as object).length} top-level keys`;
    } else {
      outcome = "OK";
      notes = `body type ${typeof body}`;
    }
    return { label, url: safeUrl, status: res.status, outcome, notes };
  } catch (e) {
    return { label, url: safeUrl, status: 0, outcome: "ERROR", notes: (e as Error).message };
  }
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
function isoDaysAgo(days: number): string {
  const d = new Date(Date.now() - days * 86400_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}
function isoToSdio(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return `${y}-${MONTHS[m - 1]}-${String(d).padStart(2, "0")}`;
}

async function main() {
  const yesterday = isoDaysAgo(1);
  const today = isoDaysAgo(0);
  const season = new Date().getUTCFullYear();
  const sdioYesterday = isoToSdio(yesterday);
  const sdioToday = isoToSdio(today);

  // Endpoints to probe, in the same order lib/mlb.ts presents its parsers.
  const probes: Array<{ libFn: string; sdioEndpoint: string; path: string }> = [
    { libFn: "getSchedule",                  sdioEndpoint: "GamesByDate",             path: `/scores/json/GamesByDate/${sdioYesterday}` },
    { libFn: "getSchedule (today)",          sdioEndpoint: "GamesByDate",             path: `/scores/json/GamesByDate/${sdioToday}` },
    { libFn: "fetchTeamsRaw",                sdioEndpoint: "teams",                    path: `/scores/json/teams` },
    { libFn: "fetchStandingsRaw",            sdioEndpoint: "Standings",                path: `/scores/json/Standings/${season}` },
    { libFn: "getBoxscore (sample)",         sdioEndpoint: "BoxScore",                 path: `/stats/json/BoxScore/SAMPLE_GAME_ID` }, // patched below
    { libFn: "getScoringPlays (sample)",     sdioEndpoint: "PlayByPlay",               path: `/pbp/json/PlayByPlay/SAMPLE_GAME_ID` }, // patched below
    { libFn: "getLeaders",                   sdioEndpoint: "PlayerSeasonStats",        path: `/stats/json/PlayerSeasonStats/${season}` },
    { libFn: "parsePersonWL",                sdioEndpoint: "PlayerSeasonStatsByPlayer",path: `/stats/json/PlayerSeasonStatsByPlayer/${season}/SAMPLE_PID` },
    { libFn: "getTeamRoster",                sdioEndpoint: "Players/{team}",           path: `/scores/json/Players/NYY` },
    { libFn: "getTeamRoster (alt)",          sdioEndpoint: "PlayersByActive/{team}",   path: `/scores/json/PlayersByActive/NYY` },
    { libFn: "getTeamRoster (alt2)",         sdioEndpoint: "DepthCharts",              path: `/scores/json/DepthCharts` },
    { libFn: "getTeamRoster (stats)",        sdioEndpoint: "PlayerSeasonStatsByTeam",  path: `/stats/json/PlayerSeasonStatsByTeam/${season}/NYY` },
    { libFn: "parsePerson",                  sdioEndpoint: "Player",                   path: `/scores/json/Player/SAMPLE_PID` },
    { libFn: "parsePerson (bulk)",           sdioEndpoint: "Players",                  path: `/scores/json/Players` },
    { libFn: "parsePerson (active bulk)",    sdioEndpoint: "PlayersActive",            path: `/scores/json/PlayersActive` },
    { libFn: "parseSplitsBundle.gameLog",    sdioEndpoint: "PlayerGameStatsBySeason",  path: `/stats/json/PlayerGameStatsBySeason/${season}/SAMPLE_PID/all` },
    { libFn: "parseSplitsBundle (by date)",  sdioEndpoint: "PlayerGameStatsByDate",    path: `/stats/json/PlayerGameStatsByDate/${sdioYesterday}` },
    { libFn: "parseTransactions",            sdioEndpoint: "Transactions",             path: `/stats/json/Transactions/${sdioYesterday}` },
    { libFn: "parseTransactions (bulk)",     sdioEndpoint: "TransactionsBySeason",     path: `/stats/json/TransactionsBySeason/${season}` },
    { libFn: "parseTransactions (news)",     sdioEndpoint: "News",                     path: `/scores/json/News` },
    { libFn: "parseFielding (per-position)", sdioEndpoint: "(no endpoint)",            path: `/stats/json/PlayerSeasonStats/${season}` }, // proxied — fielding is one row per player
  ];

  // Resolve sample IDs first by hitting GamesByDate and BoxScore.
  // Use TODAY — yesterday's endpoint is tier-gated on this key.
  let sampleGameId: number | null = null;
  let samplePlayerId: number | null = null;
  let samplePlayerName = "";
  const gamesUrl = `${BASE}/scores/json/GamesByDate/${sdioToday}?key=${KEY}`;
  const gamesRes = await fetch(gamesUrl);
  console.log(`[resolve] GamesByDate/${sdioToday} → HTTP ${gamesRes.status}`);
  if (gamesRes.ok) {
    const games = (await gamesRes.json()) as Array<Record<string, unknown>>;
    console.log(`[resolve]   games found: ${games.length}`);
    const game = games.find((g) => typeof g.GameID === "number");
    if (game) {
      sampleGameId = game.GameID as number;
      console.log(`[resolve]   sample GameID: ${sampleGameId}`);
      const boxUrl = `${BASE}/stats/json/BoxScore/${sampleGameId}?key=${KEY}`;
      const boxRes = await fetch(boxUrl);
      console.log(`[resolve] BoxScore/${sampleGameId} → HTTP ${boxRes.status}`);
      if (boxRes.ok) {
        const box = (await boxRes.json()) as { PlayerGames?: Array<{ PlayerID?: number; Name?: string }> };
        const first = (box.PlayerGames ?? []).find((p) => typeof p.PlayerID === "number");
        if (first) {
          samplePlayerId = first.PlayerID ?? null;
          samplePlayerName = first.Name ?? "";
          console.log(`[resolve]   sample PlayerID: ${samplePlayerId} (${samplePlayerName})`);
        }
      }
    }
  }

  const results: Result[] = [];
  for (const p of probes) {
    let path = p.path;
    if (path.includes("SAMPLE_GAME_ID")) {
      if (sampleGameId == null) {
        results.push({ label: `${p.libFn} → ${p.sdioEndpoint}`, url: path, status: 0, outcome: "ERROR", notes: "could not resolve sample GameID" });
        continue;
      }
      path = path.replace("SAMPLE_GAME_ID", String(sampleGameId));
    }
    if (path.includes("SAMPLE_PID")) {
      if (samplePlayerId == null) {
        results.push({ label: `${p.libFn} → ${p.sdioEndpoint}`, url: path, status: 0, outcome: "ERROR", notes: "could not resolve sample PlayerID" });
        continue;
      }
      path = path.replace("SAMPLE_PID", String(samplePlayerId));
    }
    const r = await probe(`${p.libFn} → ${p.sdioEndpoint}`, path);
    results.push(r);
  }

  // Print a compact table.
  console.log(`\n┌───────────────────────────────────────────────────────────────────────────────────────`);
  console.log(`│ COVERAGE MATRIX — SDIO key tier visibility`);
  console.log(`├───────────────────────────────────────────────────────────────────────────────────────`);
  for (const r of results) {
    const marker =
      r.outcome === "OK" ? "✓" :
      r.outcome === "EMPTY" ? "○" :
      r.outcome === "TIER_GATED" ? "✗" :
      r.outcome === "NOT_FOUND" ? "?" :
      "!";
    console.log(`│ ${marker} ${r.outcome.padEnd(11)} HTTP ${String(r.status).padEnd(4)} ${r.label}`);
    if (r.notes) console.log(`│              ${r.notes}`);
  }
  console.log(`└───────────────────────────────────────────────────────────────────────────────────────`);
  console.log(`\nLegend: ✓ accessible  ○ empty response  ✗ tier-gated (401)  ? not found (404)  ! error`);
  console.log(`Sample GameID: ${sampleGameId}, Sample PlayerID: ${samplePlayerId} (${samplePlayerName})`);
}

main().catch((e) => { console.error(e); process.exit(1); });

export {};
