"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import {
  consumeCode, createSession,
  ADVERTISER_SESSION_COOKIE, ADVERTISER_SESSION_TTL_SEC,
} from "@/lib/advertiser-auth";

export async function verifyCode(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const code = String(formData.get("code") ?? "").trim();

  const bail = (msg: string) =>
    redirect(`/advertise/verify?email=${encodeURIComponent(email)}&error=${encodeURIComponent(msg)}`);

  if (!email || !email.includes("@")) bail("Missing email — start over.");
  if (!/^\d{6}$/.test(code)) bail("Enter the 6-digit code.");

  const ok = await consumeCode(email, code);
  if (!ok) bail("Code didn't match, or it expired. Request a new one.");

  const { token, expiresAt } = await createSession(email);

  const jar = await cookies();
  jar.set({
    name: ADVERTISER_SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
    maxAge: ADVERTISER_SESSION_TTL_SEC,
  });

  redirect("/advertise/account");
}
