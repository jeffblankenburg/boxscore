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

// Each item in the batch result lines up positionally with the input array.
// One bad address in the batch doesn't fail the rest — Resend reports each
// individually. We surface that as a per-row `error: string | null`.
export type BatchSendResult = { id: string | null; error: string | null };

// Resend's batch endpoint accepts up to 100 emails per call. Caller is
// responsible for chunking; this function sends exactly one batch.
export async function sendEmailBatch(items: SendArgs[]): Promise<BatchSendResult[]> {
  if (items.length === 0) return [];
  if (items.length > 100) {
    throw new Error(`sendEmailBatch: max 100 per call, got ${items.length}`);
  }
  const res = await client().batch.send(
    items.map((a) => ({
      from: FROM,
      to: a.to,
      subject: a.subject,
      html: a.html,
      ...(a.text ? { text: a.text } : {}),
      ...(a.headers ? { headers: a.headers } : {}),
    })),
  );
  if (res.error) {
    // Whole-batch failure (auth, malformed request, etc.) — every row failed.
    return items.map(() => ({ id: null, error: res.error?.message ?? "batch failed" }));
  }
  const out = res.data?.data ?? [];
  return items.map((_, i) => {
    const row = out[i];
    if (row?.id) return { id: row.id, error: null };
    return { id: null, error: "no id returned" };
  });
}
