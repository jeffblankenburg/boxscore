// Supervisor cron. Catches the "Vercel didn't invoke a scheduled cron at all"
// failure mode — which doesn't trip the existing failure-alert email because
// there's no failed run to alert on; there's nothing.
//
// Runs once per morning, after every other scheduled cron has had a chance to
// complete. For each (sport, route) pair we know is scheduled, queries
// cron_runs for today's digest date. If there's no ok-or-running row, the
// supervisor invokes the route to fill in the gap. Failures during the heal
// pass mark this run as "failed", which routes through the existing admin-
// notification email — so a missed cron escalates to an alert if it can't be
// recovered automatically.
//
// The SUPERVISED list mirrors vercel.json. Adding a new scheduled cron means
// updating both.

import { NextResponse } from "next/server";
import { yesterdayInET } from "@/lib/dates";
import { siteOrigin } from "@/lib/site";
import { startCronRun, finishCronRun } from "@/lib/cron-runs";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

type Supervised = { route: string; sport: string };

const SUPERVISED: ReadonlyArray<Supervised> = [
  { route: "generate",        sport: "mlb"  },
  { route: "generate",        sport: "nba"  },
  { route: "generate",        sport: "wnba" },
  { route: "send-email",      sport: "mlb"  },
  { route: "send-email",      sport: "nba"  },
  { route: "send-email",      sport: "wnba" },
  { route: "send-team-email", sport: "mlb"  },
  { route: "post-twitter",    sport: "mlb"  },
  { route: "post-bluesky",    sport: "mlb"  },
];

function authorize(req: Request): boolean {
  if (process.env.NODE_ENV === "development") return true;
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

// Why was this route on the heal list? Surface this in the alert email so a
// 6am admin can tell at a glance whether Vercel dropped the invocation
// ("never_ran") or the route ran and errored ("previously_failed"). The two
// look identical from the dashboard's red-cell-vs-grey-cell distinction;
// the email needs to spell it out.
type MissCategory = "never_ran" | "previously_failed";

type HealResult = {
  sport: string;
  route: string;
  category: MissCategory;
  ok: boolean;
  error?: string;
  skipped?: string;
};

export async function GET(req: Request) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const trigger = url.searchParams.get("trigger") === "manual" ? "manual" : "cron";
  const date = yesterdayInET();

  const runId = await startCronRun({ route: "supervise", date, trigger });

  try {
    const db = supabaseAdmin();
    type Row = { route: string; sport: string | null; status: string };
    const { data, error } = await db
      .from("cron_runs")
      .select("route, sport, status")
      .eq("date", date);
    if (error) throw new Error(`fetch cron_runs: ${error.message}`);

    // Set of (sport::route) that already finished ok or are still in flight.
    // Failed runs are intentionally NOT in this set — the supervisor's job is
    // to retry them. A run is identified per-route-per-sport for today's date.
    const handled = new Set<string>();
    const failedKeys = new Set<string>();
    for (const r of (data ?? []) as Row[]) {
      if (!r.sport) continue;
      const key = `${r.sport}::${r.route}`;
      if (r.status === "ok" || r.status === "running") {
        handled.add(key);
      } else if (r.status === "failed") {
        failedKeys.add(key);
      }
    }

    const missing: Array<Supervised & { category: MissCategory }> = SUPERVISED
      .filter((s) => !handled.has(`${s.sport}::${s.route}`))
      .map((s) => ({
        ...s,
        category: failedKeys.has(`${s.sport}::${s.route}`)
          ? "previously_failed"
          : "never_ran",
      }));

    if (missing.length === 0) {
      const result = {
        date, missing: 0, healed: 0, still_missing: 0,
        original: { never_ran: 0, previously_failed: 0 },
      };
      await finishCronRun(runId, { status: "ok", result });
      return NextResponse.json({ ok: true, ...result });
    }

    const originalNeverRan = missing.filter((m) => m.category === "never_ran").length;
    const originalFailed = missing.filter((m) => m.category === "previously_failed").length;

    const origin = await siteOrigin();
    const headers: HeadersInit = {};
    if (process.env.CRON_SECRET) {
      headers.Authorization = `Bearer ${process.env.CRON_SECRET}`;
    }

    // Iterate in SUPERVISED order — generate before send-email, before posts.
    // If generate fails for a sport during this pass, skip that sport's
    // downstream routes; healing send-email when there's no digest would just
    // fail again. The downstream rows stay "still missing" so the alert email
    // surfaces both the upstream failure and the cascade.
    const healed: HealResult[] = [];
    for (const { sport, route, category } of missing) {
      const upstreamFailed = (route === "send-email" || route === "send-team-email")
        && healed.some((h) => h.sport === sport && h.route === "generate" && !h.ok);
      if (upstreamFailed) {
        healed.push({ sport, route, category, ok: false, skipped: "generate failed during heal" });
        continue;
      }

      const params = new URLSearchParams({ date, sport });
      if (route === "generate") params.set("refetch", "true");
      try {
        const res = await fetch(`${origin}/api/cron/${route}?${params}`, { headers });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok || body.error) {
          healed.push({ sport, route, category, ok: false, error: body.error ?? `HTTP ${res.status}` });
        } else {
          healed.push({ sport, route, category, ok: true });
        }
      } catch (e) {
        healed.push({ sport, route, category, ok: false, error: (e as Error).message });
      }
    }

    const okCount = healed.filter((h) => h.ok).length;
    const failCount = healed.length - okCount;
    const result = {
      date,
      missing: missing.length,
      healed: okCount,
      still_missing: failCount,
      original: { never_ran: originalNeverRan, previously_failed: originalFailed },
      details: healed,
    };

    if (failCount > 0) {
      // Group still-failed items by their original category so the alert
      // email's <pre> block shows missed-vs-failed as separate sections.
      // Format:
      //   Healed 1/3 missing runs.
      //
      //   Originally missed (Vercel didn't invoke):
      //     - nba/generate (heal: ECONNRESET)
      //
      //   Originally failed (ran and errored):
      //     - mlb/send-email (heal: ECONNRESET)
      const stillFailed = healed.filter((h) => !h.ok);
      const stillNeverRan = stillFailed.filter((h) => h.category === "never_ran");
      const stillPrevFailed = stillFailed.filter((h) => h.category === "previously_failed");
      const lines: string[] = [
        `Supervisor healed ${okCount}/${missing.length} of today's missing runs.`,
        `Original misses: ${originalNeverRan} never ran (Vercel didn't invoke), ${originalFailed} previously failed (ran and errored).`,
        ``,
      ];
      if (stillNeverRan.length > 0) {
        lines.push(`Still missing — originally never invoked by Vercel:`);
        for (const h of stillNeverRan) {
          lines.push(`  - ${h.sport}/${h.route} (heal attempt: ${h.error ?? h.skipped ?? "unknown"})`);
        }
        lines.push(``);
      }
      if (stillPrevFailed.length > 0) {
        lines.push(`Still missing — originally failed (ran and errored):`);
        for (const h of stillPrevFailed) {
          lines.push(`  - ${h.sport}/${h.route} (heal attempt: ${h.error ?? h.skipped ?? "unknown"})`);
        }
      }
      await finishCronRun(runId, {
        status: "failed",
        error: lines.join("\n").trimEnd(),
        result,
      });
    } else {
      await finishCronRun(runId, { status: "ok", result });
    }

    return NextResponse.json({ ok: failCount === 0, ...result });
  } catch (e) {
    const msg = (e as Error).message;
    await finishCronRun(runId, { status: "failed", error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
