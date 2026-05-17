// POST /api/auth/request
//
// Body: { email: string } (form-encoded or JSON)
// Always returns 200 with the same "if you have an account…" message so the
// caller can't distinguish between (a) address exists, link sent, (b) address
// doesn't exist, (c) rate-limited. Enumeration defense.
//
// Real work happens in requestMagicLink (lib/subscriber-auth.ts) — same
// helper drives the /settings server action so they share one rate-limit
// + lookup + send path.

import { NextResponse } from "next/server";
import { siteOrigin } from "@/lib/site";
import { requestMagicLink, validateEmail } from "@/lib/subscriber-auth";

export const runtime = "nodejs";

function clientIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip");
}

async function readEmail(req: Request): Promise<string | null> {
  const ct = req.headers.get("content-type") ?? "";
  try {
    if (ct.includes("application/json")) {
      const j = await req.json();
      return typeof j?.email === "string" ? j.email : null;
    }
    const fd = await req.formData();
    const e = fd.get("email");
    return typeof e === "string" ? e : null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const raw = await readEmail(req);
  if (!raw) {
    return NextResponse.json({ ok: false, error: "Missing email." }, { status: 400 });
  }
  if (validateEmail(raw) !== "valid") {
    return NextResponse.json(
      { ok: false, error: "That doesn't look like an email." },
      { status: 400 },
    );
  }
  const origin = await siteOrigin();
  await requestMagicLink({
    email: raw,
    ip: clientIp(req),
    buildUrl: (token) => `${origin}/auth/${token}`,
  });
  return NextResponse.json({
    ok: true,
    message: "If that email is registered, a sign-in link is on the way.",
  });
}
