"use server";

import { sendEmail } from "@/lib/email";
import { BUDGETS, FORMATS } from "./options";

const INBOX = process.env.ADVERTISE_INBOX_EMAIL ?? "hello@boxscore.email";

const BUDGET_SET: ReadonlySet<string> = new Set(BUDGETS);
const FORMAT_SET: ReadonlySet<string> = new Set(FORMATS);

export type InquiryResult =
  | { ok: true }
  | { ok: false; error: string };

export async function submitAdInquiry(formData: FormData): Promise<InquiryResult> {
  // Honeypot: real browsers leave this empty; bots fill every input. If it's
  // set, silently report success and drop the message — no point telling a
  // bot it was flagged.
  const trap = String(formData.get("website") ?? "").trim();
  if (trap.length > 0) return { ok: true };

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const company = String(formData.get("company") ?? "").trim();
  const budget = String(formData.get("budget") ?? "").trim();
  const message = String(formData.get("message") ?? "").trim();
  const formats = formData.getAll("formats").map(String).filter(Boolean);

  if (name.length < 2) return { ok: false, error: "Please share your name." };
  if (!email.includes("@") || email.length < 5) {
    return { ok: false, error: "Please share a working email so we can reply." };
  }
  if (message.length < 10) {
    return { ok: false, error: "Tell us a bit more about what you're looking for (at least a sentence)." };
  }
  if (budget && !BUDGET_SET.has(budget)) {
    return { ok: false, error: "Invalid budget selection." };
  }
  for (const f of formats) {
    if (!FORMAT_SET.has(f)) return { ok: false, error: "Invalid format selection." };
  }

  const subject = `[advertise] ${name}${company ? ` (${company})` : ""}`;
  const lines = [
    `From: ${name} <${email}>`,
    company ? `Company: ${company}` : null,
    budget ? `Budget: ${budget}` : null,
    formats.length > 0 ? `Formats: ${formats.join(", ")}` : null,
    "",
    message,
  ].filter((l): l is string => l !== null);
  const text = lines.join("\n");
  const html = `<pre style="font-family: ui-monospace, monospace; white-space: pre-wrap;">${
    escapeHtml(text)
  }</pre>`;

  try {
    await sendEmail({
      to: INBOX,
      subject,
      html,
      text,
      headers: { "Reply-To": email },
    });
    return { ok: true };
  } catch (err) {
    console.error(`[advertise inquiry] failed: ${(err as Error).message}`);
    return { ok: false, error: "Couldn't send the message — try again, or email hello@boxscore.email directly." };
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

