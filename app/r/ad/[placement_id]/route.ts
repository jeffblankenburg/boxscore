// GET /r/ad/[placement_id]?to=<encoded>&sig=<hmac>
//
// First-party ad click redirect. Verifies the HMAC, records the click in
// link_clicks (fire-and-forget so the user's redirect isn't blocked by
// the DB write), then 302s to the destination with no-store cache headers
// so SafeLinks-style proxies can't cache the redirect.
//
// Failure modes:
//   - Missing/malformed params  → 302 to site origin
//   - Bad HMAC                  → 302 to site origin (no record)
//   - Insert error              → still 302 to destination (don't block
//                                 the click on a logging failure)

import { after, NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { verifyAdLink } from "@/lib/link-tracking";
import { isLikelyBot } from "@/lib/bot-detect";
import { EMAIL_LINK_BASE } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ placement_id: string }> },
) {
  const home = NextResponse.redirect(new URL(EMAIL_LINK_BASE));
  home.headers.set("Cache-Control", "no-store");

  const { placement_id } = await params;
  const to = req.nextUrl.searchParams.get("to");
  const sig = req.nextUrl.searchParams.get("sig");

  if (!UUID_RE.test(placement_id)) return home;
  if (!to || !sig) return home;

  // Validate destination URL shape — only http(s) allowed. Anything else
  // (javascript:, data:, etc.) gets bounced home.
  let destUrl: URL;
  try {
    destUrl = new URL(to);
    if (destUrl.protocol !== "https:" && destUrl.protocol !== "http:") {
      return home;
    }
  } catch {
    return home;
  }

  // HMAC verify against (placement_id, to). Mismatch → home.
  let valid: boolean;
  try {
    valid = await verifyAdLink(placement_id, to, sig);
  } catch {
    return home;
  }
  if (!valid) return home;

  // Log via after(), not fire-and-forget: on serverless the function is
  // frozen once the 302 is sent, dropping a bare background insert on cold
  // invocations. after() keeps the function alive (waitUntil on Vercel)
  // until the write completes without delaying the redirect — important here
  // because these rows are billable ad-click counts.
  const ua = req.headers.get("user-agent");
  const click = {
    label: "ad",
    placement_id,
    destination: to,
    user_agent: ua ? ua.slice(0, 200) : null,
    is_bot: isLikelyBot(ua),
  };
  after(async () => {
    const { error } = await supabaseAdmin().from("link_clicks").insert(click);
    if (error) console.error(`[r/ad] insert failed: ${error.message}`);
  });

  const res = NextResponse.redirect(destUrl);
  res.headers.set("Cache-Control", "no-store");
  return res;
}
