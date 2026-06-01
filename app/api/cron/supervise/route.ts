// Supervisor cron. Catches two cron-level failure modes that the per-route
// alert email can't catch on its own:
//   1. Vercel never invoked a scheduled cron at all (no cron_runs row exists).
//   2. The route was invoked but the function died mid-execution without
//      reaching finishCronRun — leaves the row stuck status="running" forever.
//      Most common cause: hitting Vercel's maxDuration ceiling; the runtime
//      kills the process without giving cleanup blocks a chance to run.
//
// Runs once per morning, after every other scheduled cron has had a chance to
// complete. For each (sport, route) pair we know is scheduled, queries
// cron_runs for today's digest date. If there's no ok row, the supervisor
// classifies the most recent attempt and invokes the route to fill the gap.
// Stale-running rows are marked failed before re-invoking so the dashboard
// reflects reality immediately.
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

// A "running" row older than this is presumed dead. send-email at 5k+
// subscribers takes ~5 min when healthy; send-team-email touches 30 teams and
// can run longer. 30 min is conservative enough to never false-positive a
// legitimately in-flight run, while still catching the maxDuration-kill case
// that surfaced 2026-06-01 (function died at ~5 min, sat "running" for hours).
const STALE_THRESHOLD_MINUTES = 30;

function authorize(req: Request): boolean {
  if (process.env.NODE_ENV === "development") return true;
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

// Why was this route on the heal list? Surface this in the alert email so the
// admin can tell at a glance which failure mode hit:
//   never_ran          — Vercel didn't invoke the cron at all
//   previously_failed  — route ran, threw an error, was marked failed
//   stale_running      — route ran, died without finishing (most often
//                        maxDuration kill); row stuck "running" past threshold
// The three look similar from cell-color-alone on the dashboard; the email
// needs to spell them out.
type MissCategory = "never_ran" | "previously_failed" | "stale_running";

type HealResult = {
  sport: string;
  route: string;
  category: MissCategory;
  ok: boolean;
  error?: string;
  skipped?: string;
};

// Mark a stale row as failed before re-invoking, so the dashboard reflects
// reality and the cron history is honest. Best-effort: a failure here MUST
// NOT block the heal pass — leaving a zombie row visible is far less bad
// than skipping the heal.
async function markStaleAsFailed(rowId: string, ageMinutes: number): Promise<void> {
  try {
    const { error } = await supabaseAdmin()
      .from("cron_runs")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error: `Marked failed by supervisor: row stuck status=running for ${Math.round(ageMinutes)} min (>${STALE_THRESHOLD_MINUTES} min threshold). Function likely terminated by Vercel without reaching finishCronRun — typically maxDuration kill.`,
      })
      .eq("id", rowId);
    if (error) console.warn(`supervise: mark-stale-failed for ${rowId} failed: ${error.message}`);
  } catch (e) {
    console.warn(`supervise: mark-stale-failed for ${rowId} threw: ${(e as Error).message}`);
  }
}

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
    type Row = {
      id: string;
      route: string;
      sport: string | null;
      status: string;
      started_at: string;
    };
    const { data, error } = await db
      .from("cron_runs")
      .select("id, route, sport, status, started_at")
      .eq("date", date)
      .order("started_at", { ascending: true });
    if (error) throw new Error(`fetch cron_runs: ${error.message}`);

    // Group by (sport, route). For each pair we need to know:
    //   - whether ANY run reached ok (then handled, no heal)
    //   - the most recent non-ok row's classification (failed / running /
    //     stale-running) so the heal call can carry the right category and
    //     stash the row id for mark-stale-failed.
    type GroupState = {
      hasOk: boolean;
      latestNonOk: Row | null;
    };
    const grouped = new Map<string, GroupState>();
    for (const r of (data ?? []) as Row[]) {
      if (!r.sport) continue;
      const key = `${r.sport}::${r.route}`;
      const g = grouped.get(key) ?? { hasOk: false, latestNonOk: null };
      if (r.status === "ok") {
        g.hasOk = true;
      } else {
        // started_at is asc; later iterations overwrite earlier, so latest wins
        g.latestNonOk = r;
      }
      grouped.set(key, g);
    }

    const nowMs = Date.now();
    type MissingItem = Supervised & {
      category: MissCategory;
      staleRowId?: string;
      staleAgeMinutes?: number;
    };
    const missing: MissingItem[] = [];

    for (const s of SUPERVISED) {
      const key = `${s.sport}::${s.route}`;
      const g = grouped.get(key);
      // No row at all → Vercel never invoked.
      if (!g) {
        missing.push({ ...s, category: "never_ran" });
        continue;
      }
      // Some row reached ok at some point today → handled, even if there's
      // also a stuck zombie row from an earlier attempt (today's case).
      if (g.hasOk) continue;
      // Otherwise look at the most-recent non-ok row.
      const row = g.latestNonOk!;
      if (row.status === "failed") {
        missing.push({ ...s, category: "previously_failed" });
      } else if (row.status === "running") {
        const ageMinutes = (nowMs - new Date(row.started_at).getTime()) / 60_000;
        if (ageMinutes >= STALE_THRESHOLD_MINUTES) {
          missing.push({
            ...s,
            category: "stale_running",
            staleRowId: row.id,
            staleAgeMinutes: ageMinutes,
          });
        }
        // Fresh "running" → still in flight, leave it alone.
      }
    }

    const originalNeverRan = missing.filter((m) => m.category === "never_ran").length;
    const originalFailed = missing.filter((m) => m.category === "previously_failed").length;
    const originalStale = missing.filter((m) => m.category === "stale_running").length;

    if (missing.length === 0) {
      const result = {
        date, missing: 0, healed: 0, still_missing: 0,
        original: { never_ran: 0, previously_failed: 0, stale_running: 0 },
      };
      await finishCronRun(runId, { status: "ok", result });
      return NextResponse.json({ ok: true, ...result });
    }

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
    for (const item of missing) {
      const { sport, route, category } = item;

      // Cleanup pass for stale-running rows: mark them failed BEFORE the heal
      // attempt so the dashboard is honest even if the heal itself fails.
      if (category === "stale_running" && item.staleRowId) {
        await markStaleAsFailed(item.staleRowId, item.staleAgeMinutes ?? 0);
      }

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
      original: {
        never_ran: originalNeverRan,
        previously_failed: originalFailed,
        stale_running: originalStale,
      },
      details: healed,
    };

    if (failCount > 0) {
      // Group still-failed items by their original category so the alert
      // email's <pre> block shows each failure mode as a separate section.
      const stillFailed = healed.filter((h) => !h.ok);
      const stillNeverRan = stillFailed.filter((h) => h.category === "never_ran");
      const stillPrevFailed = stillFailed.filter((h) => h.category === "previously_failed");
      const stillStale = stillFailed.filter((h) => h.category === "stale_running");
      const lines: string[] = [
        `Supervisor healed ${okCount}/${missing.length} of today's missing runs.`,
        `Original misses: ${originalNeverRan} never ran (Vercel didn't invoke), ${originalFailed} previously failed (ran and errored), ${originalStale} stale running (died mid-execution past ${STALE_THRESHOLD_MINUTES}-min threshold).`,
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
        lines.push(``);
      }
      if (stillStale.length > 0) {
        lines.push(`Still missing — originally stale running (died mid-execution, marked failed by supervisor):`);
        for (const h of stillStale) {
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
