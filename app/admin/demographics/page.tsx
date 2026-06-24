import { requireAdmin } from "../require-admin";
import { supabaseAdmin } from "@/lib/supabase";
import {
  AGE_BANDS,
  COUNTRIES,
  GENDERS,
  INCOME_BANDS,
  US_STATES,
} from "@/lib/demographics";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Demographics · admin · boxscore",
  robots: { index: false },
};

type SubRow = {
  status: string;
  demographics_completed_at: string | null;
  country: string | null;
  region: string | null;
  age_band: string | null;
  income_band: string | null;
  gender: string | null;
};

// Walk every active subscriber once and bucket by each demographic
// column. We do it in app code (rather than a SQL aggregate) because
// PostgREST doesn't expose GROUP BY and ~6K rows is fine to pull —
// total payload is tiny since we only pull the seven small columns
// listed above. Switch to a database view if subscribers grows past
// the 1000-row cap and we have to start paginating.
async function loadRows(): Promise<SubRow[]> {
  const db = supabaseAdmin();
  const out: SubRow[] = [];
  const PAGE = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await db
      .from("subscribers")
      .select("status, demographics_completed_at, country, region, age_band, income_band, gender")
      .eq("status", "active")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`demographics load: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...(data as SubRow[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

// Count how many subscribers picked each option in a field. Returns
// labelled rows in the same order as the source option list so the
// admin can read them in canonical order (e.g. 18-24, 25-34, …). The
// "no answer" row tallies nulls separately from "prefer-not-to-say"
// because they mean different things (skipped vs. declined).
type BreakdownRow = { value: string; label: string; count: number; pct: number };
function breakdown(
  rows: SubRow[],
  field: keyof Pick<SubRow, "country" | "region" | "age_band" | "income_band" | "gender">,
  options: ReadonlyArray<{ value: string; label: string }>,
): BreakdownRow[] {
  const total = rows.length;
  const counts = new Map<string, number>();
  let noAnswer = 0;
  for (const r of rows) {
    const v = r[field];
    if (!v) { noAnswer++; continue; }
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const out: BreakdownRow[] = options.map((o) => {
    const c = counts.get(o.value) ?? 0;
    return { value: o.value, label: o.label, count: c, pct: total ? (c / total) * 100 : 0 };
  });
  // Surface any stored value that didn't match the canonical option
  // list — useful if the option list changes and old rows linger.
  for (const [v, c] of counts) {
    if (!options.some((o) => o.value === v)) {
      out.push({ value: v, label: `(legacy) ${v}`, count: c, pct: total ? (c / total) * 100 : 0 });
    }
  }
  out.push({ value: "_none", label: "No answer", count: noAnswer, pct: total ? (noAnswer / total) * 100 : 0 });
  return out;
}

function BreakdownTable({ title, rows }: { title: string; rows: BreakdownRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <section style={{ marginBottom: 28 }}>
      <h2 style={{ margin: "0 0 8px", fontSize: 14, textTransform: "uppercase", letterSpacing: "0.06em" }}>{title}</h2>
      <table className="admin-clicks-table" style={{ width: "100%" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left",  width: "40%" }}>Option</th>
            <th style={{ textAlign: "right", width: "10%" }}>Count</th>
            <th style={{ textAlign: "right", width: "10%" }}>%</th>
            <th style={{ textAlign: "left" }}>Bar</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const width = (r.count / max) * 100;
            return (
              <tr key={r.value}>
                <td>{r.label}</td>
                <td style={{ textAlign: "right", fontFamily: "ui-monospace, monospace" }}>{r.count.toLocaleString()}</td>
                <td style={{ textAlign: "right", fontFamily: "ui-monospace, monospace" }}>{r.pct.toFixed(1)}%</td>
                <td>
                  <div style={{
                    width:      `${width}%`,
                    minWidth:   r.count > 0 ? 2 : 0,
                    height:     12,
                    background: r.value === "_none" ? "#bbb" : "#3a5fcc",
                    borderRadius: 2,
                  }} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

export default async function AdminDemographicsView() {
  await requireAdmin();
  const rows = await loadRows();
  const total = rows.length;
  // Breakdowns are scoped to subscribers who finished the welcome form, so
  // percentages describe "of those who answered, what did they pick?" The
  // response-rate panel at the top is the only place the full active-list
  // denominator still appears — that's where it's actually the right number.
  const completedRows = rows.filter((r) => r.demographics_completed_at !== null);
  const completed = completedRows.length;
  const responseRate = total ? (completed / total) * 100 : 0;

  // State breakdown — only meaningful within the US subset of completions.
  // Anyone who saved a region for a non-US country would have had it cleared
  // by sanitizeDemographics, but we double-check by filtering here.
  const usRows = completedRows.filter((r) => r.country === "US");

  return (
    <main className="admin">
      <h1>Audience demographics</h1>

      <section style={{ margin: "0 0 28px", padding: "12px 14px", border: "1px solid #d4d4d4", borderRadius: 4 }}>
        <h2 style={{ margin: "0 0 6px", fontSize: 14, textTransform: "uppercase", letterSpacing: "0.06em" }}>Response rate</h2>
        <p className="admin-meta" style={{ margin: "0 0 8px" }}>
          <b>{completed.toLocaleString()}</b> of <b>{total.toLocaleString()}</b> active subscribers
          have completed the welcome form — <b>{responseRate.toFixed(1)}%</b>.
          Active = subscribers.status = &lsquo;active&rsquo;. Percentages below
          are out of the {completed.toLocaleString()} completed responses.
        </p>
        <div style={{ display: "flex", height: 14, background: "#eee", borderRadius: 2, overflow: "hidden" }}>
          <div style={{ width: `${responseRate}%`, background: "#1f7a3a" }} title={`${completed} completed`} />
        </div>
      </section>

      <BreakdownTable title="Country"            rows={breakdown(completedRows, "country",     COUNTRIES)} />
      <BreakdownTable title={`State (US only — ${usRows.length.toLocaleString()} completions)`} rows={breakdown(usRows, "region", US_STATES)} />
      <BreakdownTable title="Age range"          rows={breakdown(completedRows, "age_band",    AGE_BANDS)} />
      <BreakdownTable title="Household income"   rows={breakdown(completedRows, "income_band", INCOME_BANDS)} />
      <BreakdownTable title="Gender / identity"  rows={breakdown(completedRows, "gender",      GENDERS)} />
    </main>
  );
}
