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
import { nextDay, prettyDate, yesterdayInET } from "@/lib/dates";
import { SLOTS, type AdFormat } from "@/lib/ads-render";
import { loadPlacementImpressionsByIds } from "@/lib/admin-aggregates";
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
  // Per-placement impressions + clicks served from daily_placement_imps
  // (migration 0062, refreshed nightly by /api/cron/aggregate-stats).
  // Drops the per-request sends + email_events + page_views + link_clicks
  // scan to a single indexed lookup. Shape the rows into the existing
  // clicksByPlacement + impressionsByPair maps so downstream rendering
  // doesn't change.
  const impRows = await loadPlacementImpressionsByIds(placements.map((p) => p.id));
  const clicksByPlacement = new Map<string, ClickCount>();
  const impressionsByPair = new Map<string, { email: number; web: number }>();
  for (const p of placements) {
    const r = impRows.get(p.id);
    clicksByPlacement.set(p.id, { humans: r?.human_clicks ?? 0, bots: r?.bot_clicks ?? 0 });
    impressionsByPair.set(`${p.sport}|${p.date}`, { email: r?.email_unique_opens ?? 0, web: r?.web_pageviews ?? 0 });
  }
  const placementsByCreative = new Map<string, Placement[]>();
  for (const p of placements) {
    const list = placementsByCreative.get(p.creative_id) ?? [];
    list.push(p);
    placementsByCreative.set(p.creative_id, list);
  }

  // Campaign-wide performance totals for the Performance section. Clicks are
  // the human count only — bots are tracked but excluded from the headline
  // CTR because they don't represent commercial attention. The per-placement
  // breakout below still surfaces bot counts so the admin can spot anomalies.
  let emailImpressions = 0;
  let webImpressions   = 0;
  let totalHumanClicks = 0;
  for (const p of placements) {
    const imp = impressionsByPair.get(`${p.sport}|${p.date}`);
    emailImpressions += imp?.email ?? 0;
    webImpressions   += imp?.web   ?? 0;
    totalHumanClicks += clicksByPlacement.get(p.id)?.humans ?? 0;
  }
  const totalImpressions = emailImpressions + webImpressions;
  const overallCtr = totalImpressions > 0
    ? (totalHumanClicks / totalImpressions) * 100
    : 0;

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

      <Section title="Performance">
        <Card>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: 16,
              marginBottom: placements.length > 0 ? 16 : 0,
            }}
          >
            <PerfStat label="Impressions" value={totalImpressions.toLocaleString()} />
            <PerfStat label="Email opens" value={emailImpressions.toLocaleString()} />
            <PerfStat label="Web views"   value={webImpressions.toLocaleString()} />
            <PerfStat label="Clicks"      value={totalHumanClicks.toLocaleString()} />
            <PerfStat
              label="CTR"
              value={totalImpressions > 0 ? `${overallCtr.toFixed(2)}%` : "—"}
            />
            <PerfStat label="Placements" value={String(placements.length)} />
          </div>
          {placements.length > 0 && (
            <table className="a-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Sport</th>
                  <th>Format</th>
                  <th>Slot</th>
                  <th style={{ textAlign: "right" }}>Email opens</th>
                  <th style={{ textAlign: "right" }}>Web views</th>
                  <th style={{ textAlign: "right" }}>Clicks</th>
                  <th style={{ textAlign: "right" }}>CTR</th>
                </tr>
              </thead>
              <tbody>
                {[...placements]
                  .sort((a, b) => a.date.localeCompare(b.date))
                  .map((p) => {
                    const imp    = impressionsByPair.get(`${p.sport}|${p.date}`);
                    const email  = imp?.email ?? 0;
                    const web    = imp?.web   ?? 0;
                    const clicks = clicksByPlacement.get(p.id);
                    const humans = clicks?.humans ?? 0;
                    const bots   = clicks?.bots   ?? 0;
                    const slot   = SLOTS[p.format]?.[p.slot_index - 1];
                    const impTotal = email + web;
                    const ctr = impTotal > 0 ? (humans / impTotal) * 100 : 0;
                    return (
                      <tr key={p.id}>
                        <td>{prettyDate(p.date)}</td>
                        <td>{p.sport.toUpperCase()}</td>
                        <td>{p.format}</td>
                        <td>{slot ? slot.label : `slot ${p.slot_index}`}</td>
                        <td style={{ textAlign: "right" }}>{email.toLocaleString()}</td>
                        <td style={{ textAlign: "right" }}>{web.toLocaleString()}</td>
                        <td style={{ textAlign: "right" }}>
                          {humans.toLocaleString()}
                          {bots > 0 && (
                            <span className="a-muted">
                              {" "}({bots.toLocaleString()} bot{bots === 1 ? "" : "s"})
                            </span>
                          )}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          {impTotal > 0 ? `${ctr.toFixed(2)}%` : "—"}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
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
              // Compute the calendar day immediately after this placement
              // so the "+ next day" button posts a single-date placement
              // anchored at the day-after. Date math via UTC midnight to
              // dodge DST drift.
              const next = new Date(`${p.date}T00:00:00Z`);
              next.setUTCDate(next.getUTCDate() + 1);
              const nextDay = next.toISOString().slice(0, 10);
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
                  <div className="a-row" style={{ gap: 6 }}>
                    <form action={createPlacement}>
                      <input type="hidden" name="_return" value={returnPath} />
                      <input type="hidden" name="creative_id" value={p.creative_id} />
                      <input type="hidden" name="sport" value={p.sport} />
                      <input type="hidden" name="start_date" value={nextDay} />
                      <input type="hidden" name="end_date" value={nextDay} />
                      <input type="hidden" name="slot_index" value={p.slot_index} />
                      <button
                        type="submit"
                        className="a-btn a-btn-sm"
                        title={`Add the same placement for ${nextDay}`}
                      >+ next day</button>
                    </form>
                    <form action={deletePlacement}>
                      <input type="hidden" name="_return" value={returnPath} />
                      <input type="hidden" name="placement_id" value={p.id} />
                      <button type="submit" className="a-btn a-btn-sm">remove</button>
                    </form>
                  </div>
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
          <div className="a-field" style={{ marginBottom: 0, width: 150 }}>
            <label className="a-label">Start date</label>
            <input
              name="start_date"
              type="date"
              required
              defaultValue={defaultDate}
              className="a-input"
            />
          </div>
          <div className="a-field" style={{ marginBottom: 0, width: 150 }}>
            <label className="a-label">End date</label>
            <input
              name="end_date"
              type="date"
              defaultValue={defaultDate}
              className="a-input"
              title="Defaults to the start date for a single-day placement. Set a later date to create one placement per day in the range."
            />
          </div>
          <div className="a-field" style={{ marginBottom: 0, minWidth: 220, flex: 1 }}>
            <label className="a-label">Slot</label>
            <select name="slot_index" className="a-select" defaultValue={1}>
              {SLOTS[creative.format].map((slot, i) => (
                <option key={slot.id} value={i + 1}>{slot.label}</option>
              ))}
            </select>
          </div>
          <FormButton idleLabel="Add placement(s)" pendingLabel="Saving…" />
        </form>
      </div>
    </Card>
  );
}

function PerfStat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        border: "1px solid var(--a-border)",
        borderRadius: 4,
        padding: "10px 12px",
        background: "var(--a-bg-soft, transparent)",
      }}
    >
      <div
        className="a-muted"
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
    </div>
  );
}
