import { yesterdayInET, prettyDate } from "@/lib/dates";
import { getDigest } from "@/lib/digests";
import { supabaseAdmin } from "@/lib/supabase";
import { recentCronRuns, type CronRun } from "@/lib/cron-runs";
import { SubmitButton } from "./SubmitButton";
import { requireAdmin } from "./require-admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · boxscore.email", robots: { index: false } };

export default async function AdminDashboard({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  await requireAdmin();
  const date = yesterdayInET();
  const pretty = prettyDate(date);
  const digest = await getDigest("mlb", date);
  const { ok, error } = await searchParams;

  // Quick status counts
  const { count: subscriberCount } = await supabaseAdmin()
    .from("subscribers")
    .select("id", { count: "exact", head: true })
    .eq("status", "active");

  const { count: sendsToday } = await supabaseAdmin()
    .from("sends")
    .select("id", { count: "exact", head: true })
    .eq("digest_date", date)
    .is("error", null);

  const { count: socialPostsToday } = await supabaseAdmin()
    .from("social_posts")
    .select("id", { count: "exact", head: true })
    .eq("date", date)
    .is("error", null);

  const runs = await recentCronRuns(20);

  return (
    <main className="admin">
      <h1>Admin</h1>

      {ok && (
        <p className="admin-success"><strong>✓</strong> {ok}</p>
      )}
      {error && (
        <p className="admin-error"><strong>Failed:</strong> {error}</p>
      )}

      <section>
        <h2>Status</h2>
        <ul className="admin-stats">
          <li><strong>Latest digest:</strong> {digest ? `${pretty} · ${digest.game_count} games · ${(digest.html.length / 1024).toFixed(0)} KB web / ${digest.email_html ? (digest.email_html.length / 1024).toFixed(0) + " KB email" : "no email_html"}` : "(none for yesterday)"}</li>
          <li><strong>Active subscribers:</strong> {subscriberCount ?? 0}</li>
          <li><strong>Emails sent today:</strong> {sendsToday ?? 0}</li>
          <li><strong>Social posts today:</strong> {socialPostsToday ?? 0}</li>
        </ul>
      </section>

      <section>
        <h2>Run a cron</h2>
        <p className="admin-meta">
          Manually fire any cron route. Date defaults to yesterday in ET; results land in
          the cron-runs table below.
        </p>
        <TriggerForm route="generate" date={date} label="Generate digest" />
        <TriggerForm route="send-email" date={date} label="Send email to subscribers" />
        <TriggerForm route="post-bluesky" date={date} label="Post to BlueSky" allowReset />
        <TriggerForm route="post-twitter" date={date} label="Post to Twitter" allowReset />
        <RegenerateAllForm />
      </section>

      <section>
        <h2>Recent cron runs</h2>
        <CronRunsTable runs={runs} />
      </section>

      <section>
        <h2>Web</h2>
        <p>
          <a href={`/mlb/${date}`} target="_blank" rel="noreferrer">
            View /mlb/{date}
          </a>
          {" · "}
          <a href="/mlb" target="_blank" rel="noreferrer">/mlb</a>
        </p>
      </section>

      <section>
        <h2>Email preview (just to me)</h2>
        <p>
          <a href={`/admin/email/${date}`} target="_blank" rel="noreferrer">
            Preview today&apos;s email (in browser)
          </a>
        </p>
        <SendEmailForm date={date} />
      </section>

      <section>
        <h2>Share images</h2>
        <p>
          <a href="/admin/images">View share images (and regenerate)</a>
        </p>
      </section>

      <section>
        <h2>Twitter compose</h2>
        <p>
          <a href="/admin/twitter">Copy posts to clipboard for manual Twitter posting</a>
        </p>
      </section>
    </main>
  );
}

function RegenerateAllForm() {
  return (
    <form
      action={async () => {
        "use server";
        const { regenerateAllDigests } = await import("./actions");
        await regenerateAllDigests();
      }}
      className="admin-trigger-form"
    >
      <span className="admin-trigger-label">Regenerate ALL digests (re-renders every date in DB)</span>
      <SubmitButton idleLabel="Regenerate all" pendingLabel="Regenerating… (may take ~1 min)" />
    </form>
  );
}

function SendEmailForm({ date }: { date: string }) {
  return (
    <form action={async () => {
      "use server";
      const { sendAdminPreview } = await import("./actions");
      await sendAdminPreview(date);
    }}>
      <SubmitButton
        idleLabel="Send today's email to me"
        pendingLabel="Sending…"
      />
    </form>
  );
}

function TriggerForm({
  route, date, label, allowReset = false,
}: {
  route: string; date: string; label: string; allowReset?: boolean;
}) {
  return (
    <form
      action={async (formData: FormData) => {
        "use server";
        const { triggerCron } = await import("./actions");
        await triggerCron(formData);
      }}
      className="admin-trigger-form"
    >
      <input type="hidden" name="route" value={route} />
      <label>
        <span className="admin-trigger-label">{label}</span>
        <input
          className="admin-input"
          type="date"
          name="date"
          defaultValue={date}
        />
      </label>
      {allowReset && (
        <label className="admin-trigger-checkbox">
          <input type="checkbox" name="reset" value="1" /> reset
        </label>
      )}
      <SubmitButton idleLabel={`Run ${route}`} pendingLabel="Running…" />
    </form>
  );
}

function CronRunsTable({ runs }: { runs: CronRun[] }) {
  if (runs.length === 0) {
    return <p className="admin-meta">No runs yet.</p>;
  }
  return (
    <table className="admin-cron-runs">
      <thead>
        <tr>
          <th>Route</th>
          <th>Date</th>
          <th>Trigger</th>
          <th>Status</th>
          <th>Duration</th>
          <th>Started</th>
          <th>Details</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((r) => {
          const dur = r.finished_at
            ? ((new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()) / 1000).toFixed(1) + "s"
            : "—";
          const detail = r.error
            ? <span className="admin-cron-error">{r.error}</span>
            : r.result
              ? <code>{summarizeResult(r.result)}</code>
              : "";
          return (
            <tr key={r.id}>
              <td><code>{r.route}</code></td>
              <td>{r.date ?? "—"}</td>
              <td>{r.trigger}</td>
              <td>
                <span className={`status-${r.status}`}>{statusLabel(r.status)}</span>
              </td>
              <td>{dur}</td>
              <td className="admin-meta">{new Date(r.started_at).toLocaleString()}</td>
              <td>{detail}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function statusLabel(s: CronRun["status"]): string {
  if (s === "ok") return "PASS";
  if (s === "failed") return "FAIL";
  return "RUNNING";
}

function summarizeResult(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const r = result as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof r.game_count === "number") parts.push(`${r.game_count} games`);
  if (typeof r.sent === "number") parts.push(`${r.sent} sent`);
  if (typeof r.skipped === "number" && (r.skipped as number) > 0) parts.push(`${r.skipped} skipped`);
  if (typeof r.failed === "number" && (r.failed as number) > 0) parts.push(`${r.failed} failed`);
  if (typeof r.posted === "number") parts.push(`${r.posted} posted`);
  if (typeof r.total === "number" && parts.length === 0) parts.push(`${r.total} total`);
  return parts.join(", ");
}
