import { Resend } from "resend";

let cached: Resend | null = null;

function client(): Resend {
  if (cached) return cached;
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY must be set.");
  cached = new Resend(key);
  return cached;
}

const FROM = process.env.EMAIL_FROM ?? "boxscore.email <digest@boxscore.email>";

export type SendArgs = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  headers?: Record<string, string>;
};

export async function sendEmail(args: SendArgs): Promise<{ id: string }> {
  const res = await client().emails.send({
    from: FROM,
    to: args.to,
    subject: args.subject,
    html: args.html,
    ...(args.text ? { text: args.text } : {}),
    ...(args.headers ? { headers: args.headers } : {}),
  });
  if (res.error) throw new Error(`resend: ${res.error.message}`);
  if (!res.data?.id) throw new Error("resend: no id returned");
  return { id: res.data.id };
}
