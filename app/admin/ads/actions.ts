"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "../require-admin";

// Server actions for the /admin/ads/* pages. Each action validates input,
// writes its table, and redirects back with ?ok=… or ?error=… so the
// destination page can surface the result.
//
// Every form that calls one of these actions includes a hidden `_return`
// input pointing at the URL the admin should land on after the action runs
// (the campaign detail, the advertiser detail, the campaigns list, etc.).
// `readReturn()` validates the path stays within /admin/ads so a stray
// value can't redirect somewhere unsafe.

const DEFAULT_RETURN = "/admin/ads";

function readString(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function readOptionalString(form: FormData, key: string): string | null {
  const v = readString(form, key);
  return v.length === 0 ? null : v;
}

function readReturn(form: FormData): string {
  const v = readString(form, "_return");
  if (v.startsWith("/admin/ads")) return v;
  return DEFAULT_RETURN;
}

function err(returnPath: string, msg: string): never {
  redirect(`${returnPath}?error=${encodeURIComponent(msg)}`);
}

function ok(returnPath: string, msg: string): never {
  redirect(`${returnPath}?ok=${encodeURIComponent(msg)}`);
}

function isValidStatus(s: string): s is "pending" | "approved" | "rejected" | "cancelled" {
  return s === "pending" || s === "approved" || s === "rejected" || s === "cancelled";
}

// ─── Advertisers ─────────────────────────────────────────────────────────

export async function createAdvertiser(formData: FormData): Promise<void> {
  await requireAdmin();
  const returnPath = readReturn(formData);
  const email = readString(formData, "email");
  const name = readString(formData, "name");
  const notes = readOptionalString(formData, "notes");

  if (!email) err(returnPath, "Advertiser email is required.");
  if (!name) err(returnPath, "Advertiser name is required.");

  const { data, error } = await supabaseAdmin()
    .from("ad_advertisers")
    .insert({ email, name, notes })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      err(returnPath, `An advertiser with email "${email}" already exists.`);
    }
    err(returnPath, `Create advertiser failed: ${error.message}`);
  }

  revalidatePath(returnPath);
  // After creating an advertiser, jump straight to their detail page so the
  // admin can immediately start adding campaigns. Falls back to the supplied
  // returnPath when the row's id isn't available (shouldn't happen).
  if (data?.id) {
    ok(`/admin/ads/advertisers/${data.id}`, `Created advertiser "${name}".`);
  }
  ok(returnPath, `Created advertiser "${name}".`);
}

// ─── Campaigns ───────────────────────────────────────────────────────────

export async function createCampaign(formData: FormData): Promise<void> {
  await requireAdmin();
  const returnPath = readReturn(formData);
  const advertiserId = readString(formData, "advertiser_id");
  const name = readString(formData, "name");
  const notes = readOptionalString(formData, "notes");

  if (!advertiserId) err(returnPath, "advertiser_id is required.");
  if (!name) err(returnPath, "Campaign name is required.");

  const { data, error } = await supabaseAdmin()
    .from("ad_campaigns")
    .insert({ advertiser_id: advertiserId, name, notes })
    .select("id")
    .single();

  if (error) err(returnPath, `Create campaign failed: ${error.message}`);

  revalidatePath(returnPath);
  if (data?.id) {
    ok(`/admin/ads/campaigns/${data.id}`, `Created campaign "${name}".`);
  }
  ok(returnPath, `Created campaign "${name}".`);
}

export async function setCampaignStatus(formData: FormData): Promise<void> {
  await requireAdmin();
  const returnPath = readReturn(formData);
  const campaignId = readString(formData, "campaign_id");
  const status = readString(formData, "status");

  if (!campaignId) err(returnPath, "campaign_id is required.");
  if (!isValidStatus(status)) err(returnPath, `Invalid status: ${status}`);

  const { error } = await supabaseAdmin()
    .from("ad_campaigns")
    .update({ status })
    .eq("id", campaignId);

  if (error) err(returnPath, `Update status failed: ${error.message}`);

  revalidatePath(returnPath);
  ok(returnPath, `Campaign status set to ${status}.`);
}

export async function markCampaignPaid(formData: FormData): Promise<void> {
  await requireAdmin();
  const returnPath = readReturn(formData);
  const campaignId = readString(formData, "campaign_id");
  const amountStr = readString(formData, "paid_amount");
  const method = readOptionalString(formData, "paid_method");

  if (!campaignId) err(returnPath, "campaign_id is required.");
  if (!amountStr) err(returnPath, "Paid amount is required.");

  // Accept "$250", "250", "250.00" — store as integer cents. Reject anything
  // that doesn't parse as a positive number once cleaned.
  const cleaned = amountStr.replace(/[$,\s]/g, "");
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    err(returnPath, `Invalid paid amount: ${amountStr}`);
  }
  const paidAmountCents = Math.round(parsed * 100);

  const { error } = await supabaseAdmin()
    .from("ad_campaigns")
    .update({
      paid_at: new Date().toISOString(),
      paid_amount_cents: paidAmountCents,
      paid_method: method,
    })
    .eq("id", campaignId);

  if (error) err(returnPath, `Mark paid failed: ${error.message}`);

  revalidatePath(returnPath);
  ok(returnPath, `Marked campaign paid: $${(paidAmountCents / 100).toFixed(2)}.`);
}

export async function unmarkCampaignPaid(formData: FormData): Promise<void> {
  await requireAdmin();
  const returnPath = readReturn(formData);
  const campaignId = readString(formData, "campaign_id");
  if (!campaignId) err(returnPath, "campaign_id is required.");

  const { error } = await supabaseAdmin()
    .from("ad_campaigns")
    .update({ paid_at: null, paid_amount_cents: null, paid_method: null })
    .eq("id", campaignId);

  if (error) err(returnPath, `Unmark paid failed: ${error.message}`);

  revalidatePath(returnPath);
  ok(returnPath, "Cleared paid status.");
}

// ─── Creatives ───────────────────────────────────────────────────────────

const VALID_FORMATS = new Set([
  "sponsor_line",
  "standings_strip",
  "display_box",
  "classified",
]);

export async function createCreative(formData: FormData): Promise<void> {
  await requireAdmin();
  const returnPath = readReturn(formData);
  const campaignId = readString(formData, "campaign_id");
  const format = readString(formData, "format");
  const payloadRaw = readString(formData, "payload");
  const imageBlobUrl = readOptionalString(formData, "image_blob_url");
  const altText = readOptionalString(formData, "alt_text");

  if (!campaignId) err(returnPath, "campaign_id is required.");
  if (!VALID_FORMATS.has(format)) err(returnPath, `Invalid format: ${format}`);
  if (!payloadRaw) err(returnPath, "Payload JSON is required.");

  let payload: unknown;
  try {
    payload = JSON.parse(payloadRaw);
  } catch (e) {
    err(returnPath, `Payload is not valid JSON: ${(e as Error).message}`);
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    err(returnPath, "Payload must be a JSON object.");
  }

  // Display-box without an image is allowed (text-only display box is fine),
  // but if image_blob_url is set, alt_text MUST be set for accessibility and
  // image-off email rendering fallback.
  if (imageBlobUrl && !altText) {
    err(returnPath, "Alt text is required when an image URL is set.");
  }

  const { error } = await supabaseAdmin()
    .from("ad_creatives")
    .insert({
      campaign_id: campaignId,
      format,
      payload,
      image_blob_url: imageBlobUrl,
      alt_text: altText,
    });

  if (error) err(returnPath, `Create creative failed: ${error.message}`);

  revalidatePath(returnPath);
  ok(returnPath, `Created ${format} creative.`);
}

export async function deleteCreative(formData: FormData): Promise<void> {
  await requireAdmin();
  const returnPath = readReturn(formData);
  const creativeId = readString(formData, "creative_id");
  if (!creativeId) err(returnPath, "creative_id is required.");

  // Cascades to ad_placements via on delete cascade.
  const { error } = await supabaseAdmin()
    .from("ad_creatives")
    .delete()
    .eq("id", creativeId);

  if (error) err(returnPath, `Delete creative failed: ${error.message}`);

  revalidatePath(returnPath);
  ok(returnPath, "Deleted creative.");
}

// ─── Placements ──────────────────────────────────────────────────────────

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_SPORTS = new Set(["mlb"]); // v1 — see ticket #44

export async function createPlacement(formData: FormData): Promise<void> {
  await requireAdmin();
  const returnPath = readReturn(formData);
  const creativeId = readString(formData, "creative_id");
  const sport = readString(formData, "sport");
  const date = readString(formData, "date");
  const slotIndexStr = readString(formData, "slot_index");

  if (!creativeId) err(returnPath, "creative_id is required.");
  if (!VALID_SPORTS.has(sport)) err(returnPath, `Invalid sport: ${sport}`);
  if (!ISO_DATE_RE.test(date)) err(returnPath, `Invalid date: ${date} (expected YYYY-MM-DD)`);
  const slotIndex = Number(slotIndexStr);
  if (!Number.isInteger(slotIndex) || slotIndex < 1) {
    err(returnPath, `Invalid slot_index: ${slotIndexStr}`);
  }

  // Denormalize creative.format onto the placement row so the unique
  // (sport, date, format, slot_index) index can enforce slot uniqueness
  // without a join. Read the format from the creative we're about to attach.
  const db = supabaseAdmin();
  const { data: creative, error: cErr } = await db
    .from("ad_creatives")
    .select("format")
    .eq("id", creativeId)
    .single();
  if (cErr || !creative) err(returnPath, `Creative not found: ${creativeId}`);

  const { error } = await db.from("ad_placements").insert({
    creative_id: creativeId,
    format: creative.format,
    sport,
    date,
    slot_index: slotIndex,
  });

  if (error) {
    if (error.code === "23505") {
      err(returnPath, `Slot already taken: ${sport} ${date} ${creative.format} #${slotIndex}.`);
    }
    err(returnPath, `Create placement failed: ${error.message}`);
  }

  revalidatePath(returnPath);
  ok(returnPath, `Placed ${creative.format} on ${sport} ${date} slot ${slotIndex}.`);
}

export async function deletePlacement(formData: FormData): Promise<void> {
  await requireAdmin();
  const returnPath = readReturn(formData);
  const placementId = readString(formData, "placement_id");
  if (!placementId) err(returnPath, "placement_id is required.");

  const { error } = await supabaseAdmin()
    .from("ad_placements")
    .delete()
    .eq("id", placementId);

  if (error) err(returnPath, `Delete placement failed: ${error.message}`);

  revalidatePath(returnPath);
  ok(returnPath, "Deleted placement.");
}
