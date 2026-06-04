import { requireAdmin } from "../require-admin";
import { supabaseAdmin } from "@/lib/supabase";
import {
  Alert,
  DataTable,
  EmptyState,
  PageHeader,
  StatusBadge,
  type BadgeVariant,
  type Column,
} from "../_components/primitives";

// /admin/ads — Campaigns list. Operational landing for the ads section.
// Replaces the old /admin/ads/manage accordion mess (see issue #50).
//
// Each row is a campaign; click-through goes to /admin/ads/campaigns/[id].
// Advertisers live at /admin/ads/advertisers and the inventory exploration
// (catalog + splice preview) is at /admin/ads/explore.

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Ads · Campaigns · boxscore",
  robots: { index: false },
};

type CampaignStatus = "pending" | "approved" | "rejected" | "cancelled";

type CampaignRow = {
  id: string;
  name: string;
  status: CampaignStatus;
  paid_at: string | null;
  paid_amount_cents: number | null;
  paid_method: string | null;
  created_at: string;
  advertiser_id: string;
  advertiser_name: string;
  advertiser_email: string;
  placement_count: number;
};

async function loadCampaignRows(): Promise<CampaignRow[]> {
  const db = supabaseAdmin();
  // Single round-trip via embedded select: ad_campaigns joined with their
  // advertiser. Placement count comes from a separate aggregation so the
  // primary list query stays cheap; nesting count via PostgREST inflates
  // payload per row.
  const [{ data: rows, error: rowsErr }, { data: placements, error: pErr }] =
    await Promise.all([
      db
        .from("ad_campaigns")
        .select(
          "id, name, status, paid_at, paid_amount_cents, paid_method, created_at, " +
            "advertiser:ad_advertisers!inner ( id, name, email )",
        )
        .order("created_at", { ascending: false }),
      db.from("ad_placements").select("creative_id, ad_creatives!inner ( campaign_id )"),
    ]);
  if (rowsErr) throw new Error(`load campaigns: ${rowsErr.message}`);
  if (pErr) throw new Error(`load placement counts: ${pErr.message}`);

  // Placement count per campaign — join placements → creative → campaign.
  const countByCampaign = new Map<string, number>();
  for (const p of (placements ?? []) as Array<{
    ad_creatives: { campaign_id: string } | { campaign_id: string }[] | null;
  }>) {
    // PostgREST returns either an object or an array depending on the relationship
    // cardinality. We modeled it as a single FK so it's an object; coerce defensively.
    const c = Array.isArray(p.ad_creatives) ? p.ad_creatives[0] : p.ad_creatives;
    if (!c) continue;
    countByCampaign.set(c.campaign_id, (countByCampaign.get(c.campaign_id) ?? 0) + 1);
  }

  type RawRow = {
    id: string;
    name: string;
    status: CampaignStatus;
    paid_at: string | null;
    paid_amount_cents: number | null;
    paid_method: string | null;
    created_at: string;
    advertiser: { id: string; name: string; email: string } | { id: string; name: string; email: string }[];
  };

  // Supabase's generated types can't infer the embedded shape correctly when
  // it doesn't have a generated DB schema for the new ad_* tables yet; cast
  // through unknown so we own the runtime shape.
  return ((rows ?? []) as unknown as RawRow[]).map((r) => {
    const adv = Array.isArray(r.advertiser) ? r.advertiser[0] : r.advertiser;
    return {
      id: r.id,
      name: r.name,
      status: r.status,
      paid_at: r.paid_at,
      paid_amount_cents: r.paid_amount_cents,
      paid_method: r.paid_method,
      created_at: r.created_at,
      advertiser_id: adv?.id ?? "",
      advertiser_name: adv?.name ?? "(unknown)",
      advertiser_email: adv?.email ?? "",
      placement_count: countByCampaign.get(r.id) ?? 0,
    };
  });
}

function isLive(c: CampaignRow): boolean {
  return c.status === "approved" && c.paid_at !== null;
}

function statusVariant(c: CampaignRow): BadgeVariant {
  if (isLive(c)) return "success";
  if (c.status === "rejected" || c.status === "cancelled") return "danger";
  if (c.status === "pending") return "warning";
  return "neutral";
}

function statusLabel(c: CampaignRow): string {
  if (isLive(c)) return "live";
  if (c.status === "approved" && !c.paid_at) return "approved · unpaid";
  return c.status;
}

function formatCents(cents: number | null): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

export default async function CampaignsListPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  await requireAdmin();
  const { ok, error } = await searchParams;
  const rows = await loadCampaignRows();

  const columns: Column<CampaignRow>[] = [
    {
      header: "Campaign",
      cell: (r) => (
        <>
          <div style={{ fontWeight: 500 }}>{r.name}</div>
          <div className="a-muted" style={{ fontSize: 12 }}>
            {r.advertiser_name}
          </div>
        </>
      ),
    },
    {
      header: "Status",
      cell: (r) => <StatusBadge variant={statusVariant(r)}>{statusLabel(r)}</StatusBadge>,
      width: "160px",
    },
    {
      header: "Paid",
      className: "numeric",
      cell: (r) => formatCents(r.paid_amount_cents),
      width: "100px",
    },
    {
      header: "Placements",
      className: "numeric",
      cell: (r) => r.placement_count,
      width: "100px",
    },
    {
      header: "Created",
      className: "muted",
      cell: (r) => new Date(r.created_at).toLocaleDateString(),
      width: "120px",
    },
  ];

  return (
    <>
      <PageHeader
        title="Campaigns"
        subtitle="All ad campaigns across advertisers. Click a row for detail."
        breadcrumbs={[{ label: "Ads" }, { label: "Campaigns" }]}
        actions={
          <a href="/admin/ads/advertisers" className="a-btn">
            Advertisers
          </a>
        }
      />

      {ok && <Alert variant="success">{ok}</Alert>}
      {error && <Alert variant="danger">{error}</Alert>}

      <DataTable
        rows={rows}
        columns={columns}
        rowHref={(r) => `/admin/ads/campaigns/${r.id}`}
        empty={
          <EmptyState
            message="No campaigns yet."
            action={
              <a href="/admin/ads/advertisers" className="a-btn a-btn-primary">
                Create an advertiser to start
              </a>
            }
          />
        }
      />
    </>
  );
}
