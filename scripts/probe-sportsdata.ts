// Probe SportsDataIO MLB to see what schema we'd actually get.
// Free trial returns scrambled values but real schema, which is what we want.
// Run: npx tsx --env-file=.env.local scripts/probe-sportsdata.ts

const KEY = process.env.SPORTSDATA_API_KEY;
if (!KEY) {
  console.error("Missing SPORTSDATA_API_KEY");
  process.exit(1);
}

// SportsDataIO MLB API base
const BASE = "https://api.sportsdata.io/v3/mlb";

async function get(path: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Ocp-Apim-Subscription-Key": KEY! },
  });
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: text.slice(0, 500) };
  }
}

function section(title: string) {
  console.log(`\n━━━ ${title} ${"━".repeat(Math.max(0, 70 - title.length))}`);
}

function keysOf(obj: unknown, depth = 1, prefix = ""): string[] {
  if (!obj || typeof obj !== "object") return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    out.push(path);
    if (depth > 1 && v && typeof v === "object" && !Array.isArray(v)) {
      out.push(...keysOf(v, depth - 1, path));
    }
  }
  return out;
}

async function probe() {
  // First: try multiple auth + path variants on a tiny endpoint
  section("AUTH SANITY — /scores/json/CurrentSeason");
  // Try header
  let r = await get("/scores/json/CurrentSeason");
  console.log(`header auth: status=${r.status} body=${JSON.stringify(r.body).slice(0, 300)}`);
  // Try query-string variant
  const qsRes = await fetch(`${BASE}/scores/json/CurrentSeason?key=${KEY}`);
  console.log(`query auth: status=${qsRes.status} body=${(await qsRes.text()).slice(0, 300)}`);
  // Try with /api prefix
  const apiRes = await fetch(`https://api.sportsdata.io/api/mlb/scores/json/CurrentSeason`, {
    headers: { "Ocp-Apim-Subscription-Key": KEY! },
  });
  console.log(`/api prefix: status=${apiRes.status} body=${(await apiRes.text()).slice(0, 300)}`);

  section("GAMES BY DATE — find a working date");
  let games: any = null;
  let date = "";
  for (const d of ["2026-MAY-17", "2026-MAY-18", "2026-MAY-16", "2026-MAY-15"]) {
    const r = await get(`/scores/json/GamesByDate/${d}`);
    console.log(`  ${d}: status=${r.status} count=${Array.isArray(r.body) ? r.body.length : "err"}`);
    if (Array.isArray(r.body) && r.body.length) {
      games = r;
      date = d;
      break;
    }
  }
  if (!games) {
    console.log("No working date found, exiting after schema-only checks");
    return;
  }
  console.log(`→ using ${date}`);

  section("GAMES BY DATE detail");
  console.log(`status=${games.status}  results=${Array.isArray(games.body) ? games.body.length : "n/a"}`);
  if (Array.isArray(games.body) && games.body[0]) {
    console.log("\nGame top-level keys:");
    console.log("  " + keysOf(games.body[0]).join("\n  "));
    console.log("\nFull first game sample:");
    console.log(JSON.stringify(games.body[0], null, 2));
  }

  // Pull GameID from first game for box-score lookup
  const gameId =
    Array.isArray(games.body) && games.body[0]?.GameID
      ? games.body[0].GameID
      : null;
  console.log(`\n→ using GameID=${gameId} for box-score probes`);

  section("BOX SCORE for one game (per-player lines?)");
  if (gameId) {
    const box = await get(`/stats/json/BoxScore/${gameId}`);
    console.log(`status=${box.status}`);
    if (box.body) {
      console.log("\nBox top-level keys:");
      console.log("  " + keysOf(box.body).join("\n  "));

      const playerGames = (box.body as any).PlayerGames as any[] | undefined;
      console.log(`\nPlayerGames length: ${playerGames?.length}`);
      if (playerGames?.length) {
        console.log("\nFirst PlayerGame (full):");
        console.log(JSON.stringify(playerGames[0], null, 2));
        console.log("\nAll PlayerGame field names:");
        console.log("  " + Object.keys(playerGames[0]).join("\n  "));
      }
    }
  }

  section("STANDINGS (W-L, GB, division, WC?)");
  const standings = await get(`/scores/json/Standings/2024`);
  if (Array.isArray(standings.body) && standings.body[0]) {
    console.log("first team full record:");
    console.log(JSON.stringify(standings.body[0], null, 2));
  }

  section("LEAGUE LEADERS endpoint exists?");
  // SportsDataIO uses /stats/json/LeagueLeaders/{season}/{column}
  const leaders = await get(`/stats/json/LeagueLeaders/2024/HomeRuns`);
  console.log(`status=${leaders.status}`);
  if (Array.isArray(leaders.body)) {
    console.log(`leaders count: ${leaders.body.length}`);
    if (leaders.body[0]) {
      console.log("first leader sample:");
      console.log(JSON.stringify(leaders.body[0], null, 2).slice(0, 800));
    }
  } else {
    console.log(JSON.stringify(leaders.body, null, 2).slice(0, 300));
  }

  section("PLAY-BY-PLAY for one game?");
  if (gameId) {
    const pbp = await get(`/pbp/json/PlayByPlay/${gameId}`);
    console.log(`status=${pbp.status}`);
    if (pbp.body) {
      console.log("PBP top-level keys:");
      console.log("  " + keysOf(pbp.body).join("\n  "));
      const plays = (pbp.body as any).Plays as any[] | undefined;
      if (plays?.length) {
        console.log(`\nPlays array length: ${plays.length}`);
        console.log("First play sample:");
        console.log(JSON.stringify(plays[0], null, 2).slice(0, 800));
      }
    }
  }

  section("TRANSACTIONS endpoint?");
  // SportsDataIO doesn't have a direct daily transactions endpoint — they have
  // /stats/json/News for headlines. Worth probing.
  const news = await get(`/stats/json/NewsByDate/${date}`);
  console.log(`news status=${news.status}  count=${Array.isArray(news.body) ? news.body.length : 0}`);
  if (Array.isArray(news.body) && news.body[0]) {
    console.log("first news sample:");
    console.log(JSON.stringify(news.body[0], null, 2).slice(0, 400));
  }

  section("PROBABLE PITCHERS via games schedule");
  // Check if upcoming games include probable pitchers — re-look at first game
  if (Array.isArray(games.body) && games.body[0]) {
    const g = games.body[0];
    console.log("HomeStartingPitcher:", g.HomeStartingPitcher, "id:", g.HomeStartingPitcherID);
    console.log("AwayStartingPitcher:", g.AwayStartingPitcher, "id:", g.AwayStartingPitcherID);
  }
}

probe().catch((e) => {
  console.error("probe failed:", e);
  process.exit(1);
});
