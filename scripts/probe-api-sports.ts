// Probe API-Sports / API-Baseball — free tier allows current date ±1 day.
// Run: npx tsx --env-file=.env.local scripts/probe-api-sports.ts

const KEY = process.env["API-SPORTS_API_KEY"];
if (!KEY) {
  console.error("Missing API-SPORTS_API_KEY in .env.local");
  process.exit(1);
}

const BASE = "https://v1.baseball.api-sports.io";
const HEADERS = { "x-apisports-key": KEY };
const MLB = 1;

async function get(path: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}${path}`, { headers: HEADERS });
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

async function probe() {
  // Yesterday is 2026-05-17 (system date 2026-05-18). Both 2026 and 2024 season ids — try both.
  section("GAMES yesterday (2026-05-17)");
  for (const season of [2026, 2024]) {
    const r = await get(`/games?league=${MLB}&season=${season}&date=2026-05-17`);
    console.log(`season=${season}: results=${r.body?.results} errors=${JSON.stringify(r.body?.errors)}`);
    const game = r.body?.response?.[0];
    if (game) {
      console.log("FULL GAME SHAPE:");
      console.log(JSON.stringify(game, null, 2));
      break;
    }
  }

  // Standings (uses season; should work for 2024)
  section("STANDINGS (season=2024)");
  const standings = await get(`/standings?league=${MLB}&season=2024`);
  const tier = standings.body?.response?.[0]?.[0];
  console.log("first team in standings:");
  console.log(JSON.stringify(tier, null, 2));

  // Standings stages (division/wildcard splits?)
  section("STANDINGS/STAGES (season=2024)");
  const stages = await get(`/standings/stages?league=${MLB}&season=2024`);
  console.log(JSON.stringify(stages.body, null, 2).slice(0, 600));

  // Try per-game endpoints with whatever game id we got
  section("GAMES/STATISTICS — does this endpoint exist?");
  const stats = await get(`/games/statistics?league=${MLB}&season=2024`);
  console.log(`status=${stats.status}  errors=${JSON.stringify(stats.body?.errors)}`);
  console.log(JSON.stringify(stats.body, null, 2).slice(0, 600));

  // Try players endpoint
  section("PLAYERS endpoint");
  const players = await get(`/players?league=${MLB}&season=2024&search=judge`);
  console.log(`status=${players.status}  errors=${JSON.stringify(players.body?.errors)}`);
  console.log(JSON.stringify(players.body, null, 2).slice(0, 1500));

  // Status — confirm quota
  section("STATUS / quota left");
  const status = await get("/status");
  console.log(JSON.stringify((status.body as any)?.response?.requests, null, 2));
}

probe().catch((e) => {
  console.error("probe failed:", e);
  process.exit(1);
});
