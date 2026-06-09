import { requireAdmin } from "../require-admin";
import { listHistoricalGames, type HistoricalListFilters } from "@/lib/historical/queries";
import { todayMMDDInET } from "@/lib/dates";

export const dynamic = "force-dynamic";
export const metadata = { title: "Historical box scores · admin · boxscore", robots: { index: false } };

const GAME_TYPE_LABEL: Record<string, string> = {
  R: "Regular",
  S: "Spring",
  E: "Exhibition",
  A: "All-Star",
  F: "Wild Card",
  D: "Division",
  L: "LCS",
  W: "World Series",
  P: "Postseason",
};

type SearchParams = Record<string, string | string[] | undefined>;

function parseInt0(v: string | string[] | undefined): number | undefined {
  if (typeof v !== "string" || !v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function parseFilters(sp: SearchParams): HistoricalListFilters & { page: number; calendarDay?: string } {
  const page = Math.max(1, parseInt0(sp.page) ?? 1);
  // ?today=1 is shorthand for ?day=<today's MM-DD>. An explicit ?day overrides.
  let calendarDay: string | undefined;
  if (typeof sp.day === "string" && sp.day) calendarDay = sp.day;
  else if (sp.today === "1")               calendarDay = todayMMDDInET();
  return {
    season:      parseInt0(sp.season),
    fromDate:    typeof sp.from === "string" ? sp.from : undefined,
    toDate:      typeof sp.to   === "string" ? sp.to   : undefined,
    team:        typeof sp.team === "string" ? sp.team : undefined,
    minScore:    parseInt0(sp.min),
    gameType:    typeof sp.type === "string" ? sp.type : undefined,
    calendarDay,
    sort:        (typeof sp.sort === "string" ? sp.sort : "excitement") as HistoricalListFilters["sort"],
    limit:       50,
    offset:      (page - 1) * 50,
    page,
  } as HistoricalListFilters & { page: number; calendarDay?: string };
}

function buildPageHref(sp: SearchParams, page: number): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k === "page") continue;
    if (typeof v === "string" && v) params.set(k, v);
  }
  params.set("page", String(page));
  return `/admin/historical?${params.toString()}`;
}

export default async function HistoricalIndex({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const { rows, total } = await listHistoricalGames(filters);
  const pageCount = Math.max(1, Math.ceil(total / 50));

  const today = todayMMDDInET();
  const onCalendarDay = filters.calendarDay;

  return (
    <main className="admin">
      <h1>
        {onCalendarDay ? `On this day (${onCalendarDay})` : "Historical box scores"}
      </h1>
      <p className="admin-meta">
        {total.toLocaleString()} {onCalendarDay ? `games across all seasons on ${onCalendarDay}` : "games in store"}.
        Page {filters.page} of {pageCount.toLocaleString()}.
        Sort: {filters.sort ?? "excitement"}.
      </p>

      <p className="admin-meta" style={{ display: "flex", gap: 16, alignItems: "center", margin: "8px 0 16px" }}>
        <a
          href="/admin/historical?today=1"
          style={{
            padding: "4px 10px",
            border: "1px solid var(--border, #888)",
            borderRadius: 4,
            fontWeight: onCalendarDay === today ? 600 : 400,
            background: onCalendarDay === today ? "var(--accent, #eef)" : undefined,
          }}
        >
          Today ({today}) — any year
        </a>
        {onCalendarDay && onCalendarDay !== today ? (
          <span>
            Filtering to <b>{onCalendarDay}</b> · <a href="/admin/historical">clear</a>
          </span>
        ) : null}
        {!onCalendarDay ? <a href="/admin/historical" className="a-muted">All games</a> : null}
      </p>

      <form method="get" className="admin-meta" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end", margin: "12px 0 16px" }}>
        <label>
          <div>Season</div>
          <input type="number" name="season" defaultValue={sp.season as string ?? ""} min={1950} max={2026} style={{ width: 80 }} />
        </label>
        <label>
          <div>From</div>
          <input type="date" name="from" defaultValue={sp.from as string ?? ""} />
        </label>
        <label>
          <div>To</div>
          <input type="date" name="to" defaultValue={sp.to as string ?? ""} />
        </label>
        <label>
          <div>Team (abbr)</div>
          <input type="text" name="team" defaultValue={sp.team as string ?? ""} maxLength={4} style={{ width: 60, textTransform: "uppercase" }} />
        </label>
        <label>
          <div>Min score</div>
          <input type="number" name="min" defaultValue={sp.min as string ?? ""} style={{ width: 70 }} />
        </label>
        <label>
          <div>Day (MM-DD, any year)</div>
          <input type="text" name="day" defaultValue={sp.day as string ?? ""} placeholder="MM-DD" maxLength={5} style={{ width: 80 }} />
        </label>
        <label>
          <div>Type</div>
          <select name="type" defaultValue={sp.type as string ?? ""}>
            <option value="">Any</option>
            {Object.entries(GAME_TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          <div>Sort</div>
          <select name="sort" defaultValue={sp.sort as string ?? "excitement"}>
            <option value="excitement">Excitement (high → low)</option>
            <option value="date_desc">Date (newest first)</option>
            <option value="date_asc">Date (oldest first)</option>
          </select>
        </label>
        <button type="submit">Apply</button>
        <a href="/admin/historical" className="a-muted">Reset</a>
      </form>

      {rows.length === 0 ? (
        <p className="admin-meta">No games match these filters.</p>
      ) : (
        <table className="admin-clicks-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Matchup</th>
              <th style={{ textAlign: "right" }}>Score</th>
              <th style={{ textAlign: "right" }}>Inn</th>
              <th>Venue</th>
              <th style={{ textAlign: "right" }}>Excitement</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => {
              const a = g.away_team_abbr ?? `t${g.away_team_id}`;
              const h = g.home_team_abbr ?? `t${g.home_team_id}`;
              const notes = g.excitement_notes
                ? Object.entries(g.excitement_notes)
                    .filter(([, v]) => v !== 0)
                    .map(([k, v]) => `${k}+${v}`)
                    .join(" ")
                : "";
              return (
                <tr key={g.game_pk}>
                  <td><a href={`/admin/historical/${g.game_pk}`}>{g.game_date}</a></td>
                  <td>{g.game_type ? GAME_TYPE_LABEL[g.game_type] ?? g.game_type : ""}</td>
                  <td>{a} @ {h}</td>
                  <td style={{ textAlign: "right" }}>{g.away_score}–{g.home_score}</td>
                  <td style={{ textAlign: "right" }}>{g.innings}</td>
                  <td>{g.venue}</td>
                  <td style={{ textAlign: "right", fontWeight: 600 }}>{g.excitement_score}</td>
                  <td style={{ fontFamily: "monospace", fontSize: 12 }}>{notes}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {pageCount > 1 && (
        <nav className="admin-meta" style={{ display: "flex", gap: 8, marginTop: 16 }}>
          {filters.page > 1 && <a href={buildPageHref(sp, filters.page - 1)}>← Prev</a>}
          <span>Page {filters.page} of {pageCount}</span>
          {filters.page < pageCount && <a href={buildPageHref(sp, filters.page + 1)}>Next →</a>}
        </nav>
      )}
    </main>
  );
}
