"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { siteOrigin } from "@/lib/site";
import { requestMagicLink, validateEmail } from "@/lib/subscriber-auth";

export async function requestSignInLink(formData: FormData) {
  const rawEmail = formData.get("email");
  if (typeof rawEmail !== "string" || validateEmail(rawEmail) !== "valid") {
    redirect("/settings?error=invalid_email");
  }
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  const ip = fwd ? (fwd.split(",")[0]?.trim() ?? null) : (h.get("x-real-ip") ?? null);
  const origin = await siteOrigin();
  await requestMagicLink({
    email: rawEmail,
    ip,
    buildUrl: (token) => `${origin}/auth/${token}`,
  });
  redirect("/settings?sent=1");
}
