// Smoke-test the Stat Sharks picker end-to-end:
//   1. show today's stat from the rotation
//   2. run a simulated 12-round game using the picker
//   3. print each pair + the "correct" side so Jeff can sanity-check
//      the difficulty curve and the pool shape
//
// Server-only module guard: `picker.ts` is marked "server-only" because
// it pulls from supabaseAdmin. Scripts run under tsx in Node, so the
// "server-only" sentinel is a no-op for us — fine.

import {
  STATS,
  ROTATION,
  statForDate,
  formatStatValue,
  gapForRound,
} from "../lib/games/statsharks/stats";
import {
  pickStatSharksPair,
  type StatSharksCard,
} from "../lib/games/statsharks/picker";

function fmtCard(stat: ReturnType<typeof statForDate>, c: StatSharksCard): string {
  const team = c.team_abbr ?? "—";
  return `${c.player_name} (${team}, ${c.season}) — ${formatStatValue(stat, c.statValue)}`;
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const stat = statForDate(today);
  console.log(`=== Today (${today}) ===`);
  console.log(`Stat: ${stat.key} — ${stat.label}`);
  console.log(`Side: ${stat.side}, direction: ${stat.direction}`);
  console.log(`Loose/tight gap: ${stat.loosestGap}× / ${stat.tightestGap}×`);
  console.log();

  console.log(`Rotation order (17-day cycle):`);
  for (const k of ROTATION) {
    const s = STATS[k];
    console.log(`  ${k.padEnd(4)} (${s.side.padEnd(7)}, ${s.direction})  ${s.prompt}`);
  }
  console.log();

  console.log(`=== Simulated run (12 rounds, today's stat) ===`);
  const used = new Set<number>();
  for (let round = 0; round < 12; round++) {
    const pair = await pickStatSharksPair({
      statKey: stat.key,
      round,
      usedPlayerSeasonIds: used,
    });
    if (!pair) {
      console.log(`Round ${round}: pool exhausted`);
      break;
    }
    const ratio = (() => {
      const lo = Math.min(pair.left.statValue, pair.right.statValue);
      const hi = Math.max(pair.left.statValue, pair.right.statValue);
      if (lo <= 0) return Infinity;
      return hi / lo;
    })();
    const target = gapForRound(stat, round);
    console.log(`R${String(round).padStart(2)} target=${target.toFixed(2)}× actual=${ratio === Infinity ? "∞" : ratio.toFixed(2) + "×"} correct=${pair.correct}`);
    console.log(`     L: ${fmtCard(stat, pair.left)}`);
    console.log(`     R: ${fmtCard(stat, pair.right)}`);
    used.add(pair.left.id);
    used.add(pair.right.id);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
