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

// Per-table summary. While volumes are low (likely months) this fetches every
// row to compute lifetime totals. If a table ever exceeds PostgREST's 1000-row
// default cap, promote to a DB view or RPC aggregation.
export async function getEmailLinkClicksSummary(): Promise<ClickSummary> {
  const supa = supabaseAdmin();
  const now = Date.now();
  const d1 = new Date(now - MS_DAY).toISOString();
  const d7 = new Date(now - 7 * MS_DAY).toISOString();

  const { data: allRows, error: e1 } = await supa
    .from("email_link_clicks")
    .select("src");
  if (e1) throw new Error(`email_link_clicks total: ${e1.message}`);

  const { data: recent7Rows, error: e2 } = await supa
    .from("email_link_clicks")
    .select("id, src, link_target, clicked_at, referer")
    .gte("clicked_at", d7)
    .order("clicked_at", { ascending: false });
  if (e2) throw new Error(`email_link_clicks 7d: ${e2.message}`);

  const total = allRows?.length ?? 0;
  const totalBySrc = new Map<string, number>();
  for (const r of allRows ?? []) {
    const s = r.src as string;
    totalBySrc.set(s, (totalBySrc.get(s) ?? 0) + 1);
  }

  const rows7d = (recent7Rows ?? []) as ClickRow[];
  const last7d = rows7d.length;
  const last24h = rows7d.filter((r) => r.clicked_at >= d1).length;

  const recent24hBySrc = new Map<string, number>();
  const recent7dBySrc = new Map<string, number>();
  for (const r of rows7d) {
    recent7dBySrc.set(r.src, (recent7dBySrc.get(r.src) ?? 0) + 1);
    if (r.clicked_at >= d1) {
      recent24hBySrc.set(r.src, (recent24hBySrc.get(r.src) ?? 0) + 1);
    }
  }

  // Sort by 7-day count descending so busy sources are on top; fall back to
  // alphabetical for ties so the long tail of zeros stays stable across loads.
  const bySrc: ClickSourceSummary[] = Array.from(totalBySrc.keys())
    .map((src) => ({
      src,
      total: totalBySrc.get(src) ?? 0,
      last7d: recent7dBySrc.get(src) ?? 0,
      last24h: recent24hBySrc.get(src) ?? 0,
    }))
    .sort((a, b) => b.last7d - a.last7d || a.src.localeCompare(b.src));

  return {
    total,
    last7d,
    last24h,
    bySrc,
    recent: rows7d.slice(0, 50),
  };
}
