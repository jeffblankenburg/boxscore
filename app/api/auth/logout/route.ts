// POST /api/auth/logout
//
// Revokes the current session (DB row) and clears the cookie. Form-action
// friendly: returns a redirect to /. Idempotent — calling without a session
// is a no-op.

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { revokeSession, SUBSCRIBER_SESSION_COOKIE } from "@/lib/subscriber-auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const jar = await cookies();
  const token = jar.get(SUBSCRIBER_SESSION_COOKIE)?.value;
  await revokeSession(token);
  jar.delete(SUBSCRIBER_SESSION_COOKIE);
  // Form-encoded posts expect a same-origin redirect; clients hitting this
  // from fetch() can read the 303 and ignore the body.
  const url = new URL("/", req.url);
  return NextResponse.redirect(url, { status: 303 });
}
