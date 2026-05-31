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

type HealResult = {
  sport: string;
  route: string;
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
    for (const r of (data ?? []) as Row[]) {
      if (r.sport && (r.status === "ok" || r.status === "running")) {
        handled.add(`${r.sport}::${r.route}`);
      }
    }

    const missing = SUPERVISED.filter((s) => !handled.has(`${s.sport}::${s.route}`));

    if (missing.length === 0) {
      const result = { date, missing: 0, healed: 0, still_missing: 0 };
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
    for (const { sport, route } of missing) {
      const upstreamFailed = (route === "send-email" || route === "send-team-email")
        && healed.some((h) => h.sport === sport && h.route === "generate" && !h.ok);
      if (upstreamFailed) {
        healed.push({ sport, route, ok: false, skipped: "generate failed during heal" });
        continue;
      }

      const params = new URLSearchParams({ date, sport });
      if (route === "generate") params.set("refetch", "true");
      try {
        const res = await fetch(`${origin}/api/cron/${route}?${params}`, { headers });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok || body.error) {
          healed.push({ sport, route, ok: false, error: body.error ?? `HTTP ${res.status}` });
        } else {
          healed.push({ sport, route, ok: true });
        }
      } catch (e) {
        healed.push({ sport, route, ok: false, error: (e as Error).message });
      }
    }

    const okCount = healed.filter((h) => h.ok).length;
    const failCount = healed.length - okCount;
    const result = {
      date,
      missing: missing.length,
      healed: okCount,
      still_missing: failCount,
      details: healed,
    };

    if (failCount > 0) {
      const summary = healed
        .filter((h) => !h.ok)
        .map((h) => `${h.sport}/${h.route}: ${h.error ?? h.skipped ?? "unknown"}`)
        .join("; ");
      await finishCronRun(runId, {
        status: "failed",
        error: `Healed ${okCount}/${missing.length}; ${failCount} still missing — ${summary}`,
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
