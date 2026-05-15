"use server";

import { revalidatePath } from "next/cache";
import { getDigest } from "@/lib/digests";
import { sendEmail } from "@/lib/email";
import { dailyEmail } from "@/lib/emails/templates";
import { prettyDate, isValidIsoDate, yesterdayInET } from "@/lib/dates";
import { renderShareImages } from "@/lib/render-images";
import { uploadShareImages } from "@/lib/share-storage";
import { siteOrigin } from "@/lib/site";

export async function sendAdminPreview(date: string): Promise<void> {
  if (!isValidIsoDate(date)) throw new Error(`Bad date: ${date}`);
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) throw new Error("ADMIN_EMAIL not set");

  const digest = await getDigest("mlb", date);
  if (!digest || !digest.email_html) {
    throw new Error(`No email_html for ${date}`);
  }

  const origin = await siteOrigin();
  const { subject, html, text } = dailyEmail({
    digestPrettyDate: prettyDate(date),
    digestUrl: `${origin}/mlb/${date}`,
    unsubscribeUrl: `${origin}/u/admin-preview`,
    digestEmailHtml: digest.email_html,
  });

  await sendEmail({
    to: adminEmail,
    subject: `[ADMIN PREVIEW] ${subject}`,
    html,
    text,
  });
}

export async function regenerateShareImages(formData: FormData): Promise<void> {
  const raw = formData.get("date");
  const date = typeof raw === "string" && raw ? raw : yesterdayInET();
  if (!isValidIsoDate(date)) throw new Error(`Bad date: ${date}`);

  const origin = await siteOrigin();
  const images = await renderShareImages({ date, baseUrl: origin });
  await uploadShareImages({ date, images });

  revalidatePath("/admin/images");
}
