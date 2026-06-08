import { requireAdmin } from "../require-admin";
import { AdminNav } from "../AdminNav";
import { SubmitButton } from "../SubmitButton";
import { loadAllWebhooks, type DiscordWebhookRow } from "@/lib/discord";
import { teamsBySport, type Sport } from "@/lib/teams";
import {
  createWebhook, toggleWebhookActive, deleteWebhook, resetWebhookFailures,
} from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Discord · admin · boxscore", robots: { index: false } };

const VISIBLE_SPORTS: Sport[] = ["mlb"];

// Channel registry for the daily Discord fan-out. One row per
// (sport, scope, team) Discord channel. The post-discord cron looks up
// these rows when posting the daily scoreboard + per-game box scores.
//
// Add a row by creating an incoming webhook in Discord (Server Settings →
// Integrations → Webhooks → New Webhook), copying the URL, and pasting
// it into the form below.

export default async function DiscordWebhooksPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  await requireAdmin();
  const { ok, error } = await searchParams;
  const webhooks = await loadAllWebhooks();

  // Build a map of sport → list of teams already covered so the "add"
  // form can hint at what's missing rather than making the operator
  // hunt through the table.
  const coveredByScope = new Map<string, Set<string>>();
  for (const w of webhooks) {
    const key = w.scope === "league" ? `${w.sport}/league` : `${w.sport}/team`;
    if (!coveredByScope.has(key)) coveredByScope.set(key, new Set());
    if (w.scope === "team" && w.team_slug) coveredByScope.get(key)!.add(w.team_slug);
    if (w.scope === "league") coveredByScope.get(key)!.add("(league)");
  }

  return (
    <main className="admin admin-wide">
      <AdminNav />
      <h1>Discord webhooks</h1>
      <p className="admin-meta">
        Each row maps a Discord channel to the boxscore daily post.
        The league webhook receives the day&apos;s scoreboard image; team
        webhooks receive the box-score image for any game that team
        played in. Create the webhook in Discord (Server Settings →
        Integrations → Webhooks → New Webhook), then paste the URL below.
      </p>

      {ok && <p className="admin-success"><strong>✓</strong> {ok}</p>}
      {error && <p className="admin-error"><strong>Failed:</strong> {error}</p>}

      <section>
        <h2>Add a webhook</h2>
        <form action={createWebhook} style={{ display: "grid", gridTemplateColumns: "auto auto auto 1fr auto", gap: "0.5em 0.75em", alignItems: "center" }}>
          <label>Sport</label>
          <select name="sport" defaultValue="mlb">
            {VISIBLE_SPORTS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <label>Scope</label>
          <select name="scope" defaultValue="team">
            <option value="league">league (sport-wide channel)</option>
            <option value="team">team (per-team channel)</option>
          </select>
          <div />

          <label>Team slug</label>
          <input
            name="team_slug"
            placeholder="ari, lad, … (blank for league scope)"
            style={{ gridColumn: "span 3" }}
          />
          <div />

          <label>Webhook URL</label>
          <input
            name="webhook_url"
            type="url"
            required
            placeholder="https://discord.com/api/webhooks/…"
            style={{ gridColumn: "span 3" }}
          />
          <SubmitButton idleLabel="Add webhook" pendingLabel="Adding…" />
        </form>
      </section>

      <section>
        <h2>Current webhooks ({webhooks.length})</h2>
        {webhooks.length === 0 ? (
          <p className="admin-meta"><em>No webhooks configured yet.</em></p>
        ) : (
          <WebhookTable rows={webhooks} />
        )}
      </section>

      <section>
        <h2>Coverage by sport</h2>
        {VISIBLE_SPORTS.map((sport) => {
          const teamSlugs = teamsBySport(sport).map((t) => t.slug);
          const teamCovered = coveredByScope.get(`${sport}/team`) ?? new Set<string>();
          const leagueCovered = (coveredByScope.get(`${sport}/league`)?.size ?? 0) > 0;
          const missingTeams = teamSlugs.filter((s) => !teamCovered.has(s));
          return (
            <div key={sport} style={{ marginBottom: "1em" }}>
              <strong>{sport.toUpperCase()}</strong>
              <ul style={{ margin: "0.25em 0" }}>
                <li>League channel: {leagueCovered ? "✓ configured" : "✗ missing"}</li>
                <li>
                  Team channels: {teamCovered.size}/{teamSlugs.length} configured
                  {missingTeams.length > 0 && (
                    <span className="admin-meta"> — missing: {missingTeams.join(", ")}</span>
                  )}
                </li>
              </ul>
            </div>
          );
        })}
      </section>
    </main>
  );
}

function WebhookTable({ rows }: { rows: DiscordWebhookRow[] }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "0.5em" }}>
      <thead>
        <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border)" }}>
          <th>Sport</th>
          <th>Scope</th>
          <th>Team</th>
          <th>Status</th>
          <th>Health</th>
          <th>Last success</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const health = r.failure_count > 0
            ? `${r.failure_count} fail${r.failure_count === 1 ? "" : "s"}`
            : "—";
          const lastSuccess = r.last_success_at
            ? new Date(r.last_success_at).toISOString().slice(0, 10)
            : "—";
          return (
            <tr key={r.id} style={{ borderBottom: "1px solid var(--border-faint)" }}>
              <td>{r.sport}</td>
              <td>{r.scope}</td>
              <td>{r.team_slug ?? "—"}</td>
              <td>{r.active ? "active" : <em>disabled</em>}</td>
              <td>
                {health}
                {r.last_failure_note && (
                  <div className="admin-meta" style={{ fontSize: "0.85em" }}>
                    {r.last_failure_note}
                  </div>
                )}
              </td>
              <td>{lastSuccess}</td>
              <td style={{ whiteSpace: "nowrap" }}>
                <form action={toggleWebhookActive} style={{ display: "inline" }}>
                  <input type="hidden" name="id" value={r.id} />
                  <SubmitButton
                    idleLabel={r.active ? "Disable" : "Enable"}
                    pendingLabel="…"
                  />
                </form>{" "}
                {r.failure_count > 0 && (
                  <form action={resetWebhookFailures} style={{ display: "inline" }}>
                    <input type="hidden" name="id" value={r.id} />
                    <SubmitButton idleLabel="Clear fails" pendingLabel="…" />
                  </form>
                )}{" "}
                <form action={deleteWebhook} style={{ display: "inline" }}>
                  <input type="hidden" name="id" value={r.id} />
                  <SubmitButton idleLabel="Delete" pendingLabel="…" />
                </form>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
