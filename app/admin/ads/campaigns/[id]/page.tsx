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
import { nextDay, yesterdayInET } from "@/lib/dates";
import { SLOTS, type AdFormat } from "@/lib/ads-render";
import { CreativeForm } from "../../_components/CreativeForm";
import { NewCreativeButton } from "../../_components/NewCreativeButton";
import {
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

// Payload templates per format now live inside CreativeForm so the same
// shape definitions drive both the create textarea seed and the
// "should-format-change-reset-payload?" heuristic in edit mode.

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

type ClickCount = { humans: number; bots: number };

// Fetch every link_clicks row for these placements (label='ad' implicit
// via FK; we only need is_bot to split humans from prefetchers). Tiny
// row count expected in v1 — group in JS rather than build an RPC.
async function loadClickCounts(
  placementIds: string[],
): Promise<Map<string, ClickCount>> {
  const counts = new Map<string, ClickCount>();
  if (placementIds.length === 0) return counts;
  const { data, error } = await supabaseAdmin()
    .from("link_clicks")
    .select("placement_id, is_bot")
    .in("placement_id", placementIds);
  if (error) {
    // Don't fail the page on a click-count read error — placement rows
    // just show 0 and the admin can refresh later.
    console.error(`load click counts: ${error.message}`);
    return counts;
  }
  for (const r of (data ?? []) as Array<{ placement_id: string; is_bot: boolean }>) {
    const cur = counts.get(r.placement_id) ?? { humans: 0, bots: 0 };
    if (r.is_bot) cur.bots++;
    else cur.humans++;
    counts.set(r.placement_id, cur);
  }
  return counts;
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
  const clicksByPlacement = await loadClickCounts(placements.map((p) => p.id));
  const placementsByCreative = new Map<string, Placement[]>();
  for (const p of placements) {
    const list = placementsByCreative.get(p.creative_id) ?? [];
    list.push(p);
    placementsByCreative.set(p.creative_id, list);
  }

  const returnPath = `/admin/ads/campaigns/${campaign.id}`;
  // Tomorrow's date (in ET) as the default placement target — matches the
  // "ship a fake ad tomorrow" use case from ticket #44.
  //
  // Avoid Date.now() + 86_400_000 then toISOString(): toISOString returns
  // UTC, and after ~8pm ET the UTC date is already +1, so +24h lands on
  // day-after-tomorrow in the rendered YYYY-MM-DD. Use the codebase's ET
  // helpers instead: yesterdayInET → today in ET → tomorrow in ET.
  const tomorrow = nextDay(nextDay(yesterdayInET()));

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

      <Section
        title={`Creatives (${creatives.length})`}
        actions={
          <NewCreativeButton
            campaignId={campaign.id}
            returnPath={returnPath}
          />
        }
      >
        {creatives.length === 0 ? (
          <EmptyState
            message='No creatives yet. Click "+ New creative" above to add one.'
          />
        ) : (
          creatives.map((cr) => (
            <CreativeBlock
              key={cr.id}
              creative={cr}
              placements={placementsByCreative.get(cr.id) ?? []}
              clicksByPlacement={clicksByPlacement}
              returnPath={returnPath}
              defaultDate={tomorrow}
            />
          ))
        )}
      </Section>
    </>
  );
}

function CreativeBlock({
  creative,
  placements,
  clicksByPlacement,
  returnPath,
  defaultDate,
}: {
  creative: Creative;
  placements: Placement[];
  clicksByPlacement: Map<string, ClickCount>;
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
      {/* CreativeForm renders its own 2-column edit/preview layout, the
          "+ Add image" toggle (display_box only), the "Preview in digest →"
          link, and an auto-save indicator. Auto-saves on valid JSON. */}
      <CreativeForm
        mode="edit"
        creativeId={creative.id}
        format={creative.format}
        initialPayload={JSON.stringify(creative.payload, null, 2)}
        initialImageUrl={creative.image_blob_url}
        initialAltText={creative.alt_text}
        returnPath={returnPath}
      />

      <div style={{ marginTop: 16, borderTop: "1px solid var(--a-border)", paddingTop: 12 }}>
        <div className="a-muted" style={{ fontSize: 12, marginBottom: 8 }}>
          <strong>Placements ({placements.length})</strong>
        </div>
        {placements.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            {placements.map((p) => {
              const slot = SLOTS[p.format]?.[p.slot_index - 1];
              const clicks = clicksByPlacement.get(p.id);
              return (
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
                    <strong>{p.sport}</strong> · {p.date} ·{" "}
                    {slot ? slot.label : `slot ${p.slot_index}`}
                    <span className="a-muted" style={{ marginLeft: 12 }}>
                      · clicks:{" "}
                      <strong style={{ color: "var(--a-text)" }}>
                        {clicks?.humans ?? 0}
                      </strong>
                      {clicks && clicks.bots > 0 && (
                        <> ({clicks.bots} bot{clicks.bots === 1 ? "" : "s"})</>
                      )}
                    </span>
                  </span>
                  <form action={deletePlacement}>
                    <input type="hidden" name="_return" value={returnPath} />
                    <input type="hidden" name="placement_id" value={p.id} />
                    <button type="submit" className="a-btn a-btn-sm">remove</button>
                  </form>
                </div>
              );
            })}
          </div>
        )}

        <form action={createPlacement} className="a-row" style={{ alignItems: "flex-end", gap: 8, flexWrap: "wrap" }}>
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
          <div className="a-field" style={{ marginBottom: 0, minWidth: 280, flex: 1 }}>
            <label className="a-label">Slot</label>
            <select name="slot_index" className="a-select" defaultValue={1}>
              {SLOTS[creative.format].map((slot, i) => (
                <option key={slot.id} value={i + 1}>{slot.label}</option>
              ))}
            </select>
          </div>
          <FormButton idleLabel="Add placement" pendingLabel="Saving…" />
        </form>
      </div>
    </Card>
  );
}
