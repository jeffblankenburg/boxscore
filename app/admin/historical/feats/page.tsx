import { requireAdmin } from "../../require-admin";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const metadata = { title: "Historical player-line feats · admin · boxscore", robots: { index: false } };

type SearchParams = Record<string, string | string[] | undefined>;

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

async function loadRows(sp: SearchParams): Promise<{ rows: FeatRow[]; total: number; page: number; pageCount: number }> {
  const db = supabaseAdmin();
  const page = Math.max(1, parseInt0(sp.page) ?? 1);
  const limit = 50;
  const offset = (page - 1) * limit;
  const season    = parseInt0(sp.season);
  const minScore  = parseInt0(sp.min) ?? 1;
  const lineType  = typeof sp.type === "string" ? sp.type : undefined;
  const player    = typeof sp.player === "string" ? sp.player.trim() : undefined;
  const sort = typeof sp.sort === "string" ? sp.sort : "feat";

  // Count query.
  let cq = db.from("historical_player_lines").select("id", { count: "exact", head: true });
  if (season != null) cq = cq.eq("season", season);
  if (minScore > 0)   cq = cq.gte("feat_score", minScore);
  if (lineType)       cq = cq.eq("line_type", lineType);
  if (player)         cq = cq.ilike("player_name", `%${player}%`);
  const { count, error: cerr } = await cq;
  if (cerr) throw new Error(`feats count: ${cerr.message}`);

  let q = db
    .from("historical_player_lines")
    .select("id,game_pk,game_date,season,player_name,team_abbr,opp_team_abbr,line_type,batting_stats,pitching_stats,feat_score,feat_notes");
  if (season != null) q = q.eq("season", season);
  if (minScore > 0)   q = q.gte("feat_score", minScore);
  if (lineType)       q = q.eq("line_type", lineType);
  if (player)         q = q.ilike("player_name", `%${player}%`);
  if (sort === "date_desc")    q = q.order("game_date", { ascending: false });
  else if (sort === "date_asc") q = q.order("game_date", { ascending: true });
  else                          q = q.order("feat_score", { ascending: false });
  q = q.range(offset, offset + limit - 1);
  const { data, error } = await q;
  if (error) throw new Error(`feats data: ${error.message}`);

  const total = count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / limit));
  return { rows: (data ?? []) as unknown as FeatRow[], total, page, pageCount };
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

export default async function FeatsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const { rows, total, page, pageCount } = await loadRows(sp);

  return (
    <main className="admin">
      <h1>Player-line feats</h1>
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
        <label>
          <div>Sort</div>
          <select name="sort" defaultValue={sp.sort as string ?? "feat"}>
            <option value="feat">Feat score (high → low)</option>
            <option value="date_desc">Date (newest first)</option>
            <option value="date_asc">Date (oldest first)</option>
          </select>
        </label>
        <button type="submit">Apply</button>
        <a href="/admin/historical/feats" className="a-muted">Reset</a>
      </form>

      {rows.length === 0 ? (
        <p className="admin-meta">No lines match these filters.</p>
      ) : (
        <table className="admin-clicks-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Player</th>
              <th>Type</th>
              <th>Matchup</th>
              <th>Stat line</th>
              <th style={{ textAlign: "right" }}>Feat</th>
              <th>Why</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
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
              </tr>
            ))}
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
