"use server";

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { revalidatePath } from "next/cache";
import { getDigest } from "@/lib/digests";
import { sendEmail } from "@/lib/email";
import { dailyEmail } from "@/lib/emails/templates";
import { prettyDate, isValidIsoDate } from "@/lib/dates";
import { renderShareImages } from "@/lib/render-images";
import { siteOrigin } from "@/lib/site";

export async function sendAdminPreview(date: string): Promise<void> {
  if (!isValidIsoDate(date)) throw new Error(`Bad date: ${date}`);
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) throw new Error("ADMIN_EMAIL not set in .env.local");

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

export async function regenerateShareImages(date: string): Promise<void> {
  if (!isValidIsoDate(date)) throw new Error(`Bad date: ${date}`);

  const origin = await siteOrigin();
  const images = await renderShareImages({ date, baseUrl: origin });

  const outDir = resolve("out/share", date);
  await mkdir(outDir, { recursive: true });

  const entries = [];
  for (const { entry, png } of images) {
    await writeFile(resolve(outDir, entry.file), png);
    entries.push(entry);
  }

  const manifest = {
    sport: "mlb" as const,
    date,
    prettyDate: prettyDate(date),
    entries,
  };
  await writeFile(resolve(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  revalidatePath(`/admin/images/${date}`);
}
