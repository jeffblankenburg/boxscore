import { after, NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { BRAND } from "@/lib/brand";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const src = req.nextUrl.searchParams.get("src") ?? "unknown";

  // Log via after(), not fire-and-forget: on serverless the function is
  // frozen once the 302 is sent, dropping a bare background insert on cold
  // invocations. after() keeps the function alive (waitUntil on Vercel)
  // until the write completes without delaying the redirect.
  const click = {
    src,
    user_agent: req.headers.get("user-agent"),
    referer: req.headers.get("referer"),
  };
  after(async () => {
    const { error } = await supabaseAdmin().from("support_clicks").insert(click);
    if (error) console.error(`support_clicks insert: ${error.message}`);
  });

  const res = NextResponse.redirect(BRAND.tipJarUrl, 302);
  res.headers.set("Cache-Control", "no-store");
  return res;
}
