// One-click unsubscribe endpoint (RFC 8058 / List-Unsubscribe-Post).
//
// Gmail and Apple Mail show a native "Unsubscribe" button next to the sender
// when both List-Unsubscribe and List-Unsubscribe-Post headers are present.
// Clicking it sends an HTTP POST to the URL in List-Unsubscribe with body
// "List-Unsubscribe=One-Click". This endpoint serves that POST.
//
// User-facing unsubscribe (clicking the link in the email body) goes to the
// page at /u/[token] instead — which renders a confirmation button to guard
// against link-prefetching bots auto-unsubscribing real users.

import { NextResponse } from "next/server";
import {
  findByUnsubscribeToken,
  unsubscribeSubscriber,
} from "@/lib/subscribers";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(token)) {
    return new NextResponse("Bad token", { status: 400 });
  }
  const sub = await findByUnsubscribeToken(token);
  if (!sub) return new NextResponse("Not found", { status: 404 });
  if (sub.status === "active") {
    await unsubscribeSubscriber(sub.id);
  }
  // RFC 8058: any 2xx response is accepted. Body content is ignored by clients.
  return new NextResponse("Unsubscribed", { status: 200 });
}
