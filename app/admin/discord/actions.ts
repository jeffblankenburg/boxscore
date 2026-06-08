"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { teamsBySport, type Sport } from "@/lib/teams";
import { requireAdmin } from "../require-admin";

const RETURN = "/admin/discord";

function err(msg: string): never {
  redirect(`${RETURN}?error=${encodeURIComponent(msg)}`);
}

function ok(msg: string): never {
  redirect(`${RETURN}?ok=${encodeURIComponent(msg)}`);
}

function readString(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
}

const VALID_SPORTS = new Set(["mlb", "nba", "wnba", "nfl", "nhl"]);
const WEBHOOK_RE = /^https:\/\/(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_\-]+/;

export async function createWebhook(formData: FormData): Promise<void> {
  await requireAdmin();
  const sport = readString(formData, "sport");
  const scope = readString(formData, "scope");
  const teamSlug = readString(formData, "team_slug") || null;
  const webhookUrl = readString(formData, "webhook_url");

  if (!VALID_SPORTS.has(sport)) err(`Invalid sport: ${sport}`);
  if (scope !== "league" && scope !== "team") err(`Invalid scope: ${scope}`);
  if (scope === "team" && !teamSlug) err("team_slug required for scope=team");
  if (scope === "league" && teamSlug) err("team_slug must be empty for scope=league");
  if (!WEBHOOK_RE.test(webhookUrl)) {
    err("webhook_url doesn't look like a Discord webhook URL (https://discord.com/api/webhooks/…)");
  }
  if (scope === "team" && teamSlug) {
    const validSlugs = new Set(teamsBySport(sport as Sport).map((t) => t.slug));
    if (!validSlugs.has(teamSlug)) {
      err(`Unknown team_slug for ${sport}: ${teamSlug}`);
    }
  }

  const { error } = await supabaseAdmin()
    .from("discord_webhooks")
    .insert({
      sport,
      scope,
      team_slug: teamSlug,
      webhook_url: webhookUrl,
      active: true,
    });
  if (error) {
    if (error.code === "23505") {
      err(`A webhook already exists for ${sport}/${scope}${teamSlug ? `/${teamSlug}` : ""}`);
    }
    err(`Insert failed: ${error.message}`);
  }
  revalidatePath(RETURN);
  ok(`Webhook added for ${sport}/${scope}${teamSlug ? `/${teamSlug}` : ""}.`);
}

export async function toggleWebhookActive(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = readString(formData, "id");
  if (!id) err("id required");

  const supa = supabaseAdmin();
  const { data, error } = await supa
    .from("discord_webhooks")
    .select("active, sport, scope, team_slug")
    .eq("id", id)
    .maybeSingle<{ active: boolean; sport: string; scope: string; team_slug: string | null }>();
  if (error || !data) err(`Webhook not found: ${id}`);

  const next = !data.active;
  const { error: upErr } = await supa
    .from("discord_webhooks")
    .update({ active: next, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (upErr) err(`Update failed: ${upErr.message}`);

  revalidatePath(RETURN);
  const label = `${data.sport}/${data.scope}${data.team_slug ? `/${data.team_slug}` : ""}`;
  ok(`${label} ${next ? "enabled" : "disabled"}.`);
}

export async function deleteWebhook(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = readString(formData, "id");
  if (!id) err("id required");

  const { error } = await supabaseAdmin()
    .from("discord_webhooks")
    .delete()
    .eq("id", id);
  if (error) err(`Delete failed: ${error.message}`);

  revalidatePath(RETURN);
  ok("Webhook removed.");
}

export async function resetWebhookFailures(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = readString(formData, "id");
  if (!id) err("id required");

  const { error } = await supabaseAdmin()
    .from("discord_webhooks")
    .update({
      failure_count: 0,
      last_failure_note: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) err(`Reset failed: ${error.message}`);
  revalidatePath(RETURN);
  ok("Failure counter cleared.");
}
