import { requireAdmin } from "../require-admin";
import { getSupportClicksSummary } from "@/lib/click-tracking";

export const dynamic = "force-dynamic";
export const metadata = { title: "Click tracking · admin · boxscore", robots: { index: false } };

export default async function AdminClicksView() {
  await requireAdmin();
  const support = await getSupportClicksSummary();

  return (
    <main className="admin">
      <h1>Click tracking</h1>

      <section>
        <h2>Support / Tip Jar</h2>
        <p className="admin-meta">
          {support.total} total — {support.last7d} in the last 7 days, {support.last24h} in the last 24h.
        </p>

        {support.bySrc.length > 0 && (
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
              {support.bySrc.map((r) => (
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
        {support.recent.length === 0 ? (
          <p className="admin-meta">No clicks yet.</p>
        ) : (
          <table className="admin-clicks-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Source</th>
                <th>Referer</th>
              </tr>
            </thead>
            <tbody>
              {support.recent.map((r) => (
                <tr key={r.id}>
                  <td className="admin-meta">{new Date(r.clicked_at).toLocaleString()}</td>
                  <td><code>{r.src}</code></td>
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
