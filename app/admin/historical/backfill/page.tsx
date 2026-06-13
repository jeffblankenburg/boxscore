import { requireAdmin } from "../../require-admin";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const metadata = { title: "Historical backfill · admin · boxscore", robots: { index: false } };

const FIRST_SEASON = 1950;
// Done criterion: backfill_progress.last_date_done equals the max
// game_date in historical_games for that season — i.e. the worker
// reached the last game we know about. Older versions of this page
// used a fixed Oct-20 threshold, which marked pre-2000 seasons as
// permanently "running" because their World Series often wrapped
// earlier than Oct 20. Per-season real-end-date lookup fixes that
// without depending on a calendar heuristic.
//
// For the current season, we also require the calendar to be past
// roughly the latest a season could plausibly run (Nov 10) — otherwise
// a caught-up worker mid-season would falsely flip to "done."
const CURRENT_SEASON_END_MMDD = "11-10";

type ProgressRow = {
  season: number;
  last_date_done: string | null;
  games_seen: number;
  games_ingested: number;
  failed_game_pks: number[] | null;
  finished_at: string;
};

type DisplayRow = {
  season: number;
  state: "done" | "in_progress" | "pending";
  lastDate: string | null;
  ingested: number;
  failed: number;
  fractionWithinSeason: number;
  lastCheckpointAt: string | null;
};

function fractionWithinSeason(lastDate: string | null, season: number): number {
  if (!lastDate) return 0;
  const m = lastDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return 0;
  const [, , mm, dd] = m;
  const monthDay = Number(mm) * 100 + Number(dd);
  // Treat Mar 25 → Nov 5 as the active window (day-of-year 80 → 310).
  const start = 325; // Mar 25 in MMDD
  const end = 1105;  // Nov 5
  if (monthDay <= start) return 0;
  if (monthDay >= end) return 1;
  // Linear in calendar days. Approximate but fine for a status bar.
  const sx = new Date(season, 2, 25).getTime();
  const ex = new Date(season, 10, 5).getTime();
  const cx = new Date(season, Number(mm) - 1, Number(dd)).getTime();
  return Math.max(0, Math.min(1, (cx - sx) / (ex - sx)));
}

async function loadSeasonEndDates(seasons: number[]): Promise<Map<number, string>> {
  // Per-season max(game_date) from historical_games. PostgREST has no
  // GROUP BY, so we issue one parallel query per season — the seasons
  // list is bounded (≤ ~80 entries) and each query is an indexed
  // ORDER BY ... LIMIT 1, so this is cheap.
  const db = supabaseAdmin();
  const results = await Promise.all(seasons.map(async (s) => {
    const { data } = await db
      .from("historical_games")
      .select("game_date")
      .eq("season", s)
      .order("game_date", { ascending: false })
      .limit(1);
    return [s, (data?.[0] as { game_date: string } | undefined)?.game_date ?? null] as const;
  }));
  const out = new Map<number, string>();
  for (const [s, d] of results) if (d) out.set(s, d);
  return out;
}

async function loadProgress(): Promise<DisplayRow[]> {
  const currentYear = new Date().getUTCFullYear();
  const seasons: number[] = [];
  for (let y = FIRST_SEASON; y <= currentYear; y++) seasons.push(y);

  const [{ data, error }, seasonEnds] = await Promise.all([
    supabaseAdmin()
      .from("backfill_progress")
      .select("season,last_date_done,games_seen,games_ingested,failed_game_pks,finished_at")
      .eq("job", "historical-boxscores")
      .gte("season", FIRST_SEASON)
      .lte("season", currentYear)
      .order("season", { ascending: true }),
    loadSeasonEndDates(seasons),
  ]);
  if (error) throw new Error(`loadProgress: ${error.message}`);
  const bySeason = new Map<number, ProgressRow>(
    ((data ?? []) as ProgressRow[]).map((r) => [r.season, r]),
  );

  const today = new Date();
  const todayMMDD = `${String(today.getUTCMonth() + 1).padStart(2, "0")}-${String(today.getUTCDate()).padStart(2, "0")}`;

  const out: DisplayRow[] = [];
  for (let y = FIRST_SEASON; y <= currentYear; y++) {
    const r = bySeason.get(y);
    if (!r) {
      out.push({
        season: y,
        state: "pending",
        lastDate: null,
        ingested: 0,
        failed: 0,
        fractionWithinSeason: 0,
        lastCheckpointAt: null,
      });
      continue;
    }
    const failed = r.failed_game_pks?.length ?? 0;
    const seasonEnd = seasonEnds.get(y) ?? null;
    // Past seasons: done iff we reached the actual last game in
    // historical_games. Current season: same condition plus the
    // calendar must be past CURRENT_SEASON_END_MMDD, otherwise a
    // caught-up worker would falsely flip to done mid-season.
    const reachedEnd = seasonEnd != null
      && r.last_date_done != null
      && r.last_date_done >= seasonEnd;
    const calendarAllowsDone = y < currentYear
      || todayMMDD >= CURRENT_SEASON_END_MMDD;
    const isDone = reachedEnd && calendarAllowsDone;
    out.push({
      season: y,
      state: isDone ? "done" : "in_progress",
      lastDate: r.last_date_done,
      ingested: r.games_ingested,
      failed,
      fractionWithinSeason: isDone ? 1 : fractionWithinSeason(r.last_date_done, y),
      lastCheckpointAt: r.finished_at,
    });
  }
  return out;
}

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.round(ms / 1000);
  if (s < 60)    return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60)    return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24)    return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

export default async function HistoricalBackfillStatus() {
  await requireAdmin();
  const rows = await loadProgress();

  const totals = {
    done:       rows.filter((r) => r.state === "done").length,
    inProgress: rows.filter((r) => r.state === "in_progress").length,
    pending:    rows.filter((r) => r.state === "pending").length,
    ingested:   rows.reduce((s, r) => s + r.ingested, 0),
    failed:     rows.reduce((s, r) => s + r.failed,   0),
  };

  const mostRecentCheckpoint = rows
    .map((r) => r.lastCheckpointAt)
    .filter((s): s is string => Boolean(s))
    .sort()
    .pop() ?? null;

  return (
    <main className="admin">
      {/* The browser-level meta refresh is the cheapest way to give the
          operator live-ish progress without wiring up a polling client
          component or websockets. */}
      <meta httpEquiv="refresh" content="30" />
      <p className="admin-meta">
        <a href="/admin/historical">← Back to historical index</a>
      </p>
      <h1>Historical backfill</h1>
      <p className="admin-meta">
        {totals.ingested.toLocaleString()} games ingested · {totals.failed} failed ·
        {" "}{totals.done} seasons done · {totals.inProgress} in progress · {totals.pending} not started.
        {" "}Last checkpoint {relativeTime(mostRecentCheckpoint)}. Page refreshes every 30s.
      </p>

      <table className="admin-clicks-table" style={{ marginTop: 12 }}>
        <thead>
          <tr>
            <th>Season</th>
            <th>State</th>
            <th>Last date done</th>
            <th style={{ textAlign: "right" }}>Ingested</th>
            <th style={{ textAlign: "right" }}>Failed</th>
            <th style={{ width: "30%" }}>Progress</th>
            <th>Checkpointed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const filled = Math.round(r.fractionWithinSeason * 100);
            const barColor = r.state === "done"
              ? "var(--admin-team-ok, #1f6f3a)"
              : r.state === "in_progress"
                ? "var(--accent, #5470c6)"
                : "transparent";
            return (
              <tr key={r.season}>
                <td>{r.season}</td>
                <td>
                  <span className={
                    r.state === "done"        ? "admin-team-ok"
                    : r.state === "in_progress" ? "admin-team-empty"
                    : "admin-team-bad"
                  }>
                    {r.state === "done" ? "DONE" : r.state === "in_progress" ? "running" : "pending"}
                  </span>
                </td>
                <td>{r.lastDate ?? "—"}</td>
                <td style={{ textAlign: "right" }}>{r.ingested ? r.ingested.toLocaleString() : "—"}</td>
                <td style={{ textAlign: "right", fontWeight: r.failed > 0 ? 600 : 400 }}>
                  {r.failed > 0 ? r.failed : "—"}
                </td>
                <td>
                  <div style={{
                    position: "relative",
                    width: "100%",
                    height: 8,
                    background: "rgba(0,0,0,0.08)",
                    borderRadius: 2,
                    overflow: "hidden",
                  }}>
                    <div style={{
                      width: `${filled}%`,
                      height: "100%",
                      background: barColor,
                    }} />
                  </div>
                  <div style={{ fontSize: 11, color: "var(--muted, #888)", marginTop: 2 }}>
                    {r.state === "done" ? "100%" : r.state === "in_progress" ? `${filled}%` : ""}
                  </div>
                </td>
                <td style={{ fontSize: 12, color: "var(--muted, #888)" }}>
                  {relativeTime(r.lastCheckpointAt)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}
