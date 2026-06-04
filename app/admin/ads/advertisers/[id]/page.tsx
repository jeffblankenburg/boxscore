import { notFound } from "next/navigation";
import { requireAdmin } from "../../../require-admin";
import { supabaseAdmin } from "@/lib/supabase";
import {
  Alert,
  Card,
  DataTable,
  EmptyState,
  InfoRows,
  PageHeader,
  Section,
  StatusBadge,
  type BadgeVariant,
  type Column,
  type InfoRow,
} from "../../../_components/primitives";
import { FormButton } from "../../../_components/FormButton";
import { createCampaign } from "../../actions";

// /admin/ads/advertisers/[id] — Advertiser detail.
// Info-row block summarises the advertiser; table below lists their
// campaigns with a quick inline create form.

export const dynamic = "force-dynamic";

type CampaignStatus = "pending" | "approved" | "rejected" | "cancelled";

type Advertiser = {
  id: string;
  email: string;
  name: string;
  notes: string | null;
  created_at: string;
};

type CampaignRow = {
  id: string;
  name: string;
  status: CampaignStatus;
  paid_at: string | null;
  paid_amount_cents: number | null;
  created_at: string;
};

async function loadAdvertiser(id: string): Promise<Advertiser | null> {
  const { data, error } = await supabaseAdmin()
    .from("ad_advertisers")
    .select("id, email, name, notes, created_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`load advertiser: ${error.message}`);
  return data as Advertiser | null;
}

async function loadAdvertiserCampaigns(advertiserId: string): Promise<CampaignRow[]> {
  const { data, error } = await supabaseAdmin()
    .from("ad_campaigns")
    .select("id, name, status, paid_at, paid_amount_cents, created_at")
    .eq("advertiser_id", advertiserId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`load campaigns: ${error.message}`);
  return (data ?? []) as CampaignRow[];
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

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const advertiser = await loadAdvertiser(id);
  return {
    title: advertiser ? `${advertiser.name} · Advertisers · boxscore admin` : "Advertiser",
    robots: { index: false },
  };
}

export default async function AdvertiserDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const { ok, error } = await searchParams;

  const advertiser = await loadAdvertiser(id);
  if (!advertiser) notFound();

  const campaigns = await loadAdvertiserCampaigns(advertiser.id);
  const returnPath = `/admin/ads/advertisers/${advertiser.id}`;

  const info: InfoRow[] = [
    { label: "Email", value: <a href={`mailto:${advertiser.email}`}>{advertiser.email}</a> },
    { label: "Notes", value: advertiser.notes ?? <span className="a-muted">—</span> },
    {
      label: "Created",
      value: new Date(advertiser.created_at).toLocaleString(),
    },
    { label: "ID", value: <code>{advertiser.id}</code> },
  ];

  const columns: Column<CampaignRow>[] = [
    {
      header: "Campaign",
      cell: (r) => <span style={{ fontWeight: 500 }}>{r.name}</span>,
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
      header: "Created",
      className: "muted",
      cell: (r) => new Date(r.created_at).toLocaleDateString(),
      width: "120px",
    },
  ];

  return (
    <>
      <PageHeader
        title={advertiser.name}
        subtitle={advertiser.email}
        breadcrumbs={[
          { label: "Ads", href: "/admin/ads" },
          { label: "Advertisers", href: "/admin/ads/advertisers" },
          { label: advertiser.name },
        ]}
      />

      {ok && <Alert variant="success">{ok}</Alert>}
      {error && <Alert variant="danger">{error}</Alert>}

      <Section>
        <InfoRows rows={info} />
      </Section>

      <Section title="Campaigns">
        <DataTable
          rows={campaigns}
          columns={columns}
          rowHref={(r) => `/admin/ads/campaigns/${r.id}`}
          empty={<EmptyState message="No campaigns yet for this advertiser." />}
        />
      </Section>

      <Section title="New campaign">
        <Card>
          <form action={createCampaign}>
            <input type="hidden" name="_return" value={returnPath} />
            <input type="hidden" name="advertiser_id" value={advertiser.id} />
            <div className="a-field">
              <label className="a-label" htmlFor="camp-name">Campaign name</label>
              <input
                id="camp-name"
                name="name"
                type="text"
                required
                className="a-input"
                placeholder="Spring 2026 — sponsor line"
              />
            </div>
            <div className="a-field">
              <label className="a-label" htmlFor="camp-notes">Notes</label>
              <input
                id="camp-notes"
                name="notes"
                type="text"
                className="a-input"
                placeholder="Optional internal notes"
              />
            </div>
            <div className="a-form-actions">
              <FormButton
                idleLabel="Create campaign"
                pendingLabel="Creating…"
                variant="primary"
              />
            </div>
          </form>
        </Card>
      </Section>
    </>
  );
}
