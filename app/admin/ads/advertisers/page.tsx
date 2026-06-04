import { requireAdmin } from "../../require-admin";
import { supabaseAdmin } from "@/lib/supabase";
import {
  Alert,
  Card,
  DataTable,
  EmptyState,
  PageHeader,
  type Column,
} from "../../_components/primitives";
import { FormButton } from "../../_components/FormButton";
import { createAdvertiser } from "../actions";

// /admin/ads/advertisers — Advertisers list with inline create form.
// Click a row → /admin/ads/advertisers/[id] for detail + their campaigns.

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Ads · Advertisers · boxscore",
  robots: { index: false },
};

const RETURN_PATH = "/admin/ads/advertisers";

type AdvertiserRow = {
  id: string;
  email: string;
  name: string;
  notes: string | null;
  created_at: string;
  campaign_count: number;
};

async function loadAdvertiserRows(): Promise<AdvertiserRow[]> {
  const db = supabaseAdmin();
  const [{ data: rows, error: rowsErr }, { data: campaigns, error: cErr }] =
    await Promise.all([
      db
        .from("ad_advertisers")
        .select("id, email, name, notes, created_at")
        .order("created_at", { ascending: false }),
      db.from("ad_campaigns").select("advertiser_id"),
    ]);
  if (rowsErr) throw new Error(`load advertisers: ${rowsErr.message}`);
  if (cErr) throw new Error(`load campaign counts: ${cErr.message}`);

  const countByAdvertiser = new Map<string, number>();
  for (const c of (campaigns ?? []) as Array<{ advertiser_id: string }>) {
    countByAdvertiser.set(c.advertiser_id, (countByAdvertiser.get(c.advertiser_id) ?? 0) + 1);
  }

  return ((rows ?? []) as Array<{
    id: string; email: string; name: string; notes: string | null; created_at: string;
  }>).map((r) => ({
    ...r,
    campaign_count: countByAdvertiser.get(r.id) ?? 0,
  }));
}

export default async function AdvertisersListPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  await requireAdmin();
  const { ok, error } = await searchParams;
  const rows = await loadAdvertiserRows();

  const columns: Column<AdvertiserRow>[] = [
    {
      header: "Name",
      cell: (r) => (
        <>
          <div style={{ fontWeight: 500 }}>{r.name}</div>
          <div className="a-muted" style={{ fontSize: 12 }}>{r.email}</div>
        </>
      ),
    },
    {
      header: "Campaigns",
      className: "numeric",
      cell: (r) => r.campaign_count,
      width: "120px",
    },
    {
      header: "Notes",
      className: "muted",
      cell: (r) => r.notes ?? "—",
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
        title="Advertisers"
        subtitle="The people and businesses running campaigns."
        breadcrumbs={[
          { label: "Ads", href: "/admin/ads" },
          { label: "Advertisers" },
        ]}
      />

      {ok && <Alert variant="success">{ok}</Alert>}
      {error && <Alert variant="danger">{error}</Alert>}

      <Card title="New advertiser">
        <form action={createAdvertiser}>
          <input type="hidden" name="_return" value={RETURN_PATH} />
          <div className="a-field-row">
            <div className="a-field">
              <label className="a-label" htmlFor="adv-name">Name</label>
              <input
                id="adv-name"
                name="name"
                type="text"
                required
                className="a-input"
                placeholder="Henderson Sporting Goods"
              />
            </div>
            <div className="a-field">
              <label className="a-label" htmlFor="adv-email">Email</label>
              <input
                id="adv-email"
                name="email"
                type="email"
                required
                className="a-input"
                placeholder="hello@advertiser.com"
              />
            </div>
          </div>
          <div className="a-field">
            <label className="a-label" htmlFor="adv-notes">Notes</label>
            <input
              id="adv-notes"
              name="notes"
              type="text"
              className="a-input"
              placeholder="Optional internal notes"
            />
          </div>
          <div className="a-form-actions">
            <FormButton
              idleLabel="Create advertiser"
              pendingLabel="Creating…"
              variant="primary"
            />
          </div>
        </form>
      </Card>

      <div style={{ marginTop: 24 }}>
        <DataTable
          rows={rows}
          columns={columns}
          rowHref={(r) => `/admin/ads/advertisers/${r.id}`}
          empty={<EmptyState message="No advertisers yet. Create one above." />}
        />
      </div>
    </>
  );
}
