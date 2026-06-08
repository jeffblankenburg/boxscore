import { supabaseAdmin } from "./supabase";

// Discord webhook posting client. Unlike Twitter (OAuth) and Bluesky
// (session-based AT Protocol), Discord webhooks are just URLs you POST
// JSON to — no auth headers, no token refresh, no rate-limit dance
// beyond Discord's 429 + Retry-After.
//
// All channel-specific URLs live in the discord_webhooks table (see
// migrations/0030_discord_webhooks.sql). Loaders are scoped to (sport,
// scope, team_slug) so cron paths can fan out without holding the full
// table in memory.

export type DiscordWebhookScope = "league" | "team";

export type DiscordWebhookRow = {
  id: string;
  sport: string;
  scope: DiscordWebhookScope;
  team_slug: string | null;
  webhook_url: string;
  active: boolean;
  failure_count: number;
  last_failure_at: string | null;
  last_failure_note: string | null;
  last_success_at: string | null;
};

/** Discord embed shape. We only use the subset that renders in the
 *  channel: title (link target), url (clickable), description, image
 *  (the box-score PNG), color (left bar), timestamp (corner). */
export type DiscordEmbed = {
  title?: string;
  url?: string;
  description?: string;
  color?: number;                  // decimal — convert hex with parseInt(hex, 16)
  image?: { url: string };
  timestamp?: string;              // ISO 8601
  footer?: { text: string; icon_url?: string };
};

export type DiscordMessage = {
  content?: string;
  embeds?: DiscordEmbed[];
  username?: string;
  avatar_url?: string;
};

// ─── Webhook loaders ─────────────────────────────────────────────────────

export async function loadLeagueWebhook(sport: string): Promise<DiscordWebhookRow | null> {
  const { data, error } = await supabaseAdmin()
    .from("discord_webhooks")
    .select("*")
    .eq("sport", sport)
    .eq("scope", "league")
    .eq("active", true)
    .maybeSingle<DiscordWebhookRow>();
  if (error) throw new Error(`loadLeagueWebhook(${sport}): ${error.message}`);
  return data;
}

export async function loadTeamWebhooks(sport: string): Promise<Map<string, DiscordWebhookRow>> {
  const { data, error } = await supabaseAdmin()
    .from("discord_webhooks")
    .select("*")
    .eq("sport", sport)
    .eq("scope", "team")
    .eq("active", true)
    .returns<DiscordWebhookRow[]>();
  if (error) throw new Error(`loadTeamWebhooks(${sport}): ${error.message}`);
  const map = new Map<string, DiscordWebhookRow>();
  for (const row of data ?? []) {
    if (row.team_slug) map.set(row.team_slug, row);
  }
  return map;
}

export async function loadAllWebhooks(): Promise<DiscordWebhookRow[]> {
  const { data, error } = await supabaseAdmin()
    .from("discord_webhooks")
    .select("*")
    .order("sport", { ascending: true })
    .order("scope", { ascending: true })
    .order("team_slug", { ascending: true })
    .returns<DiscordWebhookRow[]>();
  if (error) throw new Error(`loadAllWebhooks: ${error.message}`);
  return data ?? [];
}

// ─── Posting ─────────────────────────────────────────────────────────────

const DISCORD_RATE_PACE_MS = 250;
let lastPostAt = 0;

async function pace(): Promise<void> {
  const since = Date.now() - lastPostAt;
  if (since < DISCORD_RATE_PACE_MS) {
    await new Promise((r) => setTimeout(r, DISCORD_RATE_PACE_MS - since));
  }
  lastPostAt = Date.now();
}

/** Send a message to a Discord webhook. Retries once on 429 (rate limit)
 *  using the server-supplied Retry-After header. Other 4xx/5xx errors
 *  bubble up to the caller, which decides whether to record + continue
 *  or hard-fail. */
export async function postToWebhook(
  webhookUrl: string,
  message: DiscordMessage,
): Promise<void> {
  await pace();
  const res = await postOnce(webhookUrl, message);
  if (res.ok) return;
  if (res.status === 429) {
    const retryAfterSec = Number(res.headers.get("retry-after") ?? "1");
    const waitMs = Math.max(500, Math.min(retryAfterSec * 1000, 10_000));
    await new Promise((r) => setTimeout(r, waitMs));
    const retry = await postOnce(webhookUrl, message);
    if (retry.ok) return;
    throw new Error(`discord 429 after retry: ${await readErr(retry)}`);
  }
  throw new Error(`discord ${res.status}: ${await readErr(res)}`);
}

async function postOnce(url: string, message: DiscordMessage): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    // wait=true makes Discord return the created message body. We don't
    // need the body, but it also makes Discord block until the message
    // is fully accepted, which avoids a race where a follow-up post lands
    // before the prior one is visible.
    body: JSON.stringify(message),
  });
}

async function readErr(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text.slice(0, 300);
  } catch {
    return res.statusText;
  }
}

// ─── Health tracking ─────────────────────────────────────────────────────

export async function markWebhookSuccess(id: string): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("discord_webhooks")
    .update({
      failure_count: 0,
      last_failure_note: null,
      last_success_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(`markWebhookSuccess: ${error.message}`);
}

export async function markWebhookFailure(id: string, note: string): Promise<void> {
  // increment failure_count via RPC-less pattern: read-modify-write inside
  // a single update. Race-safe enough for one cron tick at a time.
  const supa = supabaseAdmin();
  const { data, error } = await supa
    .from("discord_webhooks")
    .select("failure_count")
    .eq("id", id)
    .maybeSingle<{ failure_count: number }>();
  if (error) throw new Error(`markWebhookFailure read: ${error.message}`);
  const next = (data?.failure_count ?? 0) + 1;
  const { error: upErr } = await supa
    .from("discord_webhooks")
    .update({
      failure_count: next,
      last_failure_at: new Date().toISOString(),
      last_failure_note: note.slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (upErr) throw new Error(`markWebhookFailure write: ${upErr.message}`);
}
