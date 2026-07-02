import { notFound } from "next/navigation";
import { requireAdmin } from "../require-admin";
import { SubmitButton } from "../SubmitButton";
import { sendAdminPreview, sendTeamAdminPreview, setAnnouncement, removeAnnouncement, setSportSends } from "../actions";
import { RegenerateAllRunner } from "./RegenerateAllRunner";
import { CronPanel } from "./CronPanel";
import { CopyButton } from "./CopyButton";
import {
  getSpecificAnnouncement,
  GLOBAL_ANNOUNCEMENT_SPORT,
  listAnnouncements,
  type AnnouncementListItem,
} from "@/lib/announcements";
import { getSportById, getSportRow, isSportVisible } from "@/lib/sports";
import { getActiveSubscribersForSport } from "@/lib/subscribers";
import { countActiveTeamSubscriptions } from "@/lib/email-subscriptions";
import { recentCronRunsForSports, type CronRun } from "@/lib/cron-runs";
import { supabaseAdmin } from "@/lib/supabase";
import { yesterdayInET, prettyDate, nextDay, prevDay } from "@/lib/dates";
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
  if (!isSportVisible(sport, { includeAdminOnly: true })) notFound();
  const sportRow = await getSportRow(sport);
  if (!sportRow) notFound();
  const { ok, error } = await searchParams;

  const features = featuresFor(sport);
  // gamesDate = the day the games we're showing were played (yesterday).
  // editionDate = the day the email goes out (today). Backend lookups
  // use gamesDate; date INPUTS show editionDate. Forms translate edition
  // → games at submission time.
  const gamesDate = yesterdayInET();
  const editionDate = nextDay(gamesDate);
  const returnTo = `/admin/${sport}`;

  const [activeSubs, teamSendCount, generateRun, lastSend, cronPulse, recentRuns, regenDates, sportAnnouncement, globalAnnouncement, announcementList, teamConsoleRows] = await Promise.all([
    getActiveSubscribersForSport(sport).then((rows) => rows.length),
    features.hasTeamDigests ? countActiveTeamSubscriptions(sport) : Promise.resolve(0),
    getMostRecentCronRunForDate(sport, "generate", gamesDate),
    getMostRecentSendForSport(sport),
    getCronPulseForDate(sport, gamesDate, features.expectedRoutes),
    recentCronRunsForSports([sport], 20),
    features.hasRegenAll ? listCachedDigestDates(sport) : Promise.resolve([]),
    getSpecificAnnouncement(sport, gamesDate),
    getSpecificAnnouncement(GLOBAL_ANNOUNCEMENT_SPORT, gamesDate),
    listAnnouncements(sport),
    features.hasTeamDigests ? loadTeamConsoleRows(sport, gamesDate) : Promise.resolve([]),
  ]);

  const generateResult = (generateRun?.result ?? null) as
    | { game_count?: number; email_bytes?: number; final_count?: number } | null;
  const gameCount = generateResult?.game_count ?? generateResult?.final_count ?? null;
  const emailBytes = generateResult?.email_bytes ?? null;

  const sendResult = (lastSend?.result ?? null) as
    | { sent?: number; failed?: number; total_active_subscribers?: number; skipped_reason?: string } | null;
  const sendOk = sendResult?.sent ?? null;
  const sendFailed = sendResult?.failed ?? null;
  const sendTotal = sendResult?.total_active_subscribers ?? null;
  const sendSkippedReason = sendResult?.skipped_reason ?? null;

  return (
    <main className="admin admin-wide">
      <h1>{sportRow.name}</h1>

      {ok && <p className="admin-success"><strong>✓</strong> {ok}</p>}
      {error && <p className="admin-error"><strong>Failed:</strong> {error}</p>}

      <SendsToggleBanner
        sport={sport}
        sportName={sportRow.name}
        sendsEnabled={sportRow.sends_enabled}
        returnTo={returnTo}
      />

      <section className="admin-kpis">
        <KpiCard
          label="Active subscribers"
          value={activeSubs.toLocaleString()}
          sub="opted in to this digest"
        />
        <KpiCard
          label={`Digest · ${prettyDate(gamesDate)}`}
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
            ? sendSkippedReason
              ? `skipped (${sendSkippedReason})`
              : sendOk != null && sendFailed != null
              ? `${sendOk}/${(sendOk + sendFailed) || sendTotal || 0} delivered${sendFailed > 0 ? ` · ${sendFailed} failed` : ""}`
              : lastSend.status === "failed" ? `failed: ${lastSend.error?.slice(0, 60) ?? "(no message)"}`
              : lastSend.status
            : features.expectedRoutes.includes("send-email") ? "no sends yet" : "send not wired"}
          deltaTone={lastSend
            ? sendSkippedReason ? "neutral"
            : lastSend.status === "ok" && (sendFailed ?? 0) === 0 ? "good"
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
        <h2>Cron pulse · {gamesDate}</h2>
        <CronPulseStrip pulse={cronPulse} routes={features.expectedRoutes} />
      </section>

      <section>
        <h2>Run a cron</h2>
        <p className="admin-meta">
          Manually fire any cron route. Date defaults to today&apos;s edition;
          results land in the recent-runs table below.
        </p>
        <CronPanel
          sport={sport}
          returnTo={returnTo}
          defaultDate={editionDate}
          expectedRoutes={features.expectedRoutes}
          activeSubs={activeSubs}
          teamSendCount={teamSendCount}
        />
        {features.hasRegenAll && <RegenerateAllRunner sport={sport} dates={regenDates} />}
      </section>

      {features.hasTeamDigests && (
        <section>
          <h2>Team digest console</h2>
          <p className="admin-meta">
            Per-team rollup for <code>{gamesDate}</code>&apos;s games. Subs = opted-in
            subscribers. Yesterday = whether the team played + a final box
            score was cached. Send = sent/failed counts from the team-send
            cron for this date. Preview opens the team&apos;s web digest in a
            new tab.
          </p>
          <TeamConsole rows={teamConsoleRows} sport={sport} date={editionDate} />
        </section>
      )}

      <section>
        <h2>Email announcement banner</h2>
        <p className="admin-meta">
          One-off note prepended above the digest body in both the league
          send and every per-team send for the chosen edition date. Line breaks
          are preserved. Markdown: <code>**bold**</code>, <code>*italic*</code>,{" "}
          <code>__underline__</code>, <code>[link](https://…)</code>. Raw
          HTML also accepted. Empty + Save clears it.
        </p>
        <AnnouncementForm
          sport={sport}
          date={editionDate}
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
            Renders + emails the {sportRow.name} digest for the chosen edition
            date to the signed-in admin&apos;s address. Useful for eyeballing a
            render before firing the real send.
          </p>
          <SendToMeForm date={editionDate} sport={sport} returnTo={returnTo} />
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
            date={editionDate}
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
                <a href={`/admin/email/${gamesDate}`} target="_blank" rel="noreferrer">
                  Email preview ({gamesDate}) →
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

type TeamConsoleRow = {
  slug: string;
  name: string;
  abbreviation: string;
  primary: string | null;
  subscribers: number;
  hasGameYesterday: boolean | null; // null = no team_digests row at all
  digestGenerated: boolean;
  send: { sent: number; failed: number } | null;
  // Rolling-7-day opens for this team's digest. null when no sends in
  // window; renderer shows "—" rather than 0% to distinguish "no data"
  // from "0% opens." Opens accumulate over days so a 7-day window is more
  // representative than yesterday-only.
  opens7d: { sent: number; opened: number } | null;
};

// Per-team rollup for the team console section: subscriber count, did the
// team play yesterday, did generate succeed (was a team_digests row
// written), and how did the team-send go. Four small queries, joined in
// memory; cheap at 30 teams.
//
// Subscriber count semantics: ONLY counts opted-in rows whose subscriber
// account is also subscribers.status='active'. The send cron filters the
// same way, so this number matches what an actual send would deliver to.
// (Earlier this counted raw email_subscriptions rows, which over-counted
// by including subscribers who later unsubscribed but never toggled the
// team off — their row stays active=true, but the cron correctly skips
// them.)
async function loadTeamConsoleRows(
  sport: string,
  date: string,
): Promise<TeamConsoleRow[]> {
  const db = supabaseAdmin();
  const teams = teamsBySport(sport as Sport);

  const { getActiveSubscriberIdSet } = await import("@/lib/subscribers");

  // email_subscriptions and sends both silently cap at 1000 rows without
  // pagination — sends in particular was capping the per-team accounting
  // at exactly 1000 across all teams for a date, masking real send volume.
  type SubRow = { team_id: string | null; subscriber_id: string };
  type SendRow = { team_id: string | null; error: string | null };
  const fetchAllSubs = async (): Promise<SubRow[]> => {
    const out: SubRow[] = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await db.from("email_subscriptions")
        .select("team_id, subscriber_id")
        .eq("sport", sport)
        .eq("scope", "team")
        .eq("active", true)
        .order("subscriber_id", { ascending: true })
        .range(from, from + pageSize - 1);
      if (error) throw new Error(`team-console subs: ${error.message}`);
      const page = (data ?? []) as SubRow[];
      out.push(...page);
      if (page.length < pageSize) break;
    }
    return out;
  };
  const fetchAllSends = async (): Promise<SendRow[]> => {
    const out: SendRow[] = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await db.from("sends")
        .select("team_id, error")
        .eq("digest_sport", sport)
        .eq("digest_date", date)
        .not("team_id", "is", null)
        .order("team_id", { ascending: true })
        .range(from, from + pageSize - 1);
      if (error) throw new Error(`team-console sends: ${error.message}`);
      const page = (data ?? []) as SendRow[];
      out.push(...page);
      if (page.length < pageSize) break;
    }
    return out;
  };

  // 7-day window of successful team sends with their resend_id, joined to
  // opens via email_events. Window is long enough that opens have time to
  // accumulate (most opens land within 24h but MPP prefetch dribbles in
  // through the week) and short enough to stay representative.
  type Sends7dRow = { team_id: string | null; resend_id: string | null };
  const opensWindowDays = 7;
  const opensSinceIso = new Date(Date.now() - opensWindowDays * 86_400_000).toISOString();
  const fetchAllSends7d = async (): Promise<Sends7dRow[]> => {
    const out: Sends7dRow[] = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await db.from("sends")
        .select("team_id, resend_id")
        .eq("digest_sport", sport)
        .not("team_id", "is", null)
        .is("error", null)
        .gte("sent_at", opensSinceIso)
        .order("team_id", { ascending: true })
        .range(from, from + pageSize - 1);
      if (error) throw new Error(`team-console sends7d: ${error.message}`);
      const page = (data ?? []) as Sends7dRow[];
      out.push(...page);
      if (page.length < pageSize) break;
    }
    return out;
  };
  type OpenEventRow = { resend_id: string | null };
  const fetchAllOpens7d = async (): Promise<OpenEventRow[]> => {
    const out: OpenEventRow[] = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await db.from("email_events")
        .select("resend_id")
        .eq("event_type", "email.opened")
        .gte("event_at", opensSinceIso)
        .range(from, from + pageSize - 1);
      if (error) throw new Error(`team-console opens7d: ${error.message}`);
      const page = (data ?? []) as OpenEventRow[];
      out.push(...page);
      if (page.length < pageSize) break;
    }
    return out;
  };

  const [
    subRows,
    activeIds,
    { data: digestRows, error: digestErr },
    sendRows,
    sends7d,
    opens7d,
  ] = await Promise.all([
    fetchAllSubs(),
    getActiveSubscriberIdSet(),
    // team_digests is bounded by sport+date (~30 rows), safe unpaginated.
    db.from("team_digests")
      .select("team_slug, has_game")
      .eq("sport", sport)
      .eq("date", date),
    fetchAllSends(),
    fetchAllSends7d(),
    fetchAllOpens7d(),
  ]);
  if (digestErr) throw new Error(`team-console digests: ${digestErr.message}`);
  const subsByTeam = new Map<string, number>();
  for (const r of subRows) {
    if (!r.team_id) continue;
    if (!activeIds.has(r.subscriber_id)) continue;
    subsByTeam.set(r.team_id, (subsByTeam.get(r.team_id) ?? 0) + 1);
  }
  const digestByTeam = new Map<string, boolean>();
  for (const r of (digestRows ?? []) as Array<{ team_slug: string; has_game: boolean }>) {
    digestByTeam.set(r.team_slug, r.has_game);
  }
  const sendsByTeam = new Map<string, { sent: number; failed: number }>();
  for (const r of sendRows) {
    if (!r.team_id) continue;
    const cur = sendsByTeam.get(r.team_id) ?? { sent: 0, failed: 0 };
    if (r.error) cur.failed++;
    else cur.sent++;
    sendsByTeam.set(r.team_id, cur);
  }

  // Per-team 7-day open rollup. Build the opened-resend_id set once, then
  // walk every team send in the window and bucket it by team + whether
  // its resend_id had an open event.
  const openedIds = new Set<string>();
  for (const r of opens7d) if (r.resend_id) openedIds.add(r.resend_id);
  const opens7dByTeam = new Map<string, { sent: number; opened: number }>();
  for (const r of sends7d) {
    if (!r.team_id) continue;
    const cur = opens7dByTeam.get(r.team_id) ?? { sent: 0, opened: 0 };
    cur.sent++;
    if (r.resend_id && openedIds.has(r.resend_id)) cur.opened++;
    opens7dByTeam.set(r.team_id, cur);
  }

  return teams
    .map((team) => ({
      slug: team.slug,
      name: team.name,
      abbreviation: team.abbreviation,
      primary: team.primary ?? null,
      subscribers: subsByTeam.get(team.slug) ?? 0,
      hasGameYesterday: digestByTeam.has(team.slug) ? digestByTeam.get(team.slug)! : null,
      digestGenerated: digestByTeam.has(team.slug),
      send: sendsByTeam.get(team.slug) ?? null,
      opens7d: opens7dByTeam.get(team.slug) ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
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

function SendsToggleBanner({
  sport,
  sportName,
  sendsEnabled,
  returnTo,
}: {
  sport: string;
  sportName: string;
  sendsEnabled: boolean;
  returnTo: string;
}) {
  // Two-step confirm via <details>. First click opens the panel; the inner
  // submit (with hidden confirmed=1) is the actual state change. No JS
  // modal — works in noscript admin sessions too. The pause direction is
  // a soft action (it stops mail), but resume during off-season would
  // silently send mail tomorrow, so both directions get the same guard.
  const cls = sendsEnabled ? "admin-sends-on" : "admin-sends-off";
  const stateLabel = sendsEnabled ? "SENDS ENABLED" : "SENDS PAUSED";
  const explainer = sendsEnabled
    ? `Daily ${sportName} emails will go out at the next scheduled cron.`
    : `Daily ${sportName} emails are paused. generate still runs so the archive page stays populated; the send crons skip.`;
  const buttonLabel = sendsEnabled ? "Pause sends…" : "Resume sends…";
  const confirmHeading = sendsEnabled ? `Pause daily ${sportName} sends?` : `Resume daily ${sportName} sends?`;
  const confirmBody = sendsEnabled
    ? `No daily ${sportName} email will go out until you resume. The send cron will record a "skipped: sends_disabled" run each day so it's clear the skip is intentional.`
    : `The next scheduled cron will send the ${sportName} digest to every active subscriber. Make sure today's generate produced a real digest (KPI above).`;
  const confirmLabel = sendsEnabled ? `Confirm: Pause ${sportName} sends` : `Confirm: Resume ${sportName} sends`;

  return (
    <section className={`admin-sends-banner ${cls}`}>
      <div className="admin-sends-banner-row">
        <div>
          <div className="admin-sends-banner-state">{stateLabel}</div>
          <div className="admin-sends-banner-explain">{explainer}</div>
        </div>
        <details className="admin-sends-banner-action">
          <summary className="admin-btn">{buttonLabel}</summary>
          <form action={setSportSends} className="admin-sends-confirm">
            <input type="hidden" name="sport" value={sport} />
            <input type="hidden" name="enable" value={sendsEnabled ? "0" : "1"} />
            <input type="hidden" name="confirmed" value="1" />
            <input type="hidden" name="returnTo" value={returnTo} />
            <p className="admin-sends-confirm-heading"><strong>{confirmHeading}</strong></p>
            <p className="admin-sends-confirm-body">{confirmBody}</p>
            <SubmitButton idleLabel={confirmLabel} pendingLabel="Saving…" />
          </form>
        </details>
      </div>
    </section>
  );
}

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
        // Input value is edition date; backend (sendAdminPreview → digest
        // lookup) expects games_date. Translate at submission.
        const editionDate = typeof rawDate === "string" && rawDate ? rawDate : date;
        const targetDate = prevDay(editionDate);
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
        // Edition date in, games_date out — same boundary translation as
        // the league-send form above.
        const editionDate = typeof rawDate === "string" && rawDate ? rawDate : date;
        const targetDate = prevDay(editionDate);
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

function TeamConsole({
  rows,
  sport,
  date,
}: {
  rows: TeamConsoleRow[];
  sport: string;
  date: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="admin-meta">No team registry entries for this sport.</p>
    );
  }
  // Totals across every team in the table. "Played yesterday" counts only
  // teams whose schedule had a final game; null (unknown / no data) is
  // excluded. "Generated" counts teams with a cached digest row.
  const totals = {
    subs: rows.reduce((s, r) => s + r.subscribers, 0),
    played: rows.reduce((s, r) => s + (r.hasGameYesterday ? 1 : 0), 0),
    generated: rows.reduce((s, r) => s + (r.digestGenerated ? 1 : 0), 0),
    sent: rows.reduce((s, r) => s + (r.send?.sent ?? 0), 0),
    failed: rows.reduce((s, r) => s + (r.send?.failed ?? 0), 0),
    opens7dSent:   rows.reduce((s, r) => s + (r.opens7d?.sent   ?? 0), 0),
    opens7dOpened: rows.reduce((s, r) => s + (r.opens7d?.opened ?? 0), 0),
    teams: rows.length,
  };
  const fmtPct = (num: number, den: number) =>
    den === 0 ? "—" : `${Math.round((num / den) * 100)}%`;
  return (
    <table className="admin-team-console">
      <thead>
        <tr>
          <th className="admin-team-col-name">Team</th>
          <th className="admin-team-col-num">Subs</th>
          <th className="admin-team-col-state">Yesterday</th>
          <th className="admin-team-col-state">Last gen</th>
          <th className="admin-team-col-state">Send (ok/fail)</th>
          <th className="admin-team-col-state" title="Rolling 7-day open rate: opens / successful sends">Open rate (7d)</th>
          <th className="admin-team-col-actions"></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const sendCell = r.send
            ? <span className={r.send.failed > 0 ? "admin-team-bad" : "admin-team-ok"}>
                {r.send.sent}/{r.send.failed}
              </span>
            : <span className="admin-team-empty">—</span>;
          const yesterdayCell = r.hasGameYesterday === null
            ? <span className="admin-team-empty">—</span>
            : r.hasGameYesterday
              ? <span className="admin-team-ok">✓ played</span>
              : <span className="admin-team-empty">no game</span>;
          const genCell = r.digestGenerated
            ? <span className="admin-team-ok">OK</span>
            : <span className="admin-team-bad">missing</span>;
          const opensCell = r.opens7d && r.opens7d.sent > 0
            ? <span title={`${r.opens7d.opened} of ${r.opens7d.sent} successful sends opened`}>
                {fmtPct(r.opens7d.opened, r.opens7d.sent)}
              </span>
            : <span className="admin-team-empty">—</span>;
          return (
            <tr key={r.slug}>
              <td className="admin-team-col-name">
                {r.primary && (
                  <span
                    className="admin-team-swatch"
                    style={{ background: r.primary }}
                    aria-hidden="true"
                  />
                )}
                {r.name}
              </td>
              <td className="admin-team-col-num">{r.subscribers.toLocaleString()}</td>
              <td className="admin-team-col-state">{yesterdayCell}</td>
              <td className="admin-team-col-state">{genCell}</td>
              <td className="admin-team-col-state">{sendCell}</td>
              <td className="admin-team-col-state">{opensCell}</td>
              <td className="admin-team-col-actions">
                <a
                  href={`/${sport}/${r.slug}/${date}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="admin-team-link"
                >
                  Preview →
                </a>
              </td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr className="admin-team-totals">
          <td className="admin-team-col-name">Totals ({totals.teams} teams)</td>
          <td className="admin-team-col-num">{totals.subs.toLocaleString()}</td>
          <td className="admin-team-col-state">{totals.played} played</td>
          <td className="admin-team-col-state">{totals.generated}/{totals.teams} generated</td>
          <td className="admin-team-col-state">
            <span className={totals.failed > 0 ? "admin-team-bad" : "admin-team-ok"}>
              {totals.sent}/{totals.failed}
            </span>
          </td>
          <td className="admin-team-col-state">
            {fmtPct(totals.opens7dOpened, totals.opens7dSent)}
          </td>
          <td className="admin-team-col-actions"></td>
        </tr>
      </tfoot>
    </table>
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
    <form
      action={async (formData: FormData) => {
        "use server";
        // Input is edition date; announcements table keys by games_date
        // (the digest's identity). Translate at the boundary.
        const rawDate = formData.get("date");
        const editionDate = typeof rawDate === "string" && rawDate ? rawDate : date;
        formData.set("date", prevDay(editionDate));
        await setAnnouncement(formData);
      }}
      className="admin-announcement-form"
    >
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
  // Kill-switch skips win the summary — otherwise it'd render as "0 sent"
  // which reads identical to a real-failure zero.
  if (typeof r.skipped_reason === "string") return `skipped: ${r.skipped_reason}`;
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
