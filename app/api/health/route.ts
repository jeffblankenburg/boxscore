import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

// Liveness probe for external uptime monitoring (Better Stack, etc.).
// It MUST round-trip Postgres: during the 2026-07-10 outage the static
// homepage kept returning 200 while every DB-backed route 500'd, so a
// homepage ping would have stayed green through the whole incident.
// We race a trivial single-row read against a short timeout so the probe
// fails FAST with 503 instead of hanging ~30s like the real pages did —
// a monitor needs a quick, decisive signal.

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // never cache; every hit is a live DB check

const DB_TIMEOUT_MS = 3000;

export async function GET() {
  const startedAt = Date.now();
  try {
    // Cheapest possible round-trip: read at most one id. Admin key bypasses
    // RLS, so this reflects raw DB reachability, not policy state.
    const { error } = await supabaseAdmin()
      .from("subscribers")
      .select("id")
      .limit(1)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));

    if (error) throw new Error(error.message);

    return NextResponse.json(
      { status: "ok", db: "ok", latencyMs: Date.now() - startedAt },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { status: "error", db: "down", latencyMs: Date.now() - startedAt, error: message },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
