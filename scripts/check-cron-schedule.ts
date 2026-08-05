// Guardrail: email SEND crons must land in distinct time slots so no two big
// sends' delivery bursts overlap (each send makes providers prefetch the open
// pixel + tracked links; overlapping sends stack the Supabase/edge spike). As
// sports are added, run this to confirm the new send didn't collide with an
// existing one. Prints the send-window schedule and exits non-zero on a clash.
//
//   npx tsx scripts/check-cron-schedule.ts
//
// Wire into CI (or a pre-push hook) to make the guardrail automatic.

import { readFileSync } from "node:fs";
import { join } from "node:path";

type Cron = { path: string; schedule: string };

function parseSlot(schedule: string): { minute: string; hour: string } {
  const [minute, hour] = schedule.split(/\s+/);
  return { minute: minute ?? "?", hour: hour ?? "?" };
}

function label(path: string): { type: string; sport: string } {
  const type = path.match(/\/api\/cron\/([a-z-]+)/)?.[1] ?? path;
  const sport = path.match(/sport=([a-z]+)/)?.[1] ?? "-";
  return { type, sport };
}

function main() {
  const vercel = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf-8")) as {
    crons: Cron[];
  };
  // Every cron that actually fans out email to subscribers.
  const sendCrons = vercel.crons.filter((c) => /\/api\/cron\/send-(email|team-email|conference-email|predictions-email)/.test(c.path));

  const bySlot = new Map<string, Cron[]>();
  for (const c of sendCrons) {
    const { minute, hour } = parseSlot(c.schedule);
    const key = `${hour}:${minute}`;
    (bySlot.get(key) ?? bySlot.set(key, []).get(key)!).push(c);
  }

  // Print the schedule, sorted by UTC time.
  const rows = sendCrons
    .map((c) => {
      const { minute, hour } = parseSlot(c.schedule);
      const { type, sport } = label(c.path);
      return { sortKey: Number(hour) * 60 + Number(minute), time: `${hour.padStart(2, "0")}:${minute.padStart(2, "0")} UTC`, type, sport };
    })
    .sort((a, b) => a.sortKey - b.sortKey);
  console.log("Email send schedule (UTC):");
  for (const r of rows) console.log(`  ${r.time}  ${r.sport.padEnd(6)} ${r.type}`);

  const clashes = [...bySlot.entries()].filter(([, list]) => list.length > 1);
  if (clashes.length > 0) {
    console.error("\n✘ Send-cron time collisions (would stack delivery bursts):");
    for (const [slot, list] of clashes) {
      console.error(`  ${slot} — ${list.map((c) => label(c.path).type + ":" + label(c.path).sport).join(", ")}`);
    }
    console.error("\nGive each send its own minute so bursts don't overlap.");
    process.exit(1);
  }
  console.log(`\n✓ ${sendCrons.length} send crons, all in distinct time slots.`);
}

main();
