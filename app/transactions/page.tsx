import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";
import { parseTransactions, type Transaction } from "@/lib/mlb";
import { teamsBySport, findTeam } from "@/lib/teams";
import { todayInET } from "@/lib/dates";
import { EMAIL_LINK_BASE } from "@/lib/site";
import { TransactionChart, type ChartPoint } from "./transaction-chart";
import "./transactions.css";

export const dynamic = "force-dynamic";

type Category =
  | "rehab"
  | "il_activated"
  | "dfa"
  | "il_placed"
  | "il_60day"
  | "milb_signed"
  | "optioned"
  | "outrighted"
  | "selected"
  | "recalled"
  | "claimed"
  | "off_bereavement"
  | "on_bereavement"
  | "on_restricted";

const COLUMNS: { key: Category; label: string }[] = [
  { key: "rehab", label: "Assigned rehab" },
  { key: "il_activated", label: "Activated IL" },
  { key: "dfa", label: "Designated for assignment" },
  { key: "il_placed", label: "Placed on IL" },
  { key: "il_60day", label: "Transferred to 60-day IL" },
  { key: "milb_signed", label: "Signed MiLB deal" },
  { key: "optioned", label: "Optioned" },
  { key: "outrighted", label: "Outrighted" },
  { key: "selected", label: "Selected to 40-man" },
  { key: "recalled", label: "Recalled" },
  { key: "claimed", label: "Claimed off waivers" },
  { key: "off_bereavement", label: "Off bereavement" },
  { key: "on_bereavement", label: "On bereavement" },
  { key: "on_restricted", label: "On restricted list" },
];

// SC (Status Change) is an umbrella for IL/bereavement/restricted moves.
// Verb + list-type in the pre-written description is the only way to
// subcategorize. Patterns were calibrated against live daily_raw data.
function categorize(t: Transaction): Category | null {
  const desc = t.description.toLowerCase();
  switch (t.typeCode) {
    case "DES": return "dfa";
    case "OPT": return "optioned";
    case "OUT": return "outrighted";
    case "SE":  return "selected";
    case "CU":  return "recalled";
    case "CLW": return "claimed";
    case "ASG":
      return desc.includes("rehab assignment") ? "rehab" : null;
    case "SFA":
      return desc.includes("minor league contract") ? "milb_signed" : null;
    case "SC":
      if (desc.includes("transferred") && desc.includes("60-day injured list")) return "il_60day";
      if (desc.includes("activated") && desc.includes("injured list")) return "il_activated";
      if (desc.includes("placed") && desc.includes("injured list")) return "il_placed";
      if (desc.includes("activated") && desc.includes("bereavement")) return "off_bereavement";
      if (desc.includes("placed") && desc.includes("bereavement")) return "on_bereavement";
      if (desc.includes("placed") && desc.includes("restricted")) return "on_restricted";
      return null;
  }
  return null;
}

function prettyShortDate(iso: string): string {
  const parts = iso.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  return dt.toLocaleString("en-US", {
    weekday: "short", month: "short", day: "numeric", timeZone: "UTC",
  });
}

function seasonStart(today: string): string {
  // Regular-season Opening Day. Spring-training transactions are sparse
  // and uneven in daily_raw (March 4 → March 25 is one big gap), so we
  // pin the chart/table to the regular season for now.
  return `${today.slice(0, 4)}-03-25`;
}

type Row = {
  date: string;
  total: number;
  counts: Record<Category, number>;
  hasData: boolean;
};

function emptyCounts(): Record<Category, number> {
  return Object.fromEntries(COLUMNS.map((c) => [c.key, 0])) as Record<Category, number>;
}

// Single query feeds both the chart and the matrix table. PostgREST jsonb
// projection lets us pull payload->transactions only (skipping the multi-MB
// boxscore/leaders blob) so the whole season returns in seconds.
async function loadSeason(
  teamId: number | null,
  start: string,
  end: string,
): Promise<{ chart: ChartPoint[]; rows: Row[] }> {
  const { data, error } = await supabaseAdmin()
    .from("daily_raw")
    .select("date, txns:payload->transactions")
    .eq("sport", "mlb")
    .gte("date", start)
    .lte("date", end)
    .order("date", { ascending: false });
  if (error) throw new Error(`loadSeason: ${error.message}`);

  const rows: Row[] = [];
  const chart: ChartPoint[] = [];
  for (const row of data ?? []) {
    const date = row.date as string;
    const projection = (row as { txns: { transactions?: unknown } | null }).txns;
    const counts = emptyCounts();
    let total = 0;
    let hasData = false;
    if (projection) {
      hasData = true;
      const txns = parseTransactions(projection);
      for (const t of txns) {
        // Skip uniform number changes — statsapi logs every Jackie
        // Robinson Day #42 swap as a NUM transaction, which would otherwise
        // bury real roster moves under 1500+ jersey edits across Apr 15-16.
        if (t.typeCode === "NUM") continue;
        if (teamId !== null && t.fromTeamId !== teamId && t.toTeamId !== teamId) continue;
        total += 1;
        const cat = categorize(t);
        if (cat) counts[cat] += 1;
      }
    }
    rows.push({ date, total, counts, hasData });
    chart.push({ date, total });
  }

  rows.sort((a, b) => (a.date < b.date ? 1 : -1));
  chart.sort((a, b) => (a.date < b.date ? -1 : 1));
  return { chart, rows };
}

const META_TITLE = "MLB Transactions | boxscore";
const META_DESC =
  "Daily MLB roster moves for the season — IL placements and activations, DFAs, options, recalls, 40-man selections, and signings. Filter by team.";
const META_URL = `${EMAIL_LINK_BASE}/transactions`;
const META_IMG = `${EMAIL_LINK_BASE}/icon.png`;

export const metadata = {
  title: META_TITLE,
  description: META_DESC,
  alternates: { canonical: "/transactions" },
  openGraph: {
    title: META_TITLE,
    description: META_DESC,
    url: META_URL,
    siteName: "boxscore",
    type: "website",
    images: [{ url: META_IMG, alt: "boxscore" }],
  },
  twitter: {
    card: "summary",
    title: META_TITLE,
    description: META_DESC,
    images: [META_IMG],
  },
};

export default async function TransactionPage({
  searchParams,
}: {
  searchParams: Promise<{ team?: string }>;
}) {
  const sp = await searchParams;
  const teamParam = (sp.team ?? "mlb").toLowerCase();
  const isAll = teamParam === "mlb";
  const team = isAll ? null : findTeam("mlb", teamParam);
  if (!isAll && !team) notFound();

  const today = todayInET();
  const start = seasonStart(today);
  const teamId = team?.mlbApiId ?? null;

  const { chart, rows } = await loadSeason(teamId, start, today);
  const visibleRows = rows.filter((r) => r.hasData);

  const seasonTotals = emptyCounts();
  let seasonTotal = 0;
  for (const r of visibleRows) {
    seasonTotal += r.total;
    for (const c of COLUMNS) seasonTotals[c.key] += r.counts[c.key];
  }
  const mlbTeams = teamsBySport("mlb")
    .slice()
    .sort((a, b) => a.abbreviation.localeCompare(b.abbreviation));

  return (
    <div className="tx-page">
      <h1 className="tx-title">Transactions</h1>
      <p className="tx-subtitle">
        {isAll ? "All MLB teams" : team!.name} &middot; {today.slice(0, 4)} season
      </p>

      <TransactionChart points={chart} team={teamParam} />

      <nav className="tx-tabs" aria-label="Team filter">
        <a
          className={`tx-tab ${isAll ? "tx-tab-active" : ""}`}
          href="/transactions"
        >
          MLB
        </a>
        {mlbTeams.map((t) => {
          const isActive = team?.slug === t.slug;
          const style: React.CSSProperties = t.primary
            ? isActive
              ? { background: t.primary, color: "#fff", borderColor: t.primary }
              : {
                  borderLeft: `3px solid ${t.primary}`,
                  background: `${t.primary}1F`,
                }
            : {};
          return (
            <a
              key={t.slug}
              className={`tx-tab ${isActive ? "tx-tab-active" : ""}`}
              href={`/transactions?team=${t.slug}`}
              style={style}
              title={t.name}
            >
              {t.abbreviation}
            </a>
          );
        })}
      </nav>

      <div className="tx-scroll">
        <table className="tx-table">
          <thead>
            <tr>
              <th className="tx-col-date">Date</th>
              <th className="tx-col-total">Total</th>
              {COLUMNS.map((c) => (
                <th key={c.key}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((r) => (
              <tr key={r.date} id={`d-${r.date}`}>
                <td className="tx-col-date">
                  <a
                    href={team ? `/mlb/${team.slug}/${r.date}` : `/mlb/${r.date}`}
                    className="tx-date-link"
                  >
                    {prettyShortDate(r.date)}
                  </a>
                </td>
                <td className="tx-col-total">{r.total || ""}</td>
                {COLUMNS.map((c) => (
                  <td key={c.key}>{r.counts[c.key] || ""}</td>
                ))}
              </tr>
            ))}
            {visibleRows.length === 0 && (
              <tr>
                <td colSpan={2 + COLUMNS.length} className="tx-table-empty">
                  No data for this season yet.
                </td>
              </tr>
            )}
          </tbody>
          {visibleRows.length > 0 && (
            <tfoot>
              <tr>
                <td className="tx-col-date">Season total</td>
                <td className="tx-col-total">{seasonTotal || ""}</td>
                {COLUMNS.map((c) => (
                  <td key={c.key}>{seasonTotals[c.key] || ""}</td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
