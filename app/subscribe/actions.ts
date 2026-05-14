"use server";

import { redirect } from "next/navigation";
import { startSubscription } from "@/lib/subscribers";
import { sendEmail } from "@/lib/email";
import { confirmationEmail } from "@/lib/emails/templates";
import { siteOrigin } from "@/lib/site";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function subscribe(formData: FormData): Promise<void> {
  const raw = formData.get("email");
  const email = typeof raw === "string" ? raw.trim() : "";
  if (!EMAIL_RE.test(email)) {
    redirect("/subscribe?error=invalid_email");
  }

  const subscriber = await startSubscription(email);
  const origin = await siteOrigin();
  const confirmUrl = `${origin}/c/${subscriber.confirm_token}`;
  const { subject, html, text } = confirmationEmail({ confirmUrl });

  await sendEmail({ to: subscriber.email, subject, html, text });

  redirect("/subscribe/sent");
}
