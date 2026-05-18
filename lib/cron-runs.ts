import { supabaseAdmin } from "./supabase";

export type CronStatus = "running" | "ok" | "failed";
export type CronTrigger = "cron" | "manual";

export type CronRun = {
  id: string;
  route: string;
  sport: string | null;
  date: string | null;
  status: CronStatus;
  trigger: CronTrigger;
  error: string | null;
  result: unknown;
  started_at: string;
  finished_at: string | null;
};

// Insert a "running" row at the top of a cron route. Returns the run id so
// finishCronRun can update the same row.
export async function startCronRun(args: {
  route: string;
  sport?: string;
  date?: string;
  trigger: CronTrigger;
}): Promise<string> {
  const { data, error } = await supabaseAdmin()
    .from("cron_runs")
    .insert({
      route: args.route,
      sport: args.sport ?? null,
      date: args.date ?? null,
      status: "running" as CronStatus,
      trigger: args.trigger,
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) throw new Error(`startCronRun: ${error?.message ?? "no id"}`);
  return data.id;
}

// Per-image-loop cron routes (post-twitter, post-bluesky, etc.) collect a
// `{ subId, error? }` array as they iterate. When the overall run finishes
// with at least one failure, this helper turns that array into a single
// human-readable error string that gets stored on cron_runs.error AND surfaced
// in the failure-alert email. Without this, the only stored error is "N of N
// failed" — useless when oncall is trying to triage at 6am.
export function summarizeItemErrors(
  results: ReadonlyArray<{ subId: string; error?: string | null }>,
  total: number,
): string | null {
  const failures = results.filter(
    (r): r is { subId: string; error: string } => typeof r.error === "string" && r.error.length > 0,
  );
  if (failures.length === 0) return null;
  const distinct = Array.from(new Set(failures.map((f) => f.error)));
  const lead = `${failures.length}/${total} failed`;
  if (distinct.length === 1) {
    return `${lead}: ${distinct[0]}`;
  }
  // Multiple distinct errors — list each with a representative subId.
  const samples = distinct.map((msg) => {
    const sample = failures.find((f) => f.error === msg)!;
    return `[${sample.subId}] ${msg}`;
  });
  return `${lead} (${distinct.length} distinct): ${samples.join(" | ")}`;
}

// Mark a run finished (ok or failed). Safe to call even if the original
// startCronRun didn't happen (e.g., the route crashed before it could insert)
// — in that case `id` is null and we no-op.
export async function finishCronRun(
  id: string | null,
  args: { status: "ok" | "failed"; error?: string | null; result?: unknown },
): Promise<void> {
  if (!id) return;
  const finishedAt = new Date().toISOString();
  const { data, error } = await supabaseAdmin()
    .from("cron_runs")
    .update({
      status: args.status,
      error: args.error ?? null,
      result: args.result ?? null,
      finished_at: finishedAt,
    })
    .eq("id", id)
    .select("id, route, sport, date, status, trigger, error, result, started_at, finished_at")
    .single<CronRun>();
  if (error) {
    console.error(`finishCronRun(${id}): ${error.message}`);
    return;
  }
  if (data && data.status === "failed") {
    // Fire-and-forget; never let a notification failure break the cron finish.
    notifyCronFailure(data).catch((e: unknown) => {
      console.error(`notifyCronFailure(${id}): ${e instanceof Error ? e.message : String(e)}`);
    });
  }
}

// Send an email to ADMIN_EMAIL when a cron run finishes in 'failed' state.
// Silent no-op if ADMIN_EMAIL is unset. Resend errors propagate to the caller
// (finishCronRun catches them).
async function notifyCronFailure(run: CronRun): Promise<void> {
  const to = process.env.ADMIN_EMAIL;
  if (!to) return;
  const { sendEmail } = await import("./email");
  const siteUrl = process.env.SITE_URL ?? "https://boxscore.email";
  const adminUrl = `${siteUrl}/admin`;
  const startedAt = new Date(run.started_at).toLocaleString();
  const subject = `[boxscore] Cron failed: ${run.route}${run.date ? ` (${run.date})` : ""}`;
  const html = `
    <div style="font-family: ui-monospace, monospace; font-size: 14px; line-height: 1.5;">
      <p style="font: 700 16px 'Source Sans 3', Helvetica, Arial, sans-serif;">Cron run failed</p>
      <table cellpadding="4" style="border-collapse: collapse;">
        <tr><td><strong>Route</strong></td><td><code>${escapeHtml(run.route)}</code></td></tr>
        <tr><td><strong>Date</strong></td><td>${escapeHtml(run.date ?? "—")}</td></tr>
        <tr><td><strong>Trigger</strong></td><td>${escapeHtml(run.trigger)}</td></tr>
        <tr><td><strong>Started</strong></td><td>${escapeHtml(startedAt)}</td></tr>
        <tr><td valign="top"><strong>Error</strong></td><td><pre style="margin:0; white-space:pre-wrap;">${escapeHtml(run.error ?? "(no error message)")}</pre></td></tr>
      </table>
      <p><a href="${adminUrl}">Open admin dashboard →</a></p>
    </div>
  `;
  const text = [
    `Cron run failed`,
    ``,
    `Route:    ${run.route}`,
    `Date:     ${run.date ?? "—"}`,
    `Trigger:  ${run.trigger}`,
    `Started:  ${startedAt}`,
    `Error:    ${run.error ?? "(no error message)"}`,
    ``,
    `Admin: ${adminUrl}`,
  ].join("\n");
  await sendEmail({ to, subject, html, text });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c] ?? c));
}

// Most recent runs across all routes. Used to render the /admin status table.
export async function recentCronRuns(limit: number = 20): Promise<CronRun[]> {
  const { data, error } = await supabaseAdmin()
    .from("cron_runs")
    .select("id, route, sport, date, status, trigger, error, result, started_at, finished_at")
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`recentCronRuns: ${error.message}`);
  return (data ?? []) as CronRun[];
}
