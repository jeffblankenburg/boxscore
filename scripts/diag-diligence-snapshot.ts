// One-shot diligence-style snapshot: pulls every headline number we can
// answer from current data, so the diligence-plan doc has real numbers
// instead of guesses.

import { supabaseAdmin } from "../lib/supabase";
import { yesterdayInET } from "../lib/dates";

async function main(): Promise<void> {
  const db = supabaseAdmin();

  console.log("─── SUBSCRIBER COUNTS ──────────────────────────────");
  const counts: Record<string, number> = {};
  for (const status of ["active", "pending", "unsubscribed"]) {
    const { count } = await db.from("subscribers").select("id", { count: "exact", head: true }).eq("status", status);
    counts[status] = count ?? 0;
  }
  console.log(`  active:        ${counts.active!.toLocaleString()}`);
  console.log(`  pending:       ${counts.pending!.toLocaleString()}`);
  console.log(`  unsubscribed:  ${counts.unsubscribed!.toLocaleString()}`);
  console.log(`  total ever:    ${(counts.active! + counts.pending! + counts.unsubscribed!).toLocaleString()}`);

  console.log("\n─── SUBSCRIBER GROWTH (last 30 days, by activated-day) ─");
  // confirmed_at OR created_at (covers both flows). Group by date.
  type Row = { created_at: string; confirmed_at: string | null; status: string };
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("subscribers")
      .select("created_at, confirmed_at, status")
      .order("created_at", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as Row[];
    rows.push(...page);
    if (page.length < 1000) break;
  }
  console.log(`  (loaded ${rows.length.toLocaleString()} subscriber rows)`);

  const sinceMs = Date.now() - 30 * 86_400_000;
  const newPerDay = new Map<string, number>();
  let newL30 = 0, newL7 = 0;
  for (const r of rows) {
    const t = r.confirmed_at ?? r.created_at;
    if (!t) continue;
    const ms = new Date(t).getTime();
    if (ms < sinceMs) continue;
    const day = t.slice(0, 10);
    newPerDay.set(day, (newPerDay.get(day) ?? 0) + 1);
    newL30++;
    if (ms >= Date.now() - 7 * 86_400_000) newL7++;
  }
  console.log(`  new last 7d:   ${newL7.toLocaleString()}  (${(newL7 / 7).toFixed(0)}/day avg)`);
  console.log(`  new last 30d:  ${newL30.toLocaleString()}  (${(newL30 / 30).toFixed(0)}/day avg)`);

  console.log("\n─── UNSUBSCRIBE REASONS (all-time) ─────────────────");
  const { data: reasons } = await db
    .from("subscribers")
    .select("unsubscribe_reason")
    .eq("status", "unsubscribed");
  const reasonCounts = new Map<string, number>();
  for (const r of (reasons ?? []) as Array<{ unsubscribe_reason: string | null }>) {
    const k = r.unsubscribe_reason ?? "(null)";
    reasonCounts.set(k, (reasonCounts.get(k) ?? 0) + 1);
  }
  for (const [k, v] of [...reasonCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(14)} ${v.toLocaleString()}`);
  }

  console.log("\n─── DEMOGRAPHICS COMPLETION ────────────────────────");
  const { count: demoDone } = await db.from("subscribers").select("id", { count: "exact", head: true })
    .eq("status", "active").not("demographics_completed_at", "is", null);
  console.log(`  completed:     ${(demoDone ?? 0).toLocaleString()}  (${((demoDone ?? 0) / (counts.active || 1) * 100).toFixed(1)}% of active)`);

  console.log("\n─── EMAIL SUBSCRIPTIONS (active opt-ins) ───────────");
  type Sub = { sport: string; scope: string };
  const subs: Sub[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from("email_subscriptions").select("sport, scope")
      .eq("active", true).range(from, from + 999);
    const page = (data ?? []) as Sub[];
    subs.push(...page);
    if (page.length < 1000) break;
  }
  const byKey = new Map<string, number>();
  for (const s of subs) byKey.set(`${s.sport}/${s.scope}`, (byKey.get(`${s.sport}/${s.scope}`) ?? 0) + 1);
  for (const [k, v] of [...byKey.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(14)} ${v.toLocaleString()}`);
  }

  console.log("\n─── RECENT ENGAGEMENT (daily_metrics, last 7 days) ─");
  const { data: dm } = await db.from("daily_metrics").select("date, delivered, opened, team_delivered, team_opened, web_pageviews, active_subscribers, team_active_subscribers")
    .eq("sport", "mlb").order("date", { ascending: false }).limit(7);
  console.log(`  date         lg_open_rate  team_open_rate  web   subs(lg/tm)`);
  for (const r of (dm ?? []) as Array<{
    date: string; delivered: number | null; opened: number | null;
    team_delivered: number | null; team_opened: number | null;
    web_pageviews: number | null; active_subscribers: number | null; team_active_subscribers: number | null;
  }>) {
    const lor = r.delivered && r.delivered > 0 ? `${((r.opened ?? 0) / r.delivered * 100).toFixed(1)}%` : "—";
    const tor = r.team_delivered && r.team_delivered > 0 ? `${((r.team_opened ?? 0) / r.team_delivered * 100).toFixed(1)}%` : "—";
    const subs = `${r.active_subscribers ?? "—"}/${r.team_active_subscribers ?? "—"}`;
    console.log(`  ${r.date}   ${lor.padEnd(13)} ${tor.padEnd(14)} ${String(r.web_pageviews ?? 0).padEnd(5)} ${subs}`);
  }

  console.log("\n─── REVENUE PROXIES ────────────────────────────────");
  const { count: tipClicks } = await db.from("support_clicks").select("id", { count: "exact", head: true });
  console.log(`  Ko-fi link clicks (all-time): ${(tipClicks ?? 0).toLocaleString()}  (actual tip $ lives in Ko-fi)`);
  const { count: paidCampaigns } = await db.from("ad_campaigns").select("id", { count: "exact", head: true }).not("paid_at", "is", null);
  console.log(`  paid ad campaigns:            ${paidCampaigns ?? 0}`);

  console.log("\n─── PUZZLE / GAME ENGAGEMENT ───────────────────────");
  const { count: puzzleAttempts } = await db.from("puzzle_attempts").select("subscriber_id", { count: "exact", head: true });
  console.log(`  puzzle attempts (rows):       ${(puzzleAttempts ?? 0).toLocaleString()}`);
  const { count: endlessRuns } = await db.from("statsharks_endless_runs").select("id", { count: "exact", head: true });
  console.log(`  StatSharks endless runs:      ${(endlessRuns ?? 0).toLocaleString()}`);

  console.log("\n─── WEB TRAFFIC (last 30 days, production) ─────────");
  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { count: pv30 } = await db.from("page_views").select("id", { count: "exact", head: true })
    .eq("event_type", "pageview").eq("vercel_environment", "production").gte("occurred_at", since30);
  console.log(`  pageviews 30d:                ${(pv30 ?? 0).toLocaleString()}`);

  console.log("\n─── RSS POLLING (last 7 days) ──────────────────────");
  const since7 = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { count: rss7 } = await db.from("rss_polls").select("id", { count: "exact", head: true })
    .gte("polled_at", since7);
  console.log(`  RSS polls 7d:                 ${(rss7 ?? 0).toLocaleString()}`);

  console.log("\n─── SOCIAL FOLLOWERS ───────────────────────────────");
  type SF = { platform: string };
  const { data: sf } = await db.from("social_followers").select("platform")
    .is("removed_at", null);
  const byPlatform = new Map<string, number>();
  for (const r of (sf ?? []) as SF[]) byPlatform.set(r.platform, (byPlatform.get(r.platform) ?? 0) + 1);
  for (const [k, v] of byPlatform) console.log(`  ${k.padEnd(10)} ${v.toLocaleString()}`);

  console.log("\n─── EDITION & CONTENT VOLUME ───────────────────────");
  const today = yesterdayInET();
  const { count: digestsAll } = await db.from("daily_digests").select("date", { count: "exact", head: true });
  console.log(`  total daily_digests:          ${digestsAll ?? 0}`);
  const { count: teamDigestsAll } = await db.from("team_digests").select("date", { count: "exact", head: true });
  console.log(`  total team_digests:           ${teamDigestsAll ?? 0}`);
  const { count: historicalGames } = await db.from("historical_games").select("game_pk", { count: "exact", head: true });
  console.log(`  historical_games rows:        ${(historicalGames ?? 0).toLocaleString()}`);
  const { count: playerLines } = await db.from("historical_player_lines").select("id", { count: "exact", head: true });
  console.log(`  historical_player_lines:      ${(playerLines ?? 0).toLocaleString()}`);

  console.log(`\nReport generated for edition date ${today}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
