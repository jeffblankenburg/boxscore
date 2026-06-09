import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import {
  verifySignature, parseEvents, eventToRow,
} from "@/lib/vercel-analytics-ingest";

// Vercel Web Analytics Drain receiver. Vercel POSTs every pageview /
// custom event from boxscore.email to this endpoint as JSON (array or
// NDJSON). We verify the `x-vercel-signature` HMAC, parse the events,
// and upsert into public.page_views.
//
// The /advertise page reads aggregated pageview counts from page_views
// when computing the rolling impressions number. See
// supabase/migrations/0031_page_views.sql for the table.
//
// Configuration (one-time, in Vercel dashboard):
//   1. Settings → Drains → New Drain
//   2. Data type: Web Analytics
//   3. Endpoint: https://boxscore.email/api/ingest/vercel-analytics
//   4. Format: JSON or NDJSON (both supported)
//   5. Copy the generated signature secret → set as
//      VERCEL_DRAIN_SIGNATURE_SECRET in this project's env vars

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.VERCEL_DRAIN_SIGNATURE_SECRET;
  if (!secret) {
    // Without the secret we can't verify the signature, so we MUST refuse
    // every request rather than risk accepting forged payloads.
    return NextResponse.json(
      { error: "ingest disabled: VERCEL_DRAIN_SIGNATURE_SECRET not set" },
      { status: 503 },
    );
  }

  // Critical: read the body as raw text BEFORE any JSON parsing so the
  // signature check sees the exact bytes Vercel signed. Re-parsing JSON
  // and re-stringifying would change whitespace and invalidate the HMAC.
  const rawBody = await request.text();
  const sigHeader = request.headers.get("x-vercel-signature");
  if (!verifySignature(rawBody, sigHeader, secret)) {
    return NextResponse.json(
      { code: "invalid_signature", error: "signature didn't match" },
      { status: 403 },
    );
  }

  let events;
  try {
    events = parseEvents(rawBody);
  } catch (err) {
    const msg = (err as Error).message;
    console.error(`[vercel-analytics-ingest] parse failed: ${msg}`);
    return NextResponse.json({ error: `parse failed: ${msg}` }, { status: 400 });
  }

  // Convert and drop events without a usable timestamp.
  const rows = events
    .map(eventToRow)
    .filter((r): r is NonNullable<typeof r> => r != null);

  if (rows.length === 0) {
    return NextResponse.json({ ok: true, inserted: 0, received: events.length });
  }

  // ON CONFLICT DO NOTHING absorbs Drain retries. The unique index on
  // (occurred_at, session_id, device_id, path) defines what counts as a
  // duplicate event — see migrations/0031_page_views.sql.
  const { error } = await supabaseAdmin()
    .from("page_views")
    .upsert(rows, {
      onConflict: "occurred_at,session_id,device_id,path",
      ignoreDuplicates: true,
    });

  if (error) {
    // Surface to function logs so future failures don't just appear as a
    // bare 500 in the Vercel Drain UI.
    console.error(`[vercel-analytics-ingest] db upsert failed: ${error.message}`);
    return NextResponse.json(
      { error: `db upsert failed: ${error.message}`, received: events.length },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, received: events.length, inserted: rows.length });
}
