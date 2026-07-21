// Smoke test for the football canonical pipeline: fetch a real day from
// ESPN, run it through the adapter, and print a summary. No DB, no writes —
// this only exercises sources/espn.ts + adapters/from-espn.ts end to end so
// we can eyeball that the canonical bundle looks right before wiring crons.
//
//   npx tsx --env-file=.env.local scripts/football-espn-smoke.ts nfl 2025-09-07
//   npx tsx --env-file=.env.local scripts/football-espn-smoke.ts ncaaf 2025-09-06
//
// Defaults to nfl on a known-good 2025 Week 1 Sunday if no args given.

import { footballLeagueConfig, seasonForDate } from "../lib/sports/football/leagues";
import { fetchFootballRaw } from "../lib/sports/football/sources/espn";
import { adaptEspnFootball } from "../lib/sports/football/adapters/from-espn";
import type { FootballLeague } from "../lib/sports/football/types";

async function main() {
  const league = (process.argv[2] as FootballLeague) || "nfl";
  const date = process.argv[3] || "2025-09-07";
  if (league !== "nfl" && league !== "ncaaf") {
    throw new Error(`league must be nfl|ncaaf, got "${league}"`);
  }

  const cfg = footballLeagueConfig(league);
  const season = seasonForDate(date);
  console.log(`Fetching ${cfg.name} for ${date} (season ${season})…`);

  const raw = await fetchFootballRaw(cfg, date, season);
  const bundle = adaptEspnFootball(cfg, raw);

  console.log(`\n=== ${cfg.name} — ${bundle.date} ===`);
  console.log(`games: ${bundle.games.length} | boxes: ${bundle.boxScores.size} | ` +
    `next: ${bundle.nextGames.length} | rankings polls: ${bundle.rankings.length} | ` +
    `leaders: ${bundle.leaders.length} | standings groups: ${bundle.standings.length} | ` +
    `transactions: ${bundle.transactions.length}\n`);

  if (bundle.leaders.length) {
    console.log("--- leaders (top of each) ---");
    for (const b of bundle.leaders) {
      const top = b.entries[0];
      console.log(`  ${b.label}: ${top ? `${top.player.fullName} (${top.teamAbbr}) ${top.displayValue}` : "—"}`);
    }
    console.log();
  }
  if (bundle.nextGames.length) {
    console.log(`--- next matchups (first 3 of ${bundle.nextGames.length}) ---`);
    for (const g of bundle.nextGames.slice(0, 3)) {
      console.log(`  ${g.awayTeam.abbr} @ ${g.homeTeam.abbr}  ${g.startTime} [${g.statusDetail}]`);
    }
    console.log();
  }
  if (bundle.transactions.length) {
    console.log(`--- transactions (first 3 of ${bundle.transactions.length}) ---`);
    for (const t of bundle.transactions.slice(0, 3)) {
      console.log(`  ${t.date.slice(0, 10)} ${t.teamAbbr ?? ""}: ${t.description}`);
    }
    console.log();
  }

  for (const g of bundle.games) {
    const rank = (r: number | null | undefined) => (r ? `#${r} ` : "");
    const score = g.status === "scheduled"
      ? "(scheduled)"
      : `${g.awayScore}-${g.homeScore}`;
    console.log(
      `  ${rank(g.awayTeam.rank)}${g.awayTeam.abbr} @ ${rank(g.homeTeam.rank)}${g.homeTeam.abbr}  ` +
      `${score}  [${g.statusDetail}]${g.neutralSite ? " (neutral)" : ""}`,
    );
  }

  // Deep-dump the first completed box so the stat parsing is visible.
  const firstBox = [...bundle.boxScores.values()][0];
  if (firstBox) {
    console.log(`\n--- sample box (${firstBox.away.team.abbr} @ ${firstBox.home.team.abbr}) ---`);
    for (const side of [firstBox.away, firstBox.home]) {
      console.log(`\n${side.team.abbr}  ` +
        `yds ${side.totals.totalYards ?? "?"} | pass ${side.totals.passingYards ?? "?"} | ` +
        `rush ${side.totals.rushingYards ?? "?"} | TO ${side.totals.turnovers ?? "?"} | ` +
        `poss ${side.totals.possession ?? "?"}`);
      const qb = side.passing[0];
      if (qb) console.log(`  PASS ${qb.player.fullName}: ${qb.completions}/${qb.attempts}, ${qb.yards} yds, ${qb.touchdowns} TD, ${qb.interceptions} INT`);
      const rb = side.rushing[0];
      if (rb) console.log(`  RUSH ${rb.player.fullName}: ${rb.carries} car, ${rb.yards} yds, ${rb.touchdowns} TD`);
      const wr = side.receiving[0];
      if (wr) console.log(`  REC  ${wr.player.fullName}: ${wr.receptions} rec, ${wr.yards} yds, ${wr.touchdowns} TD`);
    }
    console.log(`\n  scoring plays: ${firstBox.scoringPlays.length} | drives: ${firstBox.drives.length} | ` +
      `venue: ${firstBox.venueName ?? "?"} | att: ${firstBox.attendance ?? "?"}`);
    const sp = firstBox.scoringPlays[0];
    if (sp) console.log(`  first score: [Q${sp.period} ${sp.clock}] ${sp.team.abbr} — ${sp.text} (${sp.awayScore}-${sp.homeScore})`);
  }

  if (bundle.rankings.length) {
    const top = bundle.rankings[0]!;
    console.log(`\n--- ${top.poll} (top 5) ---`);
    for (const e of top.entries.slice(0, 5)) {
      console.log(`  ${e.rank}. ${e.team.name} (${e.record ?? "?"})`);
    }
  }

  if (bundle.standings.length) {
    console.log(`\n--- standings groups ---`);
    for (const gr of bundle.standings) {
      console.log(`  ${gr.group}${gr.conference ? ` [${gr.conference}]` : ""}: ${gr.rows.length} teams` +
        (gr.rows[0] ? ` (top: ${gr.rows[0].team.abbr} ${gr.rows[0].wins}-${gr.rows[0].losses})` : ""));
    }
  }

  console.log("\n✓ smoke complete");
}

main().catch((e) => { console.error(e); process.exit(1); });
