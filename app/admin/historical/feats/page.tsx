import { requireAdmin } from "../../require-admin";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const metadata = { title: "Historical player-line feats · admin · boxscore", robots: { index: false } };

type SearchParams = Record<string, string | string[] | undefined>;

type DecadeBucket = { batting: number; pitching: number };
type Top700Summary = {
  byDecade: Record<string, DecadeBucket>;
  totals:   DecadeBucket;
};

// Pull the top 700 lines by feat_score (the picker's pool size) and
// roll them up by decade + line_type. Server component so the charts
// reflect whatever is currently in the DB — no client roundtrip.
async function loadTop700Summary(): Promise<Top700Summary> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("historical_player_lines")
    .select("game_date, line_type")
    .order("feat_score", { ascending: false })
    .limit(700);
  if (error) throw new Error(`top700 summary: ${error.message}`);
  const byDecade: Record<string, DecadeBucket> = {};
  const totals: DecadeBucket = { batting: 0, pitching: 0 };
  for (const r of (data ?? []) as Array<{ game_date: string; line_type: "batting" | "pitching" }>) {
    const year = Number(r.game_date.slice(0, 4));
    const decade = `${Math.floor(year / 10) * 10}s`;
    if (!byDecade[decade]) byDecade[decade] = { batting: 0, pitching: 0 };
    byDecade[decade][r.line_type]++;
    totals[r.line_type]++;
  }
  return { byDecade, totals };
}

const BAT_COLOR = "#1f7a3a";        // green — matches DONE bar on backfill page
const PIT_COLOR = "#3a5fcc";        // blue — matches "running" bar on backfill page

// Map of historical_player_lines.id → puzzle_date for every line that
// the Linescordle picker has already used. subject_ref is stored as
// "line-{id}" (see lib/games/linescordle/picker.ts). If a line was
// somehow picked on multiple days, the more recent date wins.
async function loadUsedLinescordlePicks(): Promise<Map<number, string>> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("puzzle_picks")
    .select("subject_ref, puzzle_date")
    .eq("game", "linescordle")
    .order("puzzle_date", { ascending: true });
  if (error) throw new Error(`used picks: ${error.message}`);
  const map = new Map<number, string>();
  for (const r of (data ?? []) as Array<{ subject_ref: string; puzzle_date: string }>) {
    const m = r.subject_ref.match(/^line-(\d+)$/);
    if (m && m[1]) map.set(Number(m[1]), r.puzzle_date);
  }
  return map;
}

type FeatRow = {
  id: number;
  game_pk: number;
  game_date: string;
  season: number;
  player_name: string;
  team_abbr: string | null;
  opp_team_abbr: string | null;
  line_type: "batting" | "pitching";
  batting_stats: Record<string, number> | null;
  pitching_stats: Record<string, string | number> | null;
  feat_score: number;
  feat_notes: Record<string, number> | null;
};

function parseInt0(v: string | string[] | undefined): number | undefined {
  if (typeof v !== "string" || !v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// Map a sort param ("feat", "feat_desc", "player_asc", etc.) to a
// (column, ascending) tuple. Backward-compat: bare "feat" or "date"
// without a direction defaults to feat_desc / date_desc respectively.
const SORT_COLUMN: Record<string, string> = {
  feat:    "feat_score",
  date:    "game_date",
  player:  "player_name",
  type:    "line_type",
  matchup: "team_abbr",
};
// "used" is a special field — not a column on historical_player_lines.
// When active, loadRows takes a different path that filters to only
// rows that have been picked, ordered by puzzle_date.
const USED_SORT_FIELD = "used";
function parseSort(sort: string | undefined): { field: string; column: string | null; ascending: boolean; key: string } {
  const raw = (sort ?? "feat").toLowerCase();
  const [rawField, dirRaw] = raw.split("_");
  const field = rawField && (SORT_COLUMN[rawField] || rawField === USED_SORT_FIELD) ? rawField : "feat";
  const ascending = dirRaw === "asc";
  return {
    field,
    column: SORT_COLUMN[field] ?? null,
    ascending,
    key: `${field}_${ascending ? "asc" : "desc"}`,
  };
}

const ROW_SELECT = "id,game_pk,game_date,season,player_name,team_abbr,opp_team_abbr,line_type,batting_stats,pitching_stats,feat_score,feat_notes";
const PAGE_LIMIT = 50;

async function loadRows(sp: SearchParams): Promise<{ rows: FeatRow[]; total: number; page: number; pageCount: number; sortKey: string }> {
  const db = supabaseAdmin();
  const page = Math.max(1, parseInt0(sp.page) ?? 1);
  const offset = (page - 1) * PAGE_LIMIT;
  const season    = parseInt0(sp.season);
  const minScore  = parseInt0(sp.min) ?? 1;
  const lineType  = typeof sp.type === "string" ? sp.type : undefined;
  const player    = typeof sp.player === "string" ? sp.player.trim() : undefined;
  const sortSpec = parseSort(typeof sp.sort === "string" ? sp.sort : undefined);

  // Used-sort path: narrow to lines that have been picked, ordered by
  // puzzle_date. Used picks count is tiny (one per day), so we can do
  // the ordering + pagination in memory cheaply.
  if (sortSpec.field === USED_SORT_FIELD) {
    const { data: picks, error: perr } = await db
      .from("puzzle_picks")
      .select("subject_ref, puzzle_date")
      .eq("game", "linescordle")
      .order("puzzle_date", { ascending: sortSpec.ascending });
    if (perr) throw new Error(`used picks: ${perr.message}`);
    const lineIds: number[] = [];
    for (const r of (picks ?? []) as Array<{ subject_ref: string; puzzle_date: string }>) {
      const m = r.subject_ref.match(/^line-(\d+)$/);
      if (m && m[1]) lineIds.push(Number(m[1]));
    }

    if (lineIds.length === 0) {
      return { rows: [], total: 0, page, pageCount: 1, sortKey: sortSpec.key };
    }

    // Fetch all matching line rows (subject to the same column filters).
    let q = db.from("historical_player_lines").select(ROW_SELECT).in("id", lineIds);
    if (season != null) q = q.eq("season", season);
    if (minScore > 0)   q = q.gte("feat_score", minScore);
    if (lineType)       q = q.eq("line_type", lineType);
    if (player)         q = q.ilike("player_name", `%${player}%`);
    const { data: matched, error: derr } = await q;
    if (derr) throw new Error(`used rows: ${derr.message}`);
    const rowById = new Map((matched as unknown as FeatRow[] ?? []).map((r) => [r.id, r]));

    // Preserve the puzzle_date ordering and drop ids that didn't pass filters.
    const ordered: FeatRow[] = [];
    for (const id of lineIds) {
      const row = rowById.get(id);
      if (row) ordered.push(row);
    }

    const total = ordered.length;
    const pageCount = Math.max(1, Math.ceil(total / PAGE_LIMIT));
    return {
      rows:     ordered.slice(offset, offset + PAGE_LIMIT),
      total,
      page,
      pageCount,
      sortKey:  sortSpec.key,
    };
  }

  // Default path: ordered by a real column on historical_player_lines.
  // Count query.
  let cq = db.from("historical_player_lines").select("id", { count: "exact", head: true });
  if (season != null) cq = cq.eq("season", season);
  if (minScore > 0)   cq = cq.gte("feat_score", minScore);
  if (lineType)       cq = cq.eq("line_type", lineType);
  if (player)         cq = cq.ilike("player_name", `%${player}%`);
  const { count, error: cerr } = await cq;
  if (cerr) throw new Error(`feats count: ${cerr.message}`);

  let q = db.from("historical_player_lines").select(ROW_SELECT);
  if (season != null) q = q.eq("season", season);
  if (minScore > 0)   q = q.gte("feat_score", minScore);
  if (lineType)       q = q.eq("line_type", lineType);
  if (player)         q = q.ilike("player_name", `%${player}%`);
  q = q.order(sortSpec.column!, { ascending: sortSpec.ascending });
  q = q.range(offset, offset + PAGE_LIMIT - 1);
  const { data, error } = await q;
  if (error) throw new Error(`feats data: ${error.message}`);

  const total = count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_LIMIT));
  return { rows: (data ?? []) as unknown as FeatRow[], total, page, pageCount, sortKey: sortSpec.key };
}

function Top700Charts({ summary }: { summary: Top700Summary }) {
  const decades = Object.keys(summary.byDecade).sort();
  // Max-total across decades drives bar width so the decade with the
  // most lines fills the row; others shrink proportionally.
  const maxTotal = Math.max(1, ...decades.map((d) => {
    const b = summary.byDecade[d]!;
    return b.batting + b.pitching;
  }));
  const grandTotal = summary.totals.batting + summary.totals.pitching;
  const batPct = grandTotal === 0 ? 0 : (summary.totals.batting  / grandTotal) * 100;
  const pitPct = grandTotal === 0 ? 0 : (summary.totals.pitching / grandTotal) * 100;

  return (
    <section style={{ margin: "0 0 24px", padding: "12px 14px", border: "1px solid #d4d4d4", borderRadius: 4 }}>
      <h2 style={{ margin: "0 0 4px", fontSize: 14, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        Top 700 picker pool
      </h2>
      <p className="admin-meta" style={{ margin: "0 0 12px" }}>
        Lines sorted by feat_score (descending). This is the pool the Linescordle daily picker draws from.{" "}
        <span style={{ display: "inline-block", width: 10, height: 10, background: BAT_COLOR, verticalAlign: "middle", marginRight: 4 }} /> batting
        {"  "}
        <span style={{ display: "inline-block", width: 10, height: 10, background: PIT_COLOR, verticalAlign: "middle", marginRight: 4, marginLeft: 12 }} /> pitching
      </p>

      {/* Overall split */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
          Overall — batting {summary.totals.batting} ({batPct.toFixed(1)}%) · pitching {summary.totals.pitching} ({pitPct.toFixed(1)}%)
        </div>
        <div style={{ display: "flex", height: 18, background: "#eee", borderRadius: 2, overflow: "hidden" }}>
          <div style={{ width: `${batPct}%`, background: BAT_COLOR }} title={`batting ${summary.totals.batting}`} />
          <div style={{ width: `${pitPct}%`, background: PIT_COLOR }} title={`pitching ${summary.totals.pitching}`} />
        </div>
      </div>

      {/* Per-decade stacked bars */}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ color: "#666" }}>
            <th style={{ textAlign: "left",  padding: "4px 8px 4px 0", width: 60 }}>Decade</th>
            <th style={{ textAlign: "right", padding: "4px 8px",       width: 50 }}>Bat</th>
            <th style={{ textAlign: "right", padding: "4px 8px",       width: 50 }}>Pit</th>
            <th style={{ textAlign: "right", padding: "4px 8px",       width: 60 }}>Total</th>
            <th style={{ textAlign: "left",  padding: "4px 8px",                 }}>Distribution (bar width = decade total relative to largest)</th>
          </tr>
        </thead>
        <tbody>
          {decades.map((d) => {
            const b = summary.byDecade[d]!;
            const total = b.batting + b.pitching;
            const rowPct = (total / maxTotal) * 100;
            const batShare = total === 0 ? 0 : (b.batting / total) * 100;
            const pitShare = total === 0 ? 0 : (b.pitching / total) * 100;
            return (
              <tr key={d}>
                <td style={{ padding: "4px 8px 4px 0", fontFamily: "ui-monospace, monospace" }}>{d}</td>
                <td style={{ padding: "4px 8px", textAlign: "right", fontFamily: "ui-monospace, monospace" }}>{b.batting}</td>
                <td style={{ padding: "4px 8px", textAlign: "right", fontFamily: "ui-monospace, monospace" }}>{b.pitching}</td>
                <td style={{ padding: "4px 8px", textAlign: "right", fontFamily: "ui-monospace, monospace", fontWeight: 700 }}>{total}</td>
                <td style={{ padding: "4px 8px" }}>
                  <div style={{ width: `${rowPct}%`, minWidth: 1, display: "flex", height: 14, background: "#eee", borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ width: `${batShare}%`, background: BAT_COLOR }} title={`batting ${b.batting}`} />
                    <div style={{ width: `${pitShare}%`, background: PIT_COLOR }} title={`pitching ${b.pitching}`} />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function statSummary(r: FeatRow): string {
  if (r.line_type === "batting" && r.batting_stats) {
    const b = r.batting_stats as Record<string, number>;
    const parts: string[] = [];
    if ((b.hits ?? 0) > 0)    parts.push(`${b.hits}-for-${b.atBats}`);
    if ((b.homeRuns ?? 0) > 0) parts.push(`${b.homeRuns} HR`);
    if ((b.rbi ?? 0) > 0)     parts.push(`${b.rbi} RBI`);
    if ((b.runs ?? 0) > 0)    parts.push(`${b.runs} R`);
    if ((b.stolenBases ?? 0) > 0) parts.push(`${b.stolenBases} SB`);
    return parts.join(", ");
  }
  if (r.line_type === "pitching" && r.pitching_stats) {
    const p = r.pitching_stats as Record<string, string | number>;
    const parts: string[] = [];
    if (p.inningsPitched) parts.push(`${p.inningsPitched} IP`);
    if (typeof p.hits === "number")        parts.push(`${p.hits} H`);
    if (typeof p.earnedRuns === "number")  parts.push(`${p.earnedRuns} ER`);
    if (typeof p.baseOnBalls === "number") parts.push(`${p.baseOnBalls} BB`);
    if (typeof p.strikeOuts === "number")  parts.push(`${p.strikeOuts} K`);
    return parts.join(", ");
  }
  return "";
}

function notesSummary(notes: Record<string, number> | null): string {
  if (!notes) return "";
  return Object.entries(notes)
    .filter(([, v]) => v !== 0)
    .map(([k, v]) => `${k}+${v}`)
    .join(" · ");
}

function pageHref(sp: SearchParams, page: number): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k === "page") continue;
    if (typeof v === "string" && v) p.set(k, v);
  }
  p.set("page", String(page));
  return `/admin/historical/feats?${p.toString()}`;
}

// Returns the URL for clicking a sortable column header. If the column
// is already the active sort, flip its direction; otherwise sort by
// the new column descending (the more useful default for feat / date).
function sortHref(sp: SearchParams, field: string, currentKey: string): string {
  const [activeField, activeDir] = currentKey.split("_");
  const nextDir =
    activeField === field
      ? (activeDir === "asc" ? "desc" : "asc")
      : "desc";
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k === "sort" || k === "page") continue;
    if (typeof v === "string" && v) p.set(k, v);
  }
  p.set("sort", `${field}_${nextDir}`);
  return `/admin/historical/feats?${p.toString()}`;
}

function SortableTh({
  field, label, sp, currentKey, align,
}: {
  field: string;
  label: string;
  sp: SearchParams;
  currentKey: string;
  align?: "left" | "right";
}) {
  const [activeField, activeDir] = currentKey.split("_");
  const isActive = activeField === field;
  const arrow = !isActive ? "" : activeDir === "asc" ? " ↑" : " ↓";
  return (
    <th style={{ textAlign: align ?? "left" }}>
      <a
        href={sortHref(sp, field, currentKey)}
        style={{
          color:           "inherit",
          textDecoration:  isActive ? "underline" : "none",
          fontWeight:      isActive ? 700 : "inherit",
        }}
      >
        {label}{arrow}
      </a>
    </th>
  );
}

export default async function FeatsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const [{ rows, total, page, pageCount, sortKey }, summary, usedPicks] = await Promise.all([
    loadRows(sp),
    loadTop700Summary(),
    loadUsedLinescordlePicks(),
  ]);

  return (
    <main className="admin">
      <h1>Player-line feats</h1>

      <Top700Charts summary={summary} />

      <p className="admin-meta">
        {total.toLocaleString()} lines match the filters. Page {page} of {pageCount.toLocaleString()}.
      </p>

      <form
        method="get"
        className="admin-meta"
        style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end", margin: "12px 0 16px" }}
      >
        <label>
          <div>Season</div>
          <input type="number" name="season" defaultValue={sp.season as string ?? ""} min={1950} max={2026} style={{ width: 80 }} />
        </label>
        <label>
          <div>Player (search)</div>
          <input type="text" name="player" defaultValue={sp.player as string ?? ""} style={{ width: 160 }} />
        </label>
        <label>
          <div>Min score</div>
          <input type="number" name="min" defaultValue={sp.min as string ?? "1"} style={{ width: 70 }} />
        </label>
        <label>
          <div>Type</div>
          <select name="type" defaultValue={sp.type as string ?? ""}>
            <option value="">Any</option>
            <option value="batting">Batting</option>
            <option value="pitching">Pitching</option>
          </select>
        </label>
        {/* Sort is now driven by clickable column headers. The hidden
            field preserves the active sort across filter changes. */}
        <input type="hidden" name="sort" value={sortKey} />
        <button type="submit">Apply</button>
        <a href="/admin/historical/feats" className="a-muted">Reset</a>
      </form>

      {rows.length === 0 ? (
        <p className="admin-meta">No lines match these filters.</p>
      ) : (
        <table className="admin-clicks-table">
          <thead>
            <tr>
              <SortableTh field="date"    label="Date"    sp={sp} currentKey={sortKey} />
              <SortableTh field="player"  label="Player"  sp={sp} currentKey={sortKey} />
              <SortableTh field="type"    label="Type"    sp={sp} currentKey={sortKey} />
              <SortableTh field="matchup" label="Matchup" sp={sp} currentKey={sortKey} />
              <th>Stat line</th>
              <SortableTh field="feat"    label="Feat"    sp={sp} currentKey={sortKey} align="right" />
              <th>Why</th>
              <SortableTh field="used"    label="Used"    sp={sp} currentKey={sortKey} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const usedOn = usedPicks.get(r.id);
              return (
                <tr key={r.id} style={usedOn ? { background: "#f5f0e8" } : undefined}>
                  <td>
                    <a href={`/admin/historical/${r.game_pk}`}>{r.game_date}</a>
                  </td>
                  <td>{r.player_name}</td>
                  <td style={{ fontSize: 11, textTransform: "uppercase" }}>{r.line_type}</td>
                  <td>{r.team_abbr ?? "—"} vs {r.opp_team_abbr ?? "—"}</td>
                  <td style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }}>{statSummary(r)}</td>
                  <td style={{ textAlign: "right", fontWeight: 700 }}>{r.feat_score}</td>
                  <td style={{ fontSize: 11, fontFamily: "ui-monospace, monospace" }}>
                    {notesSummary(r.feat_notes)}
                  </td>
                  <td style={{ fontSize: 11, fontFamily: "ui-monospace, monospace", color: usedOn ? "#7a4a1f" : "#bbb" }}>
                    {usedOn ?? "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {pageCount > 1 && (
        <nav className="admin-meta" style={{ display: "flex", gap: 8, marginTop: 16 }}>
          {page > 1 && <a href={pageHref(sp, page - 1)}>← Prev</a>}
          <span>Page {page} of {pageCount}</span>
          {page < pageCount && <a href={pageHref(sp, page + 1)}>Next →</a>}
        </nav>
      )}
    </main>
  );
}
