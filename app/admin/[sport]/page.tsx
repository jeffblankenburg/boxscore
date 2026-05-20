import { notFound } from "next/navigation";
import { requireAdmin } from "../require-admin";
import { AdminNav } from "../AdminNav";
import { SubmitButton } from "../SubmitButton";
import { SendEmailGuard } from "../SendEmailGuard";
import { triggerCron, sendAdminPreview, sendTeamAdminPreview, setAnnouncement, removeAnnouncement } from "../actions";
import { RegenerateAllRunner } from "./RegenerateAllRunner";
import { CopyButton } from "./CopyButton";
import {
  getSpecificAnnouncement,
  GLOBAL_ANNOUNCEMENT_SPORT,
  listAnnouncements,
  type AnnouncementListItem,
} from "@/lib/announcements";
import { getSportById, isSportVisible } from "@/lib/sports";
import { getActiveSubscribersForSport } from "@/lib/subscribers";
import { countActiveTeamSubscriptions } from "@/lib/email-subscriptions";
import { recentCronRunsForSports, type CronRun } from "@/lib/cron-runs";
import { supabaseAdmin } from "@/lib/supabase";
import { yesterdayInET, prettyDate } from "@/lib/dates";
import { featuresFor, type CronRoute } from "@/lib/sport-features";
import { teamsBySport, type Sport } from "@/lib/teams";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ sport: string }> }) {
  const { sport } = await params;
  const row = await getSportById(sport);
  if (!row) return {};
  return { title: `${row.name} · admin · boxscore`, robots: { index: false } };
}

export default async function LeagueDashboard({
  params,
  searchParams,
}: {
  params: Promise<{ sport: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  await requireAdmin();
  const { sport } = await params;
  if (!(await isSportVisible(sport, { includeAdminOnly: true }))) notFound();
  const sportRow = await getSportById(sport);
  if (!sportRow) notFound();
  const { ok, error } = await searchParams;

  const features = featuresFor(sport);
  const date = yesterdayInET();
  const returnTo = `/admin/${sport}`;

  const [activeSubs, teamSendCount, generateRun, lastSend, cronPulse, recentRuns, regenDates, sportAnnouncement, globalAnnouncement, announcementList] = await Promise.all([
    getActiveSubscribersForSport(sport).then((rows) => rows.length),
    features.hasTeamDigests ? countActiveTeamSubscriptions(sport) : Promise.resolve(0),
    getMostRecentCronRunForDate(sport, "generate", date),
    getMostRecentSendForSport(sport),
    getCronPulseForDate(sport, date, features.expectedRoutes),
    recentCronRunsForSports([sport], 20),
    features.hasRegenAll ? listCachedDigestDates(sport) : Promise.resolve([]),
    getSpecificAnnouncement(sport, date),
    getSpecificAnnouncement(GLOBAL_ANNOUNCEMENT_SPORT, date),
    listAnnouncements(sport),
  ]);

  const generateResult = (generateRun?.result ?? null) as
    | { game_count?: number; email_bytes?: number; final_count?: number } | null;
  const gameCount = generateResult?.game_count ?? generateResult?.final_count ?? null;
  const emailBytes = generateResult?.email_bytes ?? null;

  const sendResult = (lastSend?.result ?? null) as
    | { sent?: number; failed?: number; total_active_subscribers?: number } | null;
  const sendOk = sendResult?.sent ?? null;
  const sendFailed = sendResult?.failed ?? null;
  const sendTotal = sendResult?.total_active_subscribers ?? null;

  return (
    <main className="admin admin-wide">
      <AdminNav activeSport={sport} />
      <h1>{sportRow.name}</h1>

      {ok && <p className="admin-success"><strong>✓</strong> {ok}</p>}
      {error && <p className="admin-error"><strong>Failed:</strong> {error}</p>}

      <section className="admin-kpis">
        <KpiCard
          label="Active subscribers"
          value={activeSubs.toLocaleString()}
          sub="opted in to this digest"
        />
        <KpiCard
          label={`Digest · ${prettyDate(date)}`}
          value={generateRun
            ? gameCount != null ? gameCount.toString() : (generateRun.status === "failed" ? "FAIL" : "—")
            : "—"}
          sub={generateRun
            ? generateRun.status === "ok" ? "games · generate succeeded"
            : generateRun.status === "failed" ? "generate failed"
            : "running"
            : "no run yet"}
          deltaTone={generateRun?.status === "ok" ? "good" : generateRun?.status === "failed" ? "bad" : "neutral"}
        />
        <KpiCard
          label="Last send"
          value={lastSend?.date ?? "—"}
          sub={lastSend
            ? sendOk != null && sendFailed != null
              ? `${sendOk}/${(sendOk + sendFailed) || sendTotal || 0} delivered${sendFailed > 0 ? ` · ${sendFailed} failed` : ""}`
              : lastSend.status === "failed" ? `failed: ${lastSend.error?.slice(0, 60) ?? "(no message)"}`
              : lastSend.status
            : features.expectedRoutes.includes("send-email") ? "no sends yet" : "send not wired"}
          deltaTone={lastSend
            ? lastSend.status === "ok" && (sendFailed ?? 0) === 0 ? "good"
            : lastSend.status === "failed" || (sendFailed ?? 0) > 0 ? "bad"
            : "neutral"
            : "neutral"}
        />
        <KpiCard
          label="Email size"
          value={emailBytes != null ? `${(emailBytes / 1024).toFixed(1)} KB` : "—"}
          sub={emailBytes != null
            ? emailBytes > 102 * 1024 ? "⚠ over Gmail clip threshold" : "under 102 KB clip threshold"
            : "no digest yet"}
          deltaTone={emailBytes != null
            ? emailBytes > 102 * 1024 ? "bad" : "good"
            : "neutral"}
        />
      </section>

      <section>
        <h2>Cron pulse · {date}</h2>
        <CronPulseStrip pulse={cronPulse} routes={features.expectedRoutes} />
      </section>

      <section>
        <h2>Run a cron</h2>
        <p className="admin-meta">
          Manually fire any cron route. Date defaults to yesterday in ET;
          results land in the recent-runs table below.
        </p>
        {features.expectedRoutes.includes("generate") && (
          <TriggerForm
            route="generate"
            date={date}
            sport={sport}
            returnTo={returnTo}
            label="Generate digest"
          />
        )}
        {features.expectedRoutes.includes("send-email") && (
          <SendEmailGuard
            defaultDate={date}
            activeSubscribers={activeSubs}
            sport={sport}
            returnTo={returnTo}
          />
        )}
        {features.expectedRoutes.includes("send-team-email") && (
          <SendEmailGuard
            defaultDate={date}
            activeSubscribers={teamSendCount}
            sport={sport}
            returnTo={returnTo}
            route="send-team-email"
            label="Send team digests to subscribers"
            buttonLabel="Run send-team-email"
            audienceNoun="team-digest send"
          />
        )}
        {features.expectedRoutes.includes("post-bluesky") && (
          <TriggerForm
            route="post-bluesky"
            date={date}
            sport={sport}
            returnTo={returnTo}
            label="Post to BlueSky"
            allowReset
          />
        )}
        {features.expectedRoutes.includes("post-twitter") && (
          <TriggerForm
            route="post-twitter"
            date={date}
            sport={sport}
            returnTo={returnTo}
            label="Post to Twitter"
            allowReset
          />
        )}
        {features.hasRegenAll && <RegenerateAllRunner sport={sport} dates={regenDates} />}
      </section>

      <section>
        <h2>Email announcement banner</h2>
        <p className="admin-meta">
          One-off note prepended above the digest body in both the league
          send and every per-team send for the chosen date. Line breaks are
          preserved. Markdown: <code>**bold**</code>, <code>*italic*</code>,{" "}
          <code>__underline__</code>, <code>[link](https://…)</code>. Raw
          HTML also accepted. Empty + Save clears it.
        </p>
        <AnnouncementForm
          sport={sport}
          date={date}
          returnTo={returnTo}
          sportAnnouncement={sportAnnouncement}
          globalAnnouncement={globalAnnouncement}
        />
        <AnnouncementList
          sport={sport}
          returnTo={returnTo}
          items={announcementList}
        />
      </section>

      {features.hasPreview && (
        <section>
          <h2>Send today&apos;s email to me</h2>
          <p className="admin-meta">
            Renders + emails the {sportRow.name} digest for the chosen date to
            the signed-in admin&apos;s address. Useful for eyeballing a render
            before firing the real send.
          </p>
          <SendToMeForm date={date} sport={sport} returnTo={returnTo} />
        </section>
      )}

      {features.hasTeamDigests && (
        <section>
          <h2>Send a team&apos;s email to me</h2>
          <p className="admin-meta">
            Renders + emails a single team&apos;s digest to the signed-in
            admin&apos;s address. Bypasses the empty-day skip used by the
            send-team-email cron so you can preview off-day templates too.
          </p>
          <SendTeamToMeForm
            date={date}
            sport={sport}
            returnTo={returnTo}
            teams={teamsBySport(sport as Sport)}
          />
        </section>
      )}

      {(features.hasPreview || features.hasShareImages || features.expectedRoutes.includes("post-twitter")) && (
        <section>
          <h2>Other tools</h2>
          <ul className="admin-stats">
            {features.hasPreview && (
              <li>
                <a href={`/admin/preview/${sport}`}>Content preview →</a>
                <span className="admin-meta"> · web + email at multiple widths</span>
              </li>
            )}
            {features.hasPreview && (
              <li>
                <a href={`/admin/email/${date}`} target="_blank" rel="noreferrer">
                  Email preview ({date}) →
                </a>
                <span className="admin-meta"> · rendered email for the day</span>
              </li>
            )}
            {features.hasShareImages && (
              <li>
                <a href="/admin/images">Share images →</a>
                <span className="admin-meta"> · Twitter/BlueSky thread renders</span>
              </li>
            )}
            {features.expectedRoutes.includes("post-twitter") && (
              <li>
                <a href="/admin/twitter">Twitter compose →</a>
                <span className="admin-meta"> · manual tweet thread composer</span>
              </li>
            )}
          </ul>
        </section>
      )}

      <section>
        <h2>Recent cron runs</h2>
        <CronRunsTable runs={recentRuns} />
      </section>
    </main>
  );
}

// ---- queries --------------------------------------------------------------

async function getMostRecentCronRunForDate(
  sport: string,
  route: string,
  date: string,
): Promise<CronRun | null> {
  const { data, error } = await supabaseAdmin()
    .from("cron_runs")
    .select("id, route, sport, date, status, trigger, error, result, started_at, finished_at")
    .eq("sport", sport)
    .eq("route", route)
    .eq("date", date)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle<CronRun>();
  if (error) throw new Error(`getMostRecentCronRunForDate: ${error.message}`);
  return data;
}

async function getMostRecentSendForSport(sport: string): Promise<CronRun | null> {
  const { data, error } = await supabaseAdmin()
    .from("cron_runs")
    .select("id, route, sport, date, status, trigger, error, result, started_at, finished_at")
    .eq("sport", sport)
    .eq("route", "send-email")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle<CronRun>();
  if (error) throw new Error(`getMostRecentSendForSport: ${error.message}`);
  return data;
}

async function listCachedDigestDates(sport: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin()
    .from("daily_digests")
    .select("date")
    .eq("sport", sport)
    .order("date", { ascending: true });
  if (error) throw new Error(`listCachedDigestDates: ${error.message}`);
  return ((data ?? []) as Array<{ date: string }>).map((r) => r.date);
}

async function getCronPulseForDate(
  sport: string,
  date: string,
  routes: readonly CronRoute[],
): Promise<Record<string, CronRun | null>> {
  if (routes.length === 0) return {};
  const { data, error } = await supabaseAdmin()
    .from("cron_runs")
    .select("id, route, sport, date, status, trigger, error, result, started_at, finished_at")
    .eq("sport", sport)
    .eq("date", date)
    .in("route", routes as unknown as string[])
    .order("started_at", { ascending: false });
  if (error) throw new Error(`getCronPulseForDate: ${error.message}`);
  const out: Record<string, CronRun | null> = {};
  for (const route of routes) out[route] = null;
  for (const row of (data ?? []) as CronRun[]) {
    if (out[row.route] == null) out[row.route] = row;
  }
  return out;
}

// ---- components -----------------------------------------------------------

function KpiCard({
  label,
  value,
  sub,
  deltaTone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  deltaTone?: "good" | "bad" | "neutral";
}) {
  return (
    <div className="admin-kpi">
      <div className="admin-kpi-label">{label}</div>
      <div className="admin-kpi-value">{value}</div>
      {sub && (
        <div className={`admin-kpi-sub admin-kpi-delta-${deltaTone}`}>{sub}</div>
      )}
    </div>
  );
}

function CronPulseStrip({
  pulse,
  routes,
}: {
  pulse: Record<string, CronRun | null>;
  routes: readonly string[];
}) {
  if (routes.length === 0) {
    return <p className="admin-meta">No cron routes configured for this sport yet.</p>;
  }
  return (
    <div className="cron-pulse">
      {routes.map((route) => {
        const run = pulse[route] ?? null;
        const tone = run?.status === "ok" ? "ok"
          : run?.status === "failed" ? "fail"
          : run?.status === "running" ? "running"
          : "missing";
        const label = run?.status === "ok" ? "\u2713"
          : run?.status === "failed" ? "\u2717"
          : run?.status === "running" ? "\u2026"
          : "\u2014";
        const time = run?.started_at
          ? new Date(run.started_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
          : "not run";
        return (
          <span key={route} className={`cron-pulse-pill cron-pulse-${tone}`}>
            <span className="cron-pulse-route">{route}</span>
            <span className="cron-pulse-status">{label}</span>
            <span className="cron-pulse-time">{time}</span>
          </span>
        );
      })}
    </div>
  );
}

function TriggerForm({
  route,
  date,
  sport,
  returnTo,
  label,
  allowReset = false,
}: {
  route: string;
  date: string;
  sport: string;
  returnTo: string;
  label: string;
  allowReset?: boolean;
}) {
  return (
    <form action={triggerCron} className="admin-trigger-form">
      <input type="hidden" name="route" value={route} />
      <input type="hidden" name="sport" value={sport} />
      <input type="hidden" name="returnTo" value={returnTo} />
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
      <SubmitButton idleLabel={`Run ${route}`} pendingLabel="Running\u2026" />
    </form>
  );
}

function SendToMeForm({
  date,
  sport,
  returnTo,
}: {
  date: string;
  sport: string;
  returnTo: string;
}) {
  return (
    <form
      action={async (formData: FormData) => {
        "use server";
        const rawDate = formData.get("date");
        const targetDate = typeof rawDate === "string" && rawDate ? rawDate : date;
        await sendAdminPreview(targetDate, sport, returnTo);
      }}
      className="admin-trigger-form"
    >
      <label>
        <span className="admin-trigger-label">Date</span>
        <input
          className="admin-input"
          type="date"
          name="date"
          defaultValue={date}
        />
      </label>
      <SubmitButton idleLabel="Send to me" pendingLabel="Sending\u2026" />
    </form>
  );
}

function SendTeamToMeForm({
  date,
  sport,
  returnTo,
  teams,
}: {
  date: string;
  sport: string;
  returnTo: string;
  teams: ReturnType<typeof teamsBySport>;
}) {
  return (
    <form
      action={async (formData: FormData) => {
        "use server";
        const rawDate = formData.get("date");
        const rawTeam = formData.get("team");
        const targetDate = typeof rawDate === "string" && rawDate ? rawDate : date;
        const targetTeam = typeof rawTeam === "string" ? rawTeam : "";
        await sendTeamAdminPreview(targetDate, sport, targetTeam, returnTo);
      }}
      className="admin-trigger-form"
    >
      <label>
        <span className="admin-trigger-label">Team</span>
        <select className="admin-input" name="team" defaultValue={teams[0]?.slug ?? ""}>
          {teams.map((t) => (
            <option key={t.slug} value={t.slug}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className="admin-trigger-label">Date</span>
        <input
          className="admin-input"
          type="date"
          name="date"
          defaultValue={date}
        />
      </label>
      <SubmitButton idleLabel="Send team to me" pendingLabel="Sending\u2026" />
    </form>
  );
}

function AnnouncementForm({
  sport,
  date,
  returnTo,
  sportAnnouncement,
  globalAnnouncement,
}: {
  sport: string;
  date: string;
  returnTo: string;
  sportAnnouncement: string | null;
  globalAnnouncement: string | null;
}) {
  // Pre-fill the textarea with whichever is currently set; sport-specific
  // wins (matches the precedence the send crons use). The "all sports"
  // checkbox starts in whichever mode matches the populated source.
  const prefill = sportAnnouncement ?? globalAnnouncement ?? "";
  const prefillIsGlobal = !sportAnnouncement && !!globalAnnouncement;

  return (
    <form action={setAnnouncement} className="admin-announcement-form">
      <input type="hidden" name="sport" value={sport} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <div className="admin-announcement-meta">
        <label>
          <span className="admin-trigger-label">Date</span>
          <input
            className="admin-input"
            type="date"
            name="date"
            defaultValue={date}
          />
        </label>
        <label className="admin-announcement-scope">
          <input
            type="checkbox"
            name="apply_all"
            value="1"
            defaultChecked={prefillIsGlobal}
          />
          <span>Apply to all sports (global banner)</span>
        </label>
      </div>
      <AnnouncementStatus
        sport={sport}
        sportAnnouncement={sportAnnouncement}
        globalAnnouncement={globalAnnouncement}
      />
      <label className="admin-announcement-html">
        <span className="admin-trigger-label">HTML</span>
        <textarea
          name="html"
          rows={6}
          className="admin-input admin-announcement-textarea"
          defaultValue={prefill}
          placeholder={`New: **per-team daily digests** are live.\nPick your team on [Settings](https://boxscore.email/settings).`}
        />
      </label>
      <div className="admin-announcement-actions">
        <SubmitButton idleLabel="Save announcement" pendingLabel="Saving\u2026" />
      </div>
    </form>
  );
}

function AnnouncementStatus({
  sport,
  sportAnnouncement,
  globalAnnouncement,
}: {
  sport: string;
  sportAnnouncement: string | null;
  globalAnnouncement: string | null;
}) {
  if (!sportAnnouncement && !globalAnnouncement) {
    return (
      <p className="admin-meta admin-announcement-status">
        No banner set for this date.
      </p>
    );
  }
  return (
    <ul className="admin-meta admin-announcement-status admin-announcement-status-list">
      {sportAnnouncement && (
        <li>
          <strong>{sport.toUpperCase()}-specific</strong> banner set ({sportAnnouncement.length} chars){globalAnnouncement ? " — overrides the global banner" : ""}.
        </li>
      )}
      {globalAnnouncement && (
        <li>
          <strong>Global</strong> banner set ({globalAnnouncement.length} chars) — applies to every sport's send when no sport-specific banner exists.
        </li>
      )}
    </ul>
  );
}

function AnnouncementList({
  sport,
  returnTo,
  items,
}: {
  sport: string;
  returnTo: string;
  items: AnnouncementListItem[];
}) {
  if (items.length === 0) {
    return (
      <p className="admin-meta admin-announcement-list-empty">
        No saved announcements for {sport.toUpperCase()} or global.
      </p>
    );
  }
  return (
    <div className="admin-announcement-list">
      <h3 className="admin-announcement-list-title">Saved announcements</h3>
      <ul className="admin-announcement-rows">
        {items.map((item) => {
          const scope = item.sport === "*" ? "All sports" : item.sport.toUpperCase();
          const preview = plainTextForPreview(item.html);
          return (
            <li key={`${item.sport}-${item.date}`} className="admin-announcement-row">
              <div className="admin-announcement-when">
                <div className="admin-announcement-date">{item.date}</div>
                <div className="admin-announcement-scope-tag">{scope}</div>
              </div>
              <div className="admin-announcement-preview">{preview}</div>
              <div className="admin-announcement-row-actions">
                <CopyButton text={item.html} />
                <form action={removeAnnouncement} style={{ margin: 0 }}>
                  <input type="hidden" name="scope" value={item.sport} />
                  <input type="hidden" name="date" value={item.date} />
                  <input type="hidden" name="pageSport" value={sport} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <button type="submit" className="admin-btn admin-btn-ghost admin-btn-small">
                    Delete
                  </button>
                </form>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function plainTextForPreview(raw: string): string {
  // Strip HTML tags but PRESERVE author-typed newlines so the preview cell
  // looks like the announcement actually will (via white-space: pre-wrap
  // in CSS). Markdown markers stay visible — operator typed them, let
  // them see what they typed. No truncation; the column wraps naturally
  // and Copy still grabs the raw original for full editing elsewhere.
  return raw.replace(/<[^>]+>/g, "").trim();
}

function CronRunsTable({ runs }: { runs: CronRun[] }) {
  if (runs.length === 0) {
    return <p className="admin-meta">No runs for this sport yet.</p>;
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
            : "\u2014";
          const detail = r.error
            ? <span className="admin-cron-error">{r.error}</span>
            : r.result
              ? <code>{summarizeResult(r.result)}</code>
              : "";
          return (
            <tr key={r.id}>
              <td><code>{r.route}</code></td>
              <td>{r.date ?? "\u2014"}</td>
              <td>{r.trigger}</td>
              <td><span className={`status-${r.status}`}>{statusLabel(r.status)}</span></td>
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
  if (typeof r.final_count === "number") parts.push(`${r.final_count} final`);
  if (typeof r.sent === "number") parts.push(`${r.sent} sent`);
  if (typeof r.skipped === "number" && (r.skipped as number) > 0) parts.push(`${r.skipped} skipped`);
  if (typeof r.failed === "number" && (r.failed as number) > 0) parts.push(`${r.failed} failed`);
  if (typeof r.posted === "number") parts.push(`${r.posted} posted`);
  if (typeof r.conference_count === "number") parts.push(`${r.conference_count} conf`);
  return parts.join(", ");
}
