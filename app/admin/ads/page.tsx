import { requireAdmin } from "../require-admin";
import { supabaseAdmin } from "@/lib/supabase";
import { ADS_ENABLED_FLAG } from "@/lib/ad-placements";
import { isFlagEnabled } from "@/lib/admin-settings";
import { loadImpressionsByPair } from "@/lib/ad-impressions";
import {
  Alert,
  Card,
  DataTable,
  EmptyState,
  PageHeader,
  StatusBadge,
  type BadgeVariant,
  type Column,
} from "../_components/primitives";
import { toggleAdsEnabled } from "./actions";

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
  email_opens: number;
  web_views: number;
  clicks: number;
};

async function loadCampaignRows(): Promise<CampaignRow[]> {
  const db = supabaseAdmin();
  // Campaigns + advertisers, plus the placements list with campaign_id via
  // creative join. We pull (id, sport, date) on the placement so the
  // aggregation step downstream can look up impressions and clicks without
  // a second placement fetch.
  const [{ data: rows, error: rowsErr }, { data: placementRows, error: pErr }] =
    await Promise.all([
      db
        .from("ad_campaigns")
        .select(
          "id, name, status, paid_at, paid_amount_cents, paid_method, created_at, " +
            "advertiser:ad_advertisers!inner ( id, name, email )",
        )
        .order("created_at", { ascending: false }),
      db
        .from("ad_placements")
        .select("id, sport, date, ad_creatives!inner ( campaign_id )"),
    ]);
  if (rowsErr) throw new Error(`load campaigns: ${rowsErr.message}`);
  if (pErr) throw new Error(`load placements: ${pErr.message}`);

  type RawPlacement = {
    id: string;
    sport: string;
    date: string;
    ad_creatives: { campaign_id: string } | { campaign_id: string }[] | null;
  };
  const placements: Array<{ id: string; sport: string; date: string; campaign_id: string }> = [];
  for (const p of (placementRows ?? []) as RawPlacement[]) {
    const c = Array.isArray(p.ad_creatives) ? p.ad_creatives[0] : p.ad_creatives;
    if (!c) continue;
    placements.push({ id: p.id, sport: p.sport, date: p.date, campaign_id: c.campaign_id });
  }

  // Impressions (email + web) for every (sport, date) the list touches —
  // batched once so the page makes a single sends-scan + opens-scan +
  // pageviews-scan instead of per-campaign round trips.
  const impressions = await loadImpressionsByPair(
    placements.map((p) => ({ sport: p.sport, date: p.date })),
  );

  // Click counts per placement_id. Humans only — bots are tracked on the
  // detail page but don't belong on a row-level CTR-adjacent metric here.
  const clicksByPlacement = new Map<string, number>();
  if (placements.length > 0) {
    const placementIds = placements.map((p) => p.id);
    // Chunk IN to stay under PostgREST URL cap — UUIDs are 36 chars so
    // 200 per chunk keeps us comfortably under 8 KB.
    for (let i = 0; i < placementIds.length; i += 200) {
      const chunk = placementIds.slice(i, i + 200);
      const { data, error } = await db
        .from("link_clicks")
        .select("placement_id")
        .in("placement_id", chunk)
        .eq("is_bot", false);
      if (error) {
        console.error(`load clicks: ${error.message}`);
        continue;
      }
      for (const c of (data ?? []) as Array<{ placement_id: string }>) {
        clicksByPlacement.set(
          c.placement_id,
          (clicksByPlacement.get(c.placement_id) ?? 0) + 1,
        );
      }
    }
  }

  // Aggregate per campaign.
  type Agg = { email: number; web: number; clicks: number; placements: number };
  const aggByCampaign = new Map<string, Agg>();
  for (const p of placements) {
    const cur = aggByCampaign.get(p.campaign_id) ?? { email: 0, web: 0, clicks: 0, placements: 0 };
    const imp = impressions.get(`${p.sport}|${p.date}`);
    cur.email     += imp?.email ?? 0;
    cur.web       += imp?.web   ?? 0;
    cur.clicks    += clicksByPlacement.get(p.id) ?? 0;
    cur.placements += 1;
    aggByCampaign.set(p.campaign_id, cur);
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

  return ((rows ?? []) as unknown as RawRow[]).map((r) => {
    const adv = Array.isArray(r.advertiser) ? r.advertiser[0] : r.advertiser;
    const agg = aggByCampaign.get(r.id);
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
      placement_count: agg?.placements ?? 0,
      email_opens:     agg?.email      ?? 0,
      web_views:       agg?.web        ?? 0,
      clicks:          agg?.clicks     ?? 0,
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
  const [rows, adsEnabled] = await Promise.all([
    loadCampaignRows(),
    isFlagEnabled(ADS_ENABLED_FLAG).catch(() => false),
  ]);
  void ADS_ENABLED_FLAG; // reference keeps the import grouped with the action

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
      header: "Email opens",
      className: "numeric",
      cell: (r) => r.email_opens.toLocaleString(),
      width: "110px",
    },
    {
      header: "Web views",
      className: "numeric",
      cell: (r) => r.web_views.toLocaleString(),
      width: "100px",
    },
    {
      header: "Clicks",
      className: "numeric",
      cell: (r) => r.clicks.toLocaleString(),
      width: "80px",
    },
    {
      header: "CTR",
      className: "numeric",
      cell: (r) => {
        const imp = r.email_opens + r.web_views;
        return imp > 0 ? `${((r.clicks / imp) * 100).toFixed(2)}%` : "—";
      },
      width: "80px",
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

      {/* Master kill-switch for the daily-cron splice. Defaults to OFF so a
          fresh deploy never starts injecting ads on its own — the admin
          flips it on after verifying placements are correct. */}
      <Card>
        <div
          className="a-row"
          style={{ justifyContent: "space-between", alignItems: "center" }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <strong>Ads in daily digest:</strong>
              <StatusBadge variant={adsEnabled ? "success" : "neutral"}>
                {adsEnabled ? "Enabled" : "Disabled"}
              </StatusBadge>
            </div>
            <div className="a-muted" style={{ fontSize: 12, marginTop: 4 }}>
              {adsEnabled
                ? "The next daily-cron run will splice live placements into the digest HTML."
                : "The daily cron will skip ad splicing even if live placements exist."}
            </div>
          </div>
          <form action={toggleAdsEnabled}>
            <button type="submit" className="a-btn">
              Turn {adsEnabled ? "off" : "on"}
            </button>
          </form>
        </div>
      </Card>

      <div style={{ height: 16 }} />

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
