import { requireAdmin } from "../require-admin";
import { getEmailLinkClicksSummary } from "@/lib/click-tracking";

export const dynamic = "force-dynamic";
export const metadata = { title: "Email link clicks · admin · boxscore", robots: { index: false } };

// Truncates a URL for inline display in the recent-clicks table. Long
// HMAC redirect targets (/r/e/...) and ko-fi destinations otherwise blow
// out the row width. Full URL is in the title attribute on hover.
function shortenUrl(u: string | null): string {
  if (!u) return "—";
  try {
    const parsed = new URL(u);
    const path = parsed.pathname + parsed.search;
    return `${parsed.host}${path.length > 40 ? path.slice(0, 40) + "…" : path}`;
  } catch {
    return u.length > 60 ? u.slice(0, 60) + "…" : u;
  }
}

export default async function AdminClicksView() {
  await requireAdmin();
  const summary = await getEmailLinkClicksSummary();

  return (
    <main className="admin">
      <h1>Email link clicks</h1>
      <p className="admin-meta">
        Clicks on tracked links wrapped through <code>/r/e/[src]</code> — digest
        title, Manage Subscriptions, Games, Tip Jar. Web-header and footer Tip
        Jar still write to <code>support_clicks</code>; that table no longer has
        an admin view.
      </p>

      <section>
        <p className="admin-meta">
          {summary.total} total — {summary.last7d} in the last 7 days, {summary.last24h} in the last 24h.
        </p>

        {summary.bySrc.length > 0 && (
          <table className="admin-clicks-table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Total</th>
                <th>7d</th>
                <th>24h</th>
              </tr>
            </thead>
            <tbody>
              {summary.bySrc.map((r) => (
                <tr key={r.src}>
                  <td><code>{r.src}</code></td>
                  <td>{r.total}</td>
                  <td>{r.last7d}</td>
                  <td>{r.last24h}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <h3 className="admin-clicks-subhead">Recent</h3>
        {summary.recent.length === 0 ? (
          <p className="admin-meta">No clicks yet.</p>
        ) : (
          <table className="admin-clicks-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Source</th>
                <th>Target</th>
                <th>Referer</th>
              </tr>
            </thead>
            <tbody>
              {summary.recent.map((r) => (
                <tr key={r.id}>
                  <td className="admin-meta">{new Date(r.clicked_at).toLocaleString()}</td>
                  <td><code>{r.src}</code></td>
                  <td title={r.link_target ?? ""}>
                    <code>{shortenUrl(r.link_target)}</code>
                  </td>
                  <td><code>{r.referer ?? "—"}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
