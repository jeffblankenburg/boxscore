// GET /r/qr?src=<label>
//
// First-party redirect for physical QR codes (business cards, flyers). Logs
// the scan in qr_scans (fire-and-forget so the redirect isn't blocked by the
// DB write), then 302s to /subscribe carrying utm_source=qr and
// utm_campaign=<src> so the root-layout attribution script (see
// app/layout.tsx) tags the resulting signup. That gives us the full funnel:
// scans in qr_scans, conversions in subscribers where utm_source='qr', joined
// on src == utm_campaign. See /admin/metrics/sources.
//
// Mirrors /r/support's failure model: an unusable src still logs (as
// "unknown") and still redirects — we never strand a scanner on an error.
//
// `src` is a short label like "sabr-2026". Lowercase letters / digits /
// hyphens only — keeps URLs readable and gives a stable group-by key.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { EMAIL_LINK_BASE } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SRC_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("src") ?? "";
  const src = SRC_RE.test(raw) ? raw : "unknown";

  void supabaseAdmin()
    .from("qr_scans")
    .insert({
      src,
      user_agent: req.headers.get("user-agent"),
      referer: req.headers.get("referer"),
    })
    .then(({ error }) => {
      if (error) console.error(`[r/qr] insert failed: ${error.message}`);
    });

  // Forward to the public subscribe page with attribution the existing
  // capture script understands. utm_medium=print because a QR on a physical
  // card is the only thing that routes here today; utm_campaign=src is the
  // join key back to qr_scans in the admin funnel.
  const dest = new URL("/subscribe", EMAIL_LINK_BASE);
  dest.searchParams.set("utm_source", "qr");
  dest.searchParams.set("utm_medium", "print");
  dest.searchParams.set("utm_campaign", src);

  const res = NextResponse.redirect(dest, 302);
  res.headers.set("Cache-Control", "no-store");
  return res;
}
