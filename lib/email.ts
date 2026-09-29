import { Resend } from "resend";

let cached: Resend | null = null;

function client(): Resend {
  if (cached) return cached;
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY must be set.");
  cached = new Resend(key);
  return cached;
}

const FROM = process.env.EMAIL_FROM ?? "boxscore <digest@boxscore.email>";

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

// Each result lines up positionally with the input array; we surface Resend's
// per-row outcome as `error: string | null`.
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
    // Resend validates the WHOLE payload up front and 422s the entire batch if
    // a single address is malformed — it delivers none of the 100. Blanket-
    // failing every row here punished ~99 valid subscribers for one typo'd
    // signup (gmail.con, @example.com); across a week that silently dropped
    // 3k+ valid recipients (diagnosed 2026-09-29). Fall back to per-email
    // sends so the poison address fails alone and everyone else still gets it.
    return sendEmailIndividually(items);
  }
  const out = res.data?.data ?? [];
  return items.map((_, i) => {
    const row = out[i];
    if (row?.id) return { id: row.id, error: null };
    return { id: null, error: "no id returned" };
  });
}

// Fallback for a batch Resend rejected wholesale. Sent sequentially, not with
// Promise.all: firing 100 concurrent requests would blow Resend's 10 req/s
// rate limit. This path is rare (only a batch carrying an invalid address),
// so the added wall-clock is bounded and only touches poisoned batches.
async function sendEmailIndividually(items: SendArgs[]): Promise<BatchSendResult[]> {
  const out: BatchSendResult[] = [];
  for (const item of items) {
    try {
      const { id } = await sendEmail(item);
      out.push({ id, error: null });
    } catch (err) {
      out.push({ id: null, error: (err as Error).message });
    }
  }
  return out;
}
