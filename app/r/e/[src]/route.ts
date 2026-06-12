// GET /r/e/[src]?to=<encoded>&sig=<hmac>
//
// First-party redirect for tracked links in the email chrome. Verifies
// the HMAC, records the click in email_link_clicks (fire-and-forget so
// the user's redirect isn't blocked by the DB write), then 302s to the
// destination with no-store cache headers so SafeLinks-style proxies
// can't cache the redirect.
//
// Mirrors /r/ad's failure modes:
//   - Missing/malformed params  → 302 to site origin
//   - Bad HMAC                  → 302 to site origin (no record)
//   - Insert error              → still 302 to destination
//
// `src` is a short label like "email-header-digest", "email-header-manage".
// Lowercase letters / digits / hyphens only — keeps URLs readable and
// gives us a stable group-by key in the admin click-rate dashboard.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { verifyEmailLink } from "@/lib/link-tracking";
import { EMAIL_LINK_BASE } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SRC_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ src: string }> },
) {
  const home = NextResponse.redirect(new URL(EMAIL_LINK_BASE));
  home.headers.set("Cache-Control", "no-store");

  const { src } = await params;
  const to = req.nextUrl.searchParams.get("to");
  const sig = req.nextUrl.searchParams.get("sig");

  if (!SRC_RE.test(src)) return home;
  if (!to || !sig) return home;

  let destUrl: URL;
  try {
    destUrl = new URL(to);
    if (destUrl.protocol !== "https:" && destUrl.protocol !== "http:") {
      return home;
    }
  } catch {
    return home;
  }

  let valid: boolean;
  try {
    valid = await verifyEmailLink(src, to, sig);
  } catch {
    return home;
  }
  if (!valid) return home;

  void supabaseAdmin()
    .from("email_link_clicks")
    .insert({
      src,
      link_target: to,
      user_agent: req.headers.get("user-agent"),
      referer: req.headers.get("referer"),
    })
    .then(({ error }) => {
      if (error) console.error(`[r/e] insert failed: ${error.message}`);
    });

  const res = NextResponse.redirect(destUrl);
  res.headers.set("Cache-Control", "no-store");
  return res;
}
