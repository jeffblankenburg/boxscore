"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import {
  consumeCode, createSession,
  ADMIN_SESSION_COOKIE, ADMIN_SESSION_TTL_SEC,
} from "@/lib/admin-auth";

// Login flow step 2: user submits the code; on success we mint a session
// cookie and bounce them into /admin. Wrong/expired codes redirect back with
// an error message and the email pre-filled.
export async function verifyCode(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const code = String(formData.get("code") ?? "").trim();

  const bail = (msg: string) =>
    redirect(`/admin/verify?email=${encodeURIComponent(email)}&error=${encodeURIComponent(msg)}`);

  if (!email || !email.includes("@")) bail("Missing email — start over.");
  if (!/^\d{6}$/.test(code)) bail("Enter the 6-digit code.");

  const result = await consumeCode(email, code);
  if (!result.ok) {
    if (result.reason === "locked") {
      const mins = Math.max(
        1,
        Math.ceil(((result.lockedUntil?.getTime() ?? Date.now()) - Date.now()) / 60_000),
      );
      bail(`Too many attempts — locked for ${mins} minute${mins === 1 ? "" : "s"}.`);
    }
    bail("Code didn't match, or it expired. Request a new one.");
  }

  const { token, expiresAt } = await createSession(email);

  const jar = await cookies();
  jar.set({
    name: ADMIN_SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
    maxAge: ADMIN_SESSION_TTL_SEC,
  });

  redirect("/admin");
}
