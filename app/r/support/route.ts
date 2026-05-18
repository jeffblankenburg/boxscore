import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { BRAND } from "@/lib/brand";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const src = req.nextUrl.searchParams.get("src") ?? "unknown";

  void supabaseAdmin()
    .from("support_clicks")
    .insert({
      src,
      user_agent: req.headers.get("user-agent"),
      referer: req.headers.get("referer"),
    })
    .then(({ error }) => {
      if (error) console.error(`support_clicks insert: ${error.message}`);
    });

  const res = NextResponse.redirect(BRAND.tipJarUrl, 302);
  res.headers.set("Cache-Control", "no-store");
  return res;
}
