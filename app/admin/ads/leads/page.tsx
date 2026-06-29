import { requireAdmin } from "../../require-admin";
import { supabaseAdmin } from "@/lib/supabase";
import {
  Card,
  DataTable,
  EmptyState,
  PageHeader,
  Section,
  StatusBadge,
  type BadgeVariant,
  type Column,
} from "../../_components/primitives";

// /admin/ads/leads — Inbound advertiser inquiries.
// One row per submission of the /advertise inquiry form, ordered most
// recent first. Surfaces the form fields, the UTM + referer captured at
// submit time, and (if enrichment has run) the company-from-email lookup.
//
// Build target: enough on one screen that Jeff can read a lead end to
// end — no detail page yet. Add /admin/ads/leads/[id] later if message
// length or enrichment depth justifies it.

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Ads · Leads · boxscore",
  robots: { index: false },
};

type InquiryRow = {
  id: string;
  created_at: string;
  name: string;
  email: string;
  company: string | null;
  budget: string | null;
  formats: string[];
  message: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  referer: string | null;
  landing_path: string | null;
  posthog_session: string | null;
  ip_address: string | null;
  enrichment_status: string | null;
  enrichment_company: string | null;
  enrichment_domain: string | null;
  enrichment_industry: string | null;
  enrichment_employees: number | null;
  enrichment_linkedin: string | null;
  notified_at: string | null;
};

async function loadLeads(): Promise<InquiryRow[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("advertise_inquiries")
    .select(
      "id, created_at, name, email, company, budget, formats, message, " +
      "utm_source, utm_medium, utm_campaign, referer, landing_path, " +
      "posthog_session, ip_address, enrichment_status, enrichment_company, " +
      "enrichment_domain, enrichment_industry, enrichment_employees, " +
      "enrichment_linkedin, notified_at",
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(`loadLeads: ${error.message}`);
  return ((data ?? []) as unknown) as InquiryRow[];
}

function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  }).format(new Date(iso));
}

// Best-effort "where did they come from" string from utm + referer.
function attribution(r: InquiryRow): string {
  const parts: string[] = [];
  if (r.utm_source)   parts.push(`src: ${r.utm_source}`);
  if (r.utm_medium)   parts.push(`med: ${r.utm_medium}`);
  if (r.utm_campaign) parts.push(`cmp: ${r.utm_campaign}`);
  if (parts.length > 0) return parts.join(" · ");
  if (r.referer) {
    try { return `ref: ${new URL(r.referer).hostname}`; }
    catch { return `ref: ${r.referer.slice(0, 40)}`; }
  }
  if (r.landing_path && r.landing_path !== "/advertise") {
    return `landed: ${r.landing_path}`;
  }
  return "direct";
}

function enrichBadge(status: string | null): { variant: BadgeVariant; label: string } {
  switch (status) {
    case "ok":         return { variant: "success",  label: "enriched" };
    case "pending":    return { variant: "neutral",  label: "pending"  };
    case "not_found":  return { variant: "neutral",  label: "no match" };
    case "error":      return { variant: "warning",  label: "err"      };
    default:           return { variant: "neutral",  label: "—"        };
  }
}

export default async function LeadsPage() {
  await requireAdmin();
  const rows = await loadLeads();

  const columns: Column<InquiryRow>[] = [
    {
      header: "When",
      width: "150px",
      cell: (r) => <code className="a-meta">{fmtDate(r.created_at)}</code>,
    },
    {
      header: "Name / company",
      cell: (r) => (
        <>
          <div style={{ fontWeight: 700 }}>{r.name}</div>
          <div className="a-meta">
            {r.enrichment_company ?? r.company ?? <span style={{ opacity: 0.4 }}>—</span>}
            {r.enrichment_domain && (
              <> &middot; <code>{r.enrichment_domain}</code></>
            )}
          </div>
        </>
      ),
    },
    {
      header: "Email",
      cell: (r) => <a href={`mailto:${r.email}`}><code>{r.email}</code></a>,
    },
    {
      header: "Budget",
      width: "150px",
      cell: (r) => r.budget ?? <span style={{ opacity: 0.4 }}>—</span>,
    },
    {
      header: "Formats",
      cell: (r) => r.formats.length === 0
        ? <span style={{ opacity: 0.4 }}>—</span>
        : <span className="a-meta">{r.formats.join(", ")}</span>,
    },
    {
      header: "Source",
      cell: (r) => <span className="a-meta">{attribution(r)}</span>,
    },
    {
      header: "Enrich",
      width: "90px",
      cell: (r) => {
        const b = enrichBadge(r.enrichment_status);
        return <StatusBadge variant={b.variant}>{b.label}</StatusBadge>;
      },
    },
  ];

  return (
    <>
      <PageHeader
        title="Leads"
        subtitle="Inbound advertiser inquiries from /advertise — most recent first."
        breadcrumbs={[{ label: "Ads" }, { label: "Leads" }]}
      />
      <Section>
        {rows.length === 0 ? (
          <EmptyState message="No inquiries yet." />
        ) : (
          <DataTable rows={rows} columns={columns} />
        )}
      </Section>

      {rows.slice(0, 25).map((r) => (
        <Section key={r.id} title={`${r.name} · ${fmtDate(r.created_at)}`}>
          <Card>
            <dl className="a-info">
              <dt>Email</dt>
              <dd><a href={`mailto:${r.email}`}>{r.email}</a></dd>
              {(r.company || r.enrichment_company) && (
                <>
                  <dt>Company</dt>
                  <dd>
                    {r.enrichment_company ?? r.company}
                    {r.enrichment_company && r.company && r.enrichment_company !== r.company && (
                      <span className="a-meta"> (form: {r.company})</span>
                    )}
                  </dd>
                </>
              )}
              {r.budget && (<><dt>Budget</dt><dd>{r.budget}</dd></>)}
              {r.formats.length > 0 && (<><dt>Formats</dt><dd>{r.formats.join(", ")}</dd></>)}
              <dt>Source</dt>
              <dd>{attribution(r)}</dd>
              {r.referer && (
                <>
                  <dt>Full referer</dt>
                  <dd><code className="a-meta">{r.referer}</code></dd>
                </>
              )}
              {r.landing_path && (
                <>
                  <dt>Landing path</dt>
                  <dd><code>{r.landing_path}</code></dd>
                </>
              )}
              {r.posthog_session && (
                <>
                  <dt>PostHog session</dt>
                  <dd><code className="a-meta">{r.posthog_session}</code></dd>
                </>
              )}
              {r.ip_address && (<><dt>IP</dt><dd><code className="a-meta">{r.ip_address}</code></dd></>)}
              {r.enrichment_status === "ok" && (
                <>
                  <dt>Enrichment</dt>
                  <dd>
                    {r.enrichment_industry && <>{r.enrichment_industry}</>}
                    {r.enrichment_employees && <> · {r.enrichment_employees.toLocaleString()} employees</>}
                    {r.enrichment_linkedin && (
                      <> · <a href={r.enrichment_linkedin} target="_blank" rel="noopener noreferrer">LinkedIn</a></>
                    )}
                  </dd>
                </>
              )}
            </dl>
            <div style={{ marginTop: 12, whiteSpace: "pre-wrap", fontFamily: "Georgia, serif" }}>
              {r.message}
            </div>
          </Card>
        </Section>
      ))}
    </>
  );
}
