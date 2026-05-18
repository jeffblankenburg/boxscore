// Targeted follow-up: standings, season player stats (leaders), transactions.
// Run: npx tsx --env-file=.env.local scripts/probe-sportsdata2.ts

const KEY = process.env.SPORTSDATA_API_KEY!;
const BASE = "https://api.sportsdata.io/v3/mlb";

async function get(path: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Ocp-Apim-Subscription-Key": KEY },
  });
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: text.slice(0, 500) };
  }
}

function section(t: string) {
  console.log(`\n━━━ ${t} ${"━".repeat(Math.max(0, 70 - t.length))}`);
}

async function run() {
  section("STANDINGS 2026");
  const standings = await get(`/scores/json/Standings/2026`);
  console.log(`status=${standings.status}`);
  if (Array.isArray(standings.body)) {
    console.log(`teams: ${standings.body.length}`);
    console.log("\nfirst team full record:");
    console.log(JSON.stringify(standings.body[0], null, 2));
    // Show all unique field names across teams to be sure
    const allKeys = new Set<string>();
    standings.body.forEach((t: any) => Object.keys(t).forEach((k) => allKeys.add(k)));
    console.log("\nall fields:", Array.from(allKeys).join(", "));
  } else {
    console.log(JSON.stringify(standings.body, null, 2).slice(0, 400));
  }

  section("PLAYER SEASON STATS — substitute for leaders");
  // /stats/json/PlayerSeasonStats/{season}
  const pss = await get(`/stats/json/PlayerSeasonStats/2026`);
  console.log(`status=${pss.status}`);
  if (Array.isArray(pss.body)) {
    console.log(`players: ${pss.body.length}`);
    console.log("\nfirst player full record (look for HR/AVG/ERA/K fields):");
    console.log(JSON.stringify(pss.body[0], null, 2).slice(0, 2500));
  } else {
    console.log(JSON.stringify(pss.body, null, 2).slice(0, 400));
  }

  section("TRANSACTIONS — try several paths");
  for (const p of [
    "/scores/json/Transactions/2026-MAY-17",
    "/stats/json/Transactions/2026-MAY-17",
    "/scores/json/NewsByDate/2026-MAY-17",
    "/stats/json/News",
  ]) {
    const r = await get(p);
    const len = Array.isArray(r.body) ? r.body.length : "n/a";
    console.log(`  ${p}: status=${r.status} count=${len}`);
    if (Array.isArray(r.body) && r.body[0]) {
      console.log("    first item:", JSON.stringify(r.body[0]).slice(0, 300));
    }
  }

  section("TEAM SCHEDULE — upcoming week");
  // /scores/json/SchedulesByTeam/{season}/{team}
  const sched = await get(`/scores/json/SchedulesByTeam/2026/NYY`);
  console.log(`status=${sched.status}`);
  if (Array.isArray(sched.body)) {
    console.log(`games: ${sched.body.length}`);
    console.log("first game keys:", Object.keys(sched.body[0] ?? {}).join(", "));
  }

  section("ACTIVE PLAYERS BY TEAM (roster)");
  const roster = await get(`/scores/json/Players/NYY`);
  console.log(`status=${roster.status}`);
  if (Array.isArray(roster.body)) {
    console.log(`players: ${roster.body.length}`);
    console.log("\nfirst roster entry fields:");
    console.log(JSON.stringify(roster.body[0], null, 2).slice(0, 1500));
  }
}

run().catch((e) => {
  console.error("failed:", e);
  process.exit(1);
});
