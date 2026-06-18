import { supabaseAdmin } from "@/lib/supabase";
import { SLOTS, renderCreative, type AdFormat } from "@/lib/ads-render";
import { loadImpressionsByPair } from "@/lib/ad-impressions";
import { prettyDate } from "@/lib/dates";
import { requireAdvertiser } from "../require-advertiser";
import { signOut } from "./actions";

// /advertise/account — Advertiser portal.
// One screen: campaign cards sorted by relevance (live → approved-unpaid →
// pending → other), each with status + payment line + aggregate performance
// + placement list. Read-only in v1; editing creative and self-serve booking
// will land in follow-ups (#47/#48).
//
// Performance metric is the editorial-day reach for the league digest of the
// placement's sport — joined off sends.digest_date so it lines up with the
// same row count the cron operator sees, not an approximation. Bot/human
// clicks are summed; advertisers see clicks as clicks (#48 scope locked).

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Your campaigns · Advertiser portal · boxscore",
  robots: { index: false, follow: false },
};

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
};

type Creative = {
  id: string;
  campaign_id: string;
  format: AdFormat;
  payload: Record<string, unknown>;
  image_blob_url: string | null;
  alt_text: string | null;
};

type Placement = {
  id: string;
  creative_id: string;
  format: AdFormat;
  sport: string;
  date: string;
  slot_index: number;
};

async function loadCampaigns(advertiserId: string): Promise<Campaign[]> {
  const { data, error } = await supabaseAdmin()
    .from("ad_campaigns")
    .select("id, name, status, paid_at, paid_amount_cents, paid_method, notes, created_at")
    .eq("advertiser_id", advertiserId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`load campaigns: ${error.message}`);
  return (data ?? []) as Campaign[];
}

async function loadCreatives(campaignIds: string[]): Promise<Creative[]> {
  if (campaignIds.length === 0) return [];
  const { data, error } = await supabaseAdmin()
    .from("ad_creatives")
    .select("id, campaign_id, format, payload, image_blob_url, alt_text")
    .in("campaign_id", campaignIds);
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

// Sum clicks per placement_id from link_clicks. Per #48 scope, humans and bots
// are reported together — the is_bot flag is admin-only context.
async function loadClicks(placementIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (placementIds.length === 0) return counts;
  const { data, error } = await supabaseAdmin()
    .from("link_clicks")
    .select("placement_id")
    .in("placement_id", placementIds);
  if (error) {
    console.error(`load clicks: ${error.message}`);
    return counts;
  }
  for (const r of (data ?? []) as Array<{ placement_id: string }>) {
    counts.set(r.placement_id, (counts.get(r.placement_id) ?? 0) + 1);
  }
  return counts;
}

function isLive(c: Campaign): boolean {
  return c.status === "approved" && c.paid_at !== null;
}

function statusLabel(c: Campaign): string {
  if (isLive(c)) return "Live";
  if (c.status === "approved" && !c.paid_at) return "Approved — pending payment";
  if (c.status === "pending")  return "Awaiting approval";
  if (c.status === "rejected") return "Rejected";
  return "Cancelled";
}

function statusColor(c: Campaign): string {
  if (isLive(c)) return "#0a7f2e";
  if (c.status === "approved") return "#7a5a00";
  if (c.status === "pending")  return "#7a5a00";
  return "#8a1a1a";
}

// Sort order: live first (most-relevant for a returning advertiser), then
// approved-but-unpaid, then pending, then rejected/cancelled. Within a bucket,
// newest-created campaigns come first.
function campaignSortKey(c: Campaign): number {
  if (isLive(c)) return 0;
  if (c.status === "approved") return 1;
  if (c.status === "pending")  return 2;
  return 3;
}

function formatCents(cents: number | null): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

function slotLabel(format: AdFormat, slotIndex: number): string {
  return SLOTS[format]?.[slotIndex - 1]?.label ?? `slot ${slotIndex}`;
}

function formatLabel(format: AdFormat): string {
  switch (format) {
    case "sponsor_line":    return "Sponsor line";
    case "standings_strip": return "Standings strip";
    case "display_box":     return "Display box";
    case "classified":      return "Classified";
  }
}

export default async function AdvertiseAccountPage() {
  const { email, advertiserId, advertiserName } = await requireAdvertiser();

  const campaigns = (await loadCampaigns(advertiserId)).sort((a, b) => {
    const k = campaignSortKey(a) - campaignSortKey(b);
    if (k !== 0) return k;
    return b.created_at.localeCompare(a.created_at);
  });

  const creatives = await loadCreatives(campaigns.map((c) => c.id));
  const placements = await loadPlacements(creatives.map((cr) => cr.id));
  const clicksByPlacement = await loadClicks(placements.map((p) => p.id));
  const impressionsByPair = await loadImpressionsByPair(
    placements.map((p) => ({ sport: p.sport, date: p.date })),
  );

  const creativesByCampaign = new Map<string, Creative[]>();
  for (const cr of creatives) {
    const list = creativesByCampaign.get(cr.campaign_id) ?? [];
    list.push(cr);
    creativesByCampaign.set(cr.campaign_id, list);
  }
  const placementsByCreative = new Map<string, Placement[]>();
  for (const p of placements) {
    const list = placementsByCreative.get(p.creative_id) ?? [];
    list.push(p);
    placementsByCreative.set(p.creative_id, list);
  }

  return (
    <main className="advertise-page">
      <div className="advertise-masthead">
        <div className="advertise-masthead-section">Advertiser portal</div>
        <div className="advertise-masthead-edition">{advertiserName}</div>
      </div>

      <header className="advertise-lede" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1>Your campaigns.</h1>
          <p>
            Signed in as <code>{email}</code>. Impressions are unique email
            opens (deduped by recipient) plus pageviews on the dated digest
            (boxscore.email/{`<sport>`}/{`<date>`}) where your ad ran.
            Clicks are first-party tracked from the ad&rsquo;s call-to-action.
          </p>
        </div>
        <form action={signOut}>
          <button type="submit" className="admin-btn">Sign out</button>
        </form>
      </header>

      {campaigns.length === 0 ? (
        <section className="advertise-section">
          <p className="advertise-meta">
            No campaigns on file yet. If you&rsquo;ve recently booked one, it
            will appear here once it&rsquo;s set up.{" "}
            <a href="mailto:hello@boxscore.email">Email us</a> if something looks
            wrong.
          </p>
        </section>
      ) : (
        campaigns.map((c) => {
          const campaignCreatives = creativesByCampaign.get(c.id) ?? [];
          const campaignPlacements = campaignCreatives.flatMap(
            (cr) => placementsByCreative.get(cr.id) ?? [],
          );
          let emailImpressions = 0;
          let webImpressions   = 0;
          let totalClicks      = 0;
          for (const p of campaignPlacements) {
            const imp = impressionsByPair.get(`${p.sport}|${p.date}`);
            emailImpressions += imp?.email ?? 0;
            webImpressions   += imp?.web   ?? 0;
            totalClicks      += clicksByPlacement.get(p.id) ?? 0;
          }
          const totalImpressions = emailImpressions + webImpressions;
          const ctr = totalImpressions > 0
            ? (totalClicks / totalImpressions) * 100
            : 0;

          return (
            <section key={c.id} className="advertise-section">
              <div className="advertise-section-head">
                <span
                  className="advertise-section-eyebrow"
                  style={{ color: statusColor(c) }}
                >
                  {statusLabel(c)}
                </span>
                <h2 className="advertise-section-title">{c.name}</h2>
              </div>

              <dl className="advertise-stats" style={{ marginTop: 0 }}>
                <div className="advertise-stat">
                  <dt>Impressions</dt>
                  <dd>{totalImpressions.toLocaleString()}</dd>
                </div>
                <div className="advertise-stat">
                  <dt>Email opens</dt>
                  <dd>{emailImpressions.toLocaleString()}</dd>
                </div>
                <div className="advertise-stat">
                  <dt>Web views</dt>
                  <dd>{webImpressions.toLocaleString()}</dd>
                </div>
                <div className="advertise-stat">
                  <dt>Clicks</dt>
                  <dd>{totalClicks.toLocaleString()}</dd>
                </div>
                <div className="advertise-stat">
                  <dt>CTR</dt>
                  <dd>{totalImpressions > 0 ? `${ctr.toFixed(2)}%` : "—"}</dd>
                </div>
              </dl>

              <p className="advertise-meta">
                <strong>Payment:</strong>{" "}
                {c.paid_at ? (
                  <>
                    {formatCents(c.paid_amount_cents)}
                    {c.paid_method && <> · {c.paid_method}</>}
                    {" "}· recorded {new Date(c.paid_at).toLocaleDateString()}
                  </>
                ) : (
                  <>Not yet recorded.</>
                )}
              </p>

              {campaignCreatives.length > 0 && (
                <div className="advertise-creatives">
                  <h3 className="advertise-creatives-heading">
                    {campaignCreatives.length === 1 ? "Creative" : "Creatives"}
                  </h3>
                  {campaignCreatives.map((cr) => {
                    const ctaUrl = typeof cr.payload.cta_url === "string"
                      ? cr.payload.cta_url
                      : "#";
                    // renderCreative returns sanitized HTML — payload text is
                    // run through sanitizeInlineHtml and the href is run
                    // through safeHref. dangerouslySetInnerHTML is the same
                    // mechanism the digest itself uses to inline these.
                    const html = renderCreative({
                      format: cr.format,
                      payload: cr.payload,
                      imageUrl: cr.image_blob_url,
                      altText: cr.alt_text,
                      ctaUrl,
                      target: "web",
                    });
                    return (
                      <div key={cr.id} className="advertise-creative-preview">
                        <div className="advertise-creative-label">
                          {formatLabel(cr.format)}
                        </div>
                        <div
                          className="advertise-creative-frame"
                          dangerouslySetInnerHTML={{ __html: html }}
                        />
                      </div>
                    );
                  })}
                </div>
              )}

              {campaignPlacements.length === 0 ? (
                <p className="advertise-meta">
                  No placements scheduled yet for this campaign.
                </p>
              ) : (
                <table className="advertise-rates" style={{ marginTop: 12 }}>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Sport</th>
                      <th>Format</th>
                      <th>Slot</th>
                      <th>Email opens</th>
                      <th>Web views</th>
                      <th>Clicks</th>
                      <th>CTR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaignPlacements.map((p) => {
                      const imp    = impressionsByPair.get(`${p.sport}|${p.date}`);
                      const email  = imp?.email ?? 0;
                      const web    = imp?.web   ?? 0;
                      const clicks = clicksByPlacement.get(p.id) ?? 0;
                      const impTotal = email + web;
                      const ctr = impTotal > 0 ? (clicks / impTotal) * 100 : 0;
                      return (
                        <tr key={p.id}>
                          <td data-label="Date">{prettyDate(p.date)}</td>
                          <td data-label="Sport">{p.sport.toUpperCase()}</td>
                          <td data-label="Format">{formatLabel(p.format)}</td>
                          <td data-label="Slot">{slotLabel(p.format, p.slot_index)}</td>
                          <td data-label="Email opens">{email.toLocaleString()}</td>
                          <td data-label="Web views">{web.toLocaleString()}</td>
                          <td data-label="Clicks">{clicks.toLocaleString()}</td>
                          <td data-label="CTR">{impTotal > 0 ? `${ctr.toFixed(2)}%` : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </section>
          );
        })
      )}
    </main>
  );
}
