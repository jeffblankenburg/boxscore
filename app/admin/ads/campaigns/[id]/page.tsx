import { notFound } from "next/navigation";
import { requireAdmin } from "../../../require-admin";
import { supabaseAdmin } from "@/lib/supabase";
import {
  Alert,
  Card,
  EmptyState,
  InfoRows,
  PageHeader,
  Section,
  StatusBadge,
  type BadgeVariant,
  type InfoRow,
} from "../../../_components/primitives";
import { FormButton } from "../../../_components/FormButton";
import {
  createCreative,
  createPlacement,
  deleteCreative,
  deletePlacement,
  markCampaignPaid,
  setCampaignStatus,
  unmarkCampaignPaid,
} from "../../actions";

// /admin/ads/campaigns/[id] — Campaign detail.
// One screen end-to-end: status + paid management at the top, creatives
// below as flat cards (no accordion), each creative's placements inline.

export const dynamic = "force-dynamic";

type CampaignStatus = "pending" | "approved" | "rejected" | "cancelled";
type AdFormat = "sponsor_line" | "standings_strip" | "display_box" | "classified";

type Campaign = {
  id: string;
  name: string;
  status: CampaignStatus;
  paid_at: string | null;
  paid_amount_cents: number | null;
  paid_method: string | null;
  notes: string | null;
  created_at: string;
  advertiser_id: string;
  advertiser_name: string;
  advertiser_email: string;
};

type Creative = {
  id: string;
  format: AdFormat;
  payload: Record<string, unknown>;
  image_blob_url: string | null;
  alt_text: string | null;
  created_at: string;
};

type Placement = {
  id: string;
  creative_id: string;
  format: AdFormat;
  sport: string;
  date: string;
  slot_index: number;
};

// Default JSON payload shapes — shown as the textarea default per format so
// the admin starts from a working template rather than an empty box. The
// render path (ticket #45) treats these field names as template inputs.
const PAYLOAD_TEMPLATES: Record<AdFormat, string> = {
  sponsor_line: JSON.stringify(
    {
      copy: "Today's edition brought to you by Advertiser Name, doing X since YYYY",
      cta_url: "https://advertiser.example.com",
    },
    null,
    2,
  ),
  standings_strip: JSON.stringify(
    {
      headline: "ADVERTISER NAME",
      body: "Tagline · Find us at advertiser.example.com",
      cta_url: "https://advertiser.example.com",
    },
    null,
    2,
  ),
  display_box: JSON.stringify(
    {
      headline: "Advertiser Name",
      body: "Two-sentence pitch that reads like a small-paper display ad.",
      cta_text: "Shop at advertiser.example.com",
      cta_url: "https://advertiser.example.com",
    },
    null,
    2,
  ),
  classified: JSON.stringify(
    {
      lead: "CATEGORY —",
      body: "One-line classified copy with a phone number or URL at the end.",
      cta_url: "https://advertiser.example.com",
    },
    null,
    2,
  ),
};

async function loadCampaign(id: string): Promise<Campaign | null> {
  const { data, error } = await supabaseAdmin()
    .from("ad_campaigns")
    .select(
      "id, name, status, paid_at, paid_amount_cents, paid_method, notes, created_at, " +
        "advertiser:ad_advertisers!inner ( id, name, email )",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`load campaign: ${error.message}`);
  if (!data) return null;

  // Cast through unknown — Supabase types can't infer embedded relation
  // shapes for the new ad_* tables yet.
  type Raw = Omit<Campaign, "advertiser_id" | "advertiser_name" | "advertiser_email"> & {
    advertiser: { id: string; name: string; email: string } | { id: string; name: string; email: string }[] | null;
  };
  const raw = data as unknown as Raw;
  const adv = Array.isArray(raw.advertiser) ? raw.advertiser[0] : raw.advertiser;
  return {
    ...raw,
    advertiser_id: adv?.id ?? "",
    advertiser_name: adv?.name ?? "(unknown)",
    advertiser_email: adv?.email ?? "",
  };
}

async function loadCreatives(campaignId: string): Promise<Creative[]> {
  const { data, error } = await supabaseAdmin()
    .from("ad_creatives")
    .select("id, format, payload, image_blob_url, alt_text, created_at")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`load creatives: ${error.message}`);
  return (data ?? []) as Creative[];
}

async function loadPlacements(creativeIds: string[]): Promise<Placement[]> {
  if (creativeIds.length === 0) return [];
  const { data, error } = await supabaseAdmin()
    .from("ad_placements")
    .select("id, creative_id, format, sport, date, slot_index")
    .in("creative_id", creativeIds)
    .order("date", { ascending: true });
  if (error) throw new Error(`load placements: ${error.message}`);
  return (data ?? []) as Placement[];
}

function isLive(c: Campaign): boolean {
  return c.status === "approved" && c.paid_at !== null;
}

function statusVariant(c: Campaign): BadgeVariant {
  if (isLive(c)) return "success";
  if (c.status === "rejected" || c.status === "cancelled") return "danger";
  if (c.status === "pending") return "warning";
  return "info"; // approved but unpaid
}

function statusLabel(c: Campaign): string {
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
  const campaign = await loadCampaign(id);
  return {
    title: campaign ? `${campaign.name} · Campaigns · boxscore admin` : "Campaign",
    robots: { index: false },
  };
}

export default async function CampaignDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const { ok, error } = await searchParams;

  const campaign = await loadCampaign(id);
  if (!campaign) notFound();

  const creatives = await loadCreatives(campaign.id);
  const placements = await loadPlacements(creatives.map((c) => c.id));
  const placementsByCreative = new Map<string, Placement[]>();
  for (const p of placements) {
    const list = placementsByCreative.get(p.creative_id) ?? [];
    list.push(p);
    placementsByCreative.set(p.creative_id, list);
  }

  const returnPath = `/admin/ads/campaigns/${campaign.id}`;
  // Tomorrow's date as the default placement target — matches the "ship a
  // fake ad tomorrow" use case from ticket #44.
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  const info: InfoRow[] = [
    {
      label: "Advertiser",
      value: (
        <a href={`/admin/ads/advertisers/${campaign.advertiser_id}`}>
          {campaign.advertiser_name}
        </a>
      ),
    },
    { label: "Email", value: campaign.advertiser_email },
    {
      label: "Status",
      value: <StatusBadge variant={statusVariant(campaign)}>{statusLabel(campaign)}</StatusBadge>,
    },
    {
      label: "Paid",
      value: campaign.paid_at ? (
        <>
          {formatCents(campaign.paid_amount_cents)}
          {campaign.paid_method && <span className="a-muted"> ({campaign.paid_method})</span>}
          <span className="a-muted">
            {" "}· {new Date(campaign.paid_at).toLocaleString()}
          </span>
        </>
      ) : (
        <span className="a-muted">Unpaid</span>
      ),
    },
    {
      label: "Notes",
      value: campaign.notes ?? <span className="a-muted">—</span>,
    },
    {
      label: "Created",
      value: new Date(campaign.created_at).toLocaleString(),
    },
    { label: "ID", value: <code>{campaign.id}</code> },
  ];

  return (
    <>
      <PageHeader
        title={campaign.name}
        subtitle={
          <>
            {campaign.advertiser_name} ·{" "}
            <StatusBadge variant={statusVariant(campaign)}>{statusLabel(campaign)}</StatusBadge>
          </>
        }
        breadcrumbs={[
          { label: "Ads", href: "/admin/ads" },
          { label: "Campaigns", href: "/admin/ads" },
          { label: campaign.name },
        ]}
      />

      {ok && <Alert variant="success">{ok}</Alert>}
      {error && <Alert variant="danger">{error}</Alert>}

      <Section>
        <InfoRows rows={info} />
      </Section>

      <Section title="Status">
        <Card>
          <div className="a-row" style={{ flexWrap: "wrap" }}>
            {(["pending", "approved", "rejected", "cancelled"] as const).map((s) => (
              <form key={s} action={setCampaignStatus}>
                <input type="hidden" name="_return" value={returnPath} />
                <input type="hidden" name="campaign_id" value={campaign.id} />
                <input type="hidden" name="status" value={s} />
                <button
                  type="submit"
                  className={`a-btn ${campaign.status === s ? "a-btn-primary" : ""}`}
                  disabled={campaign.status === s}
                >
                  {s}
                </button>
              </form>
            ))}
          </div>
        </Card>
      </Section>

      <Section title="Payment">
        <Card>
          {!campaign.paid_at ? (
            <form action={markCampaignPaid}>
              <input type="hidden" name="_return" value={returnPath} />
              <input type="hidden" name="campaign_id" value={campaign.id} />
              <div className="a-field-row">
                <div className="a-field" style={{ maxWidth: 160 }}>
                  <label className="a-label" htmlFor="paid-amount">Amount (USD)</label>
                  <input
                    id="paid-amount"
                    name="paid_amount"
                    type="text"
                    required
                    className="a-input"
                    placeholder="250.00"
                  />
                </div>
                <div className="a-field">
                  <label className="a-label" htmlFor="paid-method">Method</label>
                  <input
                    id="paid-method"
                    name="paid_method"
                    type="text"
                    className="a-input"
                    placeholder="Stripe link / Venmo / invoice #123"
                  />
                </div>
              </div>
              <div className="a-form-actions">
                <FormButton
                  idleLabel="Mark paid"
                  pendingLabel="Saving…"
                  variant="primary"
                />
              </div>
            </form>
          ) : (
            <div className="a-row" style={{ justifyContent: "space-between" }}>
              <div>
                <strong>{formatCents(campaign.paid_amount_cents)}</strong>
                {campaign.paid_method && <span className="a-muted"> · {campaign.paid_method}</span>}
                <span className="a-muted">
                  {" "}— recorded {new Date(campaign.paid_at).toLocaleString()}
                </span>
              </div>
              <form action={unmarkCampaignPaid}>
                <input type="hidden" name="_return" value={returnPath} />
                <input type="hidden" name="campaign_id" value={campaign.id} />
                <FormButton idleLabel="Clear" pendingLabel="Clearing…" variant="danger" />
              </form>
            </div>
          )}
        </Card>
      </Section>

      <Section title={`Creatives (${creatives.length})`}>
        {creatives.length === 0 ? (
          <EmptyState message="No creatives yet. Add one below." />
        ) : (
          creatives.map((cr) => (
            <CreativeBlock
              key={cr.id}
              creative={cr}
              placements={placementsByCreative.get(cr.id) ?? []}
              returnPath={returnPath}
              defaultDate={tomorrow}
            />
          ))
        )}
      </Section>

      <Section title="New creative">
        <Card>
          <form action={createCreative}>
            <input type="hidden" name="_return" value={returnPath} />
            <input type="hidden" name="campaign_id" value={campaign.id} />
            <div className="a-field" style={{ maxWidth: 240 }}>
              <label className="a-label" htmlFor="cr-format">Format</label>
              <select
                id="cr-format"
                name="format"
                className="a-select"
                defaultValue="sponsor_line"
              >
                <option value="sponsor_line">sponsor_line</option>
                <option value="standings_strip">standings_strip</option>
                <option value="display_box">display_box</option>
                <option value="classified">classified</option>
              </select>
            </div>
            <div className="a-field" style={{ maxWidth: "none" }}>
              <label className="a-label" htmlFor="cr-payload">Payload JSON</label>
              <textarea
                id="cr-payload"
                name="payload"
                required
                rows={10}
                className="a-textarea"
                defaultValue={PAYLOAD_TEMPLATES.sponsor_line}
              />
              <details style={{ marginTop: 6 }}>
                <summary className="a-muted" style={{ fontSize: 12, cursor: "pointer" }}>
                  Payload templates per format
                </summary>
                <div style={{ marginTop: 8 }}>
                  {(Object.keys(PAYLOAD_TEMPLATES) as AdFormat[]).map((f) => (
                    <div key={f} style={{ marginBottom: 8 }}>
                      <div className="a-muted" style={{ fontSize: 12, marginBottom: 2 }}>{f}</div>
                      <pre className="a-code-block">{PAYLOAD_TEMPLATES[f]}</pre>
                    </div>
                  ))}
                </div>
              </details>
            </div>
            <div className="a-field-row">
              <div className="a-field" style={{ flex: 1 }}>
                <label className="a-label" htmlFor="cr-img">Image URL (display_box only)</label>
                <input
                  id="cr-img"
                  name="image_blob_url"
                  type="url"
                  className="a-input"
                  placeholder="https://…blob.vercel-storage.com/…"
                />
              </div>
              <div className="a-field" style={{ flex: 1 }}>
                <label className="a-label" htmlFor="cr-alt">Alt text (required if image set)</label>
                <input
                  id="cr-alt"
                  name="alt_text"
                  type="text"
                  className="a-input"
                  placeholder="What's in the image"
                />
              </div>
            </div>
            <div className="a-form-actions">
              <FormButton
                idleLabel="Add creative"
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

function CreativeBlock({
  creative,
  placements,
  returnPath,
  defaultDate,
}: {
  creative: Creative;
  placements: Placement[];
  returnPath: string;
  defaultDate: string;
}) {
  return (
    <Card
      title={
        <span>
          <strong>{creative.format}</strong>{" "}
          <span className="a-muted" style={{ fontWeight: 400 }}>
            id <code>{creative.id.slice(0, 8)}</code>
          </span>
        </span>
      }
      actions={
        <form action={deleteCreative}>
          <input type="hidden" name="_return" value={returnPath} />
          <input type="hidden" name="creative_id" value={creative.id} />
          <FormButton idleLabel="Delete" pendingLabel="Deleting…" variant="danger" />
        </form>
      }
    >
      <pre className="a-code-block" style={{ marginBottom: 12 }}>
        {JSON.stringify(creative.payload, null, 2)}
      </pre>

      {creative.image_blob_url && (
        <div className="a-muted" style={{ fontSize: 12, marginBottom: 12 }}>
          <strong>Image:</strong>{" "}
          <a href={creative.image_blob_url} target="_blank" rel="noreferrer">
            {creative.image_blob_url}
          </a>
          {creative.alt_text && <> · alt: <em>{creative.alt_text}</em></>}
        </div>
      )}

      <div style={{ marginTop: 16, borderTop: "1px solid var(--a-border)", paddingTop: 12 }}>
        <div className="a-muted" style={{ fontSize: 12, marginBottom: 8 }}>
          <strong>Placements ({placements.length})</strong>
        </div>
        {placements.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            {placements.map((p) => (
              <div
                key={p.id}
                className="a-row"
                style={{
                  justifyContent: "space-between",
                  padding: "6px 10px",
                  border: "1px solid var(--a-border)",
                  borderRadius: 4,
                  marginBottom: 4,
                  fontSize: 13,
                }}
              >
                <span>
                  <strong>{p.sport}</strong> · {p.date} · slot {p.slot_index}
                </span>
                <form action={deletePlacement}>
                  <input type="hidden" name="_return" value={returnPath} />
                  <input type="hidden" name="placement_id" value={p.id} />
                  <button type="submit" className="a-btn a-btn-sm">remove</button>
                </form>
              </div>
            ))}
          </div>
        )}

        <form action={createPlacement} className="a-row" style={{ alignItems: "flex-end", gap: 8 }}>
          <input type="hidden" name="_return" value={returnPath} />
          <input type="hidden" name="creative_id" value={creative.id} />
          <div className="a-field" style={{ marginBottom: 0, width: 100 }}>
            <label className="a-label">Sport</label>
            <select name="sport" className="a-select" defaultValue="mlb">
              <option value="mlb">mlb</option>
            </select>
          </div>
          <div className="a-field" style={{ marginBottom: 0, width: 160 }}>
            <label className="a-label">Date</label>
            <input
              name="date"
              type="date"
              required
              defaultValue={defaultDate}
              className="a-input"
            />
          </div>
          <div className="a-field" style={{ marginBottom: 0, width: 80 }}>
            <label className="a-label">Slot</label>
            <input
              name="slot_index"
              type="number"
              required
              min={1}
              defaultValue={1}
              className="a-input"
            />
          </div>
          <FormButton idleLabel="Add placement" pendingLabel="Saving…" />
        </form>
      </div>
    </Card>
  );
}
