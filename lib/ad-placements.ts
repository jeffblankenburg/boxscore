// Production ad placement lookup + render integration. Bridges the
// ad_placements schema (issue #44) with the digest renderers
// (lib/render.ts / lib/render-email.ts) so the daily cron can splice live
// creatives into the HTML it stores to daily_digests.
//
// Date semantics:
//   ad_placements.date stores the EDITION date — the day the digest is
//   delivered, matching what the admin types into the placement form.
//   `renderContentWithAds(data, …)` translates from data.date
//   (games_date) to edition_date via nextDay() before querying.
//
// Safety: five layers around the splice work — see comments inline. The
// guarantee is that if anything goes wrong with ads, the digest still
// ships unmodified.

import { supabaseAdmin } from "./supabase";
import { nextDay } from "./dates";
import { isFlagEnabled } from "./admin-settings";
import { trackedAdLink } from "./link-tracking";
import {
  renderCreative,
  spliceIntoDigest,
  type AdFormat,
  type Payload,
} from "./ads-render";
import { renderContent, type DailyData } from "./render";
import { renderEmailContent } from "./render-email";

// Setting key the admin toggle on /admin/ads writes/reads.
export const ADS_ENABLED_FLAG = "ads_enabled";

export type LivePlacement = {
  placement_id: string;
  format: AdFormat;
  slot_index: number;
  creative: {
    id: string;
    payload: Payload;
    image_blob_url: string | null;
    alt_text: string | null;
  };
};

// Returns every placement that's live for (sport, editionDate). Live =
// the joined campaign is approved AND has paid_at set. Sorted by
// slot_index so render order is deterministic. The unique constraint on
// (sport, date, format, slot_index) means at most one creative per slot.
export async function getLivePlacements(
  sport: string,
  editionDate: string,
): Promise<LivePlacement[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("ad_placements")
    .select(
      "id, slot_index, format, " +
        "creative:ad_creatives!inner ( id, payload, image_blob_url, alt_text, " +
        "campaign:ad_campaigns!inner ( status, paid_at ) )",
    )
    .eq("sport", sport)
    .eq("date", editionDate)
    .order("slot_index", { ascending: true });
  if (error) throw new Error(`getLivePlacements: ${error.message}`);

  type RawCampaign = { status: string; paid_at: string | null };
  type RawCreative = {
    id: string;
    payload: Payload;
    image_blob_url: string | null;
    alt_text: string | null;
    campaign: RawCampaign | RawCampaign[] | null;
  };
  type RawRow = {
    id: string;
    slot_index: number;
    format: AdFormat;
    creative: RawCreative | RawCreative[] | null;
  };

  const result: LivePlacement[] = [];
  for (const row of (data ?? []) as unknown as RawRow[]) {
    const cr = Array.isArray(row.creative) ? row.creative[0] : row.creative;
    if (!cr) continue;
    const cam = Array.isArray(cr.campaign) ? cr.campaign[0] : cr.campaign;
    if (!cam) continue;
    if (cam.status !== "approved") continue;
    if (cam.paid_at === null) continue;
    result.push({
      placement_id: row.id,
      format: row.format,
      slot_index: row.slot_index,
      creative: {
        id: cr.id,
        payload: cr.payload,
        image_blob_url: cr.image_blob_url,
        alt_text: cr.alt_text,
      },
    });
  }
  return result;
}

// ────────────────────────────────────────────────────────────────────────
// Render-with-ads wrappers — the entry points the cron calls.
// ────────────────────────────────────────────────────────────────────────

type SpliceResult = {
  html: string;
  rendered: number;
  skipped: number;
  errors: string[];
};

// Fetch + render + splice every live placement into `digestHtml`. Wraps
// the whole thing in five safety layers so a misbehaving placement can't
// take down the daily send.
async function spliceLiveAds(args: {
  digestHtml: string;
  sport: string;
  editionDate: string;
  target: "web" | "email";
}): Promise<SpliceResult> {
  // Layer 1: kill switch. The `ads_enabled` flag in admin_settings is the
  // master on/off. An admin can flip it from /admin/ads in seconds without
  // a redeploy. If the lookup itself fails for any reason (table missing,
  // network), default to FALSE so the safe behavior is "no ads."
  const adsEnabled = await isFlagEnabled(ADS_ENABLED_FLAG).catch(() => false);
  if (!adsEnabled) {
    return { html: args.digestHtml, rendered: 0, skipped: 0, errors: [] };
  }

  // Layer 2: sport scope. v1 of the ad pipeline (#44) is MLB-league only.
  // Other sports skip the whole thing — placements wouldn't render in
  // their renderers anyway.
  if (args.sport !== "mlb") {
    return { html: args.digestHtml, rendered: 0, skipped: 0, errors: [] };
  }

  // Layer 3: try/catch around the DB query. Any failure here returns the
  // unmodified digest — the send goes out ad-free rather than not at all.
  let placements: LivePlacement[];
  try {
    placements = await getLivePlacements(args.sport, args.editionDate);
  } catch (err) {
    return {
      html: args.digestHtml,
      rendered: 0,
      skipped: 0,
      errors: [`fetch placements: ${(err as Error).message}`],
    };
  }

  if (placements.length === 0) {
    return { html: args.digestHtml, rendered: 0, skipped: 0, errors: [] };
  }

  // Layer 4: try/catch per creative. One bad payload throwing during
  // renderCreative or spliceIntoDigest doesn't take down the others.
  // Layer 5: spliceIntoDigest silently returns the input unchanged when
  // its anchor regex doesn't match — we detect that here and count as
  // "skipped" rather than render-success.
  let html = args.digestHtml;
  let rendered = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const p of placements) {
    try {
      const rawCtaUrl =
        typeof p.creative.payload.cta_url === "string"
          ? p.creative.payload.cta_url
          : "#";
      // Wrap the destination URL through our first-party redirect for
      // click tracking. If the wrapper fails (DB read of the secret, HMAC
      // generation, anything), fall back to the raw URL — losing click
      // attribution is far better than serving a broken ad.
      let ctaUrl = rawCtaUrl;
      if (rawCtaUrl !== "#") {
        try {
          ctaUrl = await trackedAdLink(p.placement_id, rawCtaUrl);
        } catch (err) {
          errors.push(
            `placement ${p.placement_id} tracked-link generation: ${(err as Error).message}`,
          );
        }
      }
      const creativeHtml = renderCreative({
        format: p.format,
        payload: p.creative.payload,
        imageUrl: p.creative.image_blob_url,
        altText: p.creative.alt_text,
        ctaUrl,
        target: args.target,
      });
      const next = spliceIntoDigest({
        digestHtml: html,
        format: p.format,
        slotIndex: p.slot_index,
        creativeHtml,
        target: args.target,
      });
      if (next === html) {
        skipped++;
      } else {
        html = next;
        rendered++;
      }
    } catch (err) {
      skipped++;
      errors.push(
        `placement ${p.placement_id} (${p.format} slot ${p.slot_index}): ${(err as Error).message}`,
      );
    }
  }

  return { html, rendered, skipped, errors };
}

// Web variant — same call pattern as renderContent(data) but async and
// with ads spliced in. Logs `[ads] mlb {date} web: X rendered, Y skipped`
// so the daily cron output shows what was injected.
export async function renderContentWithAds(
  data: DailyData,
  sport: string,
): Promise<string> {
  const baseHtml = renderContent(data);
  const editionDate = nextDay(data.date);
  const result = await spliceLiveAds({
    digestHtml: baseHtml,
    sport,
    editionDate,
    target: "web",
  });
  console.log(
    `[ads] ${sport} ${editionDate} web: ${result.rendered} rendered, ${result.skipped} skipped` +
      (result.errors.length > 0 ? ` · errors: ${result.errors.join("; ")}` : ""),
  );
  return result.html;
}

// Email variant. Same date convention, same safety layers.
export async function renderEmailContentWithAds(
  data: DailyData,
  sport: string,
): Promise<string> {
  const baseHtml = renderEmailContent(data);
  const editionDate = nextDay(data.date);
  const result = await spliceLiveAds({
    digestHtml: baseHtml,
    sport,
    editionDate,
    target: "email",
  });
  console.log(
    `[ads] ${sport} ${editionDate} email: ${result.rendered} rendered, ${result.skipped} skipped` +
      (result.errors.length > 0 ? ` · errors: ${result.errors.join("; ")}` : ""),
  );
  return result.html;
}
