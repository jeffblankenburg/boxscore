import { supabaseAdmin } from "./supabase";

// Row + summary shapes for email_link_clicks. Every entry records the
// resolved destination URL (link_target), so the admin page can show
// what the user actually went to without cross-referencing the email
// template.
//
// support_clicks still receives writes (web-header and footer Tip Jar
// paths route through /r/support), but the in-email Tip Jar click
// moved to email_link_clicks (email-header-tip / team-email-header-tip
// / welcome-header-tip). If a support_clicks view is needed later,
// restore the helper from git history.

export type ClickRow = {
  id: number;
  src: string;
  link_target: string | null;
  clicked_at: string;
  referer: string | null;
};

export type ClickSourceSummary = {
  src: string;
  total: number;
  last7d: number;
  last24h: number;
};

export type ClickSummary = {
  total: number;
  last7d: number;
  last24h: number;
  bySrc: ClickSourceSummary[];
  recent: ClickRow[];
};

const MS_DAY = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 1000;

// Per-table summary. Totals + 7d + 24h come from cheap server-side count()
// queries (no row pull); per-src aggregation paginates the full table
// (PostgREST has no GROUP BY). If src cardinality stays in the dozens this
// will be fine for years; if it ever feels slow, promote to a SQL view.
export async function getEmailLinkClicksSummary(): Promise<ClickSummary> {
  const supa = supabaseAdmin();
  const now = Date.now();
  const d1 = new Date(now - MS_DAY).toISOString();
  const d7 = new Date(now - 7 * MS_DAY).toISOString();

  // Cheap counts: server returns the count header without shipping rows.
  // Caps at PostgREST's 1000-row default do not apply to count-only queries.
  const [totalQ, last7dQ, last24hQ, recentQ] = await Promise.all([
    supa.from("email_link_clicks").select("id", { count: "exact", head: true }),
    supa.from("email_link_clicks").select("id", { count: "exact", head: true }).gte("clicked_at", d7),
    supa.from("email_link_clicks").select("id", { count: "exact", head: true }).gte("clicked_at", d1),
    supa.from("email_link_clicks")
      .select("id, src, link_target, clicked_at, referer")
      .order("clicked_at", { ascending: false })
      .limit(50),
  ]);
  if (totalQ.error)   throw new Error(`email_link_clicks total: ${totalQ.error.message}`);
  if (last7dQ.error)  throw new Error(`email_link_clicks 7d: ${last7dQ.error.message}`);
  if (last24hQ.error) throw new Error(`email_link_clicks 24h: ${last24hQ.error.message}`);
  if (recentQ.error)  throw new Error(`email_link_clicks recent: ${recentQ.error.message}`);

  // Per-src totals: paginate the whole table. Each row is just (src,
  // clicked_at) — small payload. Aggregation runs in JS.
  const totalBySrc   = new Map<string, number>();
  const last7dBySrc  = new Map<string, number>();
  const last24hBySrc = new Map<string, number>();
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supa
      .from("email_link_clicks")
      .select("src, clicked_at")
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`email_link_clicks paginated scan: ${error.message}`);
    const page = (data ?? []) as Array<{ src: string; clicked_at: string }>;
    for (const r of page) {
      totalBySrc.set(r.src, (totalBySrc.get(r.src) ?? 0) + 1);
      if (r.clicked_at >= d7) last7dBySrc.set(r.src, (last7dBySrc.get(r.src) ?? 0) + 1);
      if (r.clicked_at >= d1) last24hBySrc.set(r.src, (last24hBySrc.get(r.src) ?? 0) + 1);
    }
    if (page.length < PAGE_SIZE) break;
  }

  // Sort by 7-day count descending so busy sources are on top; fall back to
  // alphabetical for ties so the long tail of zeros stays stable across loads.
  const bySrc: ClickSourceSummary[] = Array.from(totalBySrc.keys())
    .map((src) => ({
      src,
      total:   totalBySrc.get(src)   ?? 0,
      last7d:  last7dBySrc.get(src)  ?? 0,
      last24h: last24hBySrc.get(src) ?? 0,
    }))
    .sort((a, b) => b.last7d - a.last7d || a.src.localeCompare(b.src));

  return {
    total:   totalQ.count   ?? 0,
    last7d:  last7dQ.count  ?? 0,
    last24h: last24hQ.count ?? 0,
    bySrc,
    recent: (recentQ.data ?? []) as ClickRow[],
  };
}
