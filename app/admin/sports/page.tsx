import { requireAdmin } from "../require-admin";
import { AdminNav } from "../AdminNav";
import { SubmitButton } from "../SubmitButton";
import { getAllSports } from "@/lib/sports";
import { toggleSportVisibility } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sports · admin · boxscore", robots: { index: false } };

export default async function AdminSportsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  await requireAdmin();
  const { ok, error } = await searchParams;
  const sports = await getAllSports();

  return (
    <main className="admin">
      <AdminNav />
      <h1>Sports</h1>

      {ok && <p className="admin-success"><strong>✓</strong> {ok}</p>}
      {error && <p className="admin-error"><strong>Failed:</strong> {error}</p>}

      <p className="admin-meta">
        Visibility controls which sports appear in public lists (subscribe form,
        /settings). admin_only sports still run their crons and accumulate
        digests — they're just hidden from non-admin users. Flip to public to
        launch.
      </p>

      <table className="admin-sports">
        <thead>
          <tr>
            <th>ID</th>
            <th>Name</th>
            <th>Visibility</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {sports.map((s) => {
            const nextValue = s.visibility === "public" ? "admin_only" : "public";
            const actionLabel = s.visibility === "public" ? "Hide" : "Publish";
            return (
              <tr key={s.id}>
                <td><code>{s.id}</code></td>
                <td>{s.name}</td>
                <td><span className={`sport-vis sport-vis-${s.visibility}`}>{s.visibility}</span></td>
                <td>
                  <form action={toggleSportVisibility}>
                    <input type="hidden" name="sport" value={s.id} />
                    <input type="hidden" name="next" value={nextValue} />
                    <SubmitButton idleLabel={actionLabel} pendingLabel="Saving…" />
                  </form>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}
