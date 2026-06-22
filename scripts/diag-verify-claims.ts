// Verify every claim in docs/diligence-plan.md against the live database.
// Replaces the looser diag-diligence-snapshot.ts numbers with strict
// "what actually happened" measurements.
//
// Run: npx tsx --env-file=.env.local scripts/diag-verify-claims.ts

import { supabaseAdmin } from "../lib/supabase";

async function main(): Promise<void> {
  const db = supabaseAdmin();

  // ── 1. WHEN DID PUBLIC DAILY DELIVERY ACTUALLY START? ───────────────
  console.log("══ PUBLIC DAILY DELIVERY HISTORY ══════════════════════");
  // Earliest successful send-email cron run touching the public list.
  const { data: firstSend } = await db
    .from("cron_runs")
    .select("date, started_at, sport, result")
    .eq("route", "send-email")
    .eq("status", "ok")
    .order("started_at", { ascending: true })
    .limit(5);
  console.log("Earliest successful send-email cron runs:");
  for (const r of (firstSend ?? []) as Array<{ date: string; started_at: string; sport: string | null; result: unknown }>) {
    console.log(`  ${r.started_at}  sport=${r.sport ?? "—"}  date=${r.date}  result=${JSON.stringify(r.result).slice(0, 100)}`);
  }

  // Distinct league digest_dates that actually got sent (per the sends table)
  type DateRow = { digest_date: string };
  const allLeagueSends = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data } = await db
      .from("sends")
      .select("digest_date")
      .eq("digest_sport", "mlb")
      .is("team_id", null)
      .is("error", null)
      .order("digest_date", { ascending: true })
      .range(from, from + 999);
    const page = (data ?? []) as DateRow[];
    for (const r of page) allLeagueSends.add(r.digest_date);
    if (page.length < 1000) break;
  }
  const leagueDates = [...allLeagueSends].sort();
  console.log(`\nLeague-digest dates with at least one successful send: ${leagueDates.length}`);
  console.log(`  earliest: ${leagueDates[0]}`);
  console.log(`  latest:   ${leagueDates[leagueDates.length - 1]}`);

  // Distinct team digest dates that got sent
  const allTeamSends = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data } = await db
      .from("sends")
      .select("digest_date")
      .eq("digest_sport", "mlb")
      .not("team_id", "is", null)
      .is("error", null)
      .order("digest_date", { ascending: true })
      .range(from, from + 999);
    const page = (data ?? []) as DateRow[];
    for (const r of page) allTeamSends.add(r.digest_date);
    if (page.length < 1000) break;
  }
  const teamDates = [...allTeamSends].sort();
  console.log(`\nTeam-digest dates with at least one successful send: ${teamDates.length}`);
  console.log(`  earliest: ${teamDates[0]}`);
  console.log(`  latest:   ${teamDates[teamDates.length - 1]}`);

  // ── 2. RAW ROW COUNTS IN CACHE TABLES (the numbers I used wrong) ────
  console.log("\n══ daily_digests / team_digests RAW ROW COUNTS ════════");
  const { count: dailyDigestRows } = await db.from("daily_digests").select("date", { count: "exact", head: true });
  console.log(`daily_digests total rows: ${dailyDigestRows}`);
  // Distinct date range in daily_digests
  const { data: ddRange } = await db.from("daily_digests").select("date").order("date", { ascending: true }).limit(1);
  const { data: ddRangeEnd } = await db.from("daily_digests").select("date").order("date", { ascending: false }).limit(1);
  console.log(`  earliest date: ${((ddRange ?? [])[0] as { date: string } | undefined)?.date ?? "—"}`);
  console.log(`  latest   date: ${((ddRangeEnd ?? [])[0] as { date: string } | undefined)?.date ?? "—"}`);

  const { count: teamDigestRows } = await db.from("team_digests").select("date", { count: "exact", head: true });
  console.log(`\nteam_digests total rows: ${teamDigestRows}`);
  const { data: tdRange } = await db.from("team_digests").select("date").order("date", { ascending: true }).limit(1);
  const { data: tdRangeEnd } = await db.from("team_digests").select("date").order("date", { ascending: false }).limit(1);
  console.log(`  earliest date: ${((tdRange ?? [])[0] as { date: string } | undefined)?.date ?? "—"}`);
  console.log(`  latest   date: ${((tdRangeEnd ?? [])[0] as { date: string } | undefined)?.date ?? "—"}`);

  // ── 3. TOTAL SENDS (real number) for complaint-rate denominator ─────
  console.log("\n══ TOTAL SENDS ════════════════════════════════════════");
  const { count: sendsTotal } = await db.from("sends").select("id", { count: "exact", head: true });
  console.log(`sends total rows: ${(sendsTotal ?? 0).toLocaleString()}`);
  const { count: sendsOk } = await db.from("sends").select("id", { count: "exact", head: true }).is("error", null);
  console.log(`sends without error: ${(sendsOk ?? 0).toLocaleString()}`);
  const { count: sendsLeague } = await db.from("sends").select("id", { count: "exact", head: true }).is("team_id", null).is("error", null);
  console.log(`  league only (team_id IS NULL): ${(sendsLeague ?? 0).toLocaleString()}`);
  const { count: sendsTeam } = await db.from("sends").select("id", { count: "exact", head: true }).not("team_id", "is", null).is("error", null);
  console.log(`  team   only (team_id NOT NULL): ${(sendsTeam ?? 0).toLocaleString()}`);

  // ── 4. UNIQUE TEAMS COVERED ────────────────────────────────────────
  console.log("\n══ TEAMS COVERED ══════════════════════════════════════");
  const teamsSeen = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from("team_digests").select("team_slug").range(from, from + 999);
    const page = (data ?? []) as Array<{ team_slug: string }>;
    for (const r of page) teamsSeen.add(r.team_slug);
    if (page.length < 1000) break;
  }
  console.log(`Distinct team_slugs in team_digests: ${teamsSeen.size}`);

  const teamsInSends = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from("sends").select("team_id").not("team_id", "is", null).is("error", null).range(from, from + 999);
    const page = (data ?? []) as Array<{ team_id: string }>;
    for (const r of page) teamsInSends.add(r.team_id);
    if (page.length < 1000) break;
  }
  console.log(`Distinct team_ids in sends with error IS NULL: ${teamsInSends.size}`);

  // ── 5. ACTUAL OPEN RATES (real numbers, not the doc's claims) ───────
  console.log("\n══ ACTUAL OPEN RATES (daily_metrics rows, sorted desc) ");
  const { data: dm } = await db
    .from("daily_metrics")
    .select("date, delivered, opened, team_delivered, team_opened")
    .eq("sport", "mlb")
    .order("date", { ascending: false })
    .limit(10);
  console.log(`date         league(d/o → rate)            team(d/o → rate)`);
  for (const r of (dm ?? []) as Array<{
    date: string; delivered: number | null; opened: number | null;
    team_delivered: number | null; team_opened: number | null;
  }>) {
    const lr = r.delivered && r.delivered > 0 ? `${((r.opened ?? 0) / r.delivered * 100).toFixed(1)}%` : "—";
    const tr = r.team_delivered && r.team_delivered > 0 ? `${((r.team_opened ?? 0) / r.team_delivered * 100).toFixed(1)}%` : "—";
    const lline = `${r.delivered ?? "—"}/${r.opened ?? "—"} → ${lr}`.padEnd(28);
    const tline = `${r.team_delivered ?? "—"}/${r.team_opened ?? "—"} → ${tr}`;
    console.log(`${r.date}   ${lline} ${tline}`);
  }

  // ── 6. SUBSCRIBER FIRST-EVER + GROWTH WINDOW ───────────────────────
  console.log("\n══ SUBSCRIBER HISTORY ═════════════════════════════════");
  type SubBasic = { created_at: string; confirmed_at: string | null; status: string };
  const subs: SubBasic[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from("subscribers").select("created_at, confirmed_at, status").order("created_at", { ascending: true }).range(from, from + 999);
    const page = (data ?? []) as SubBasic[];
    subs.push(...page);
    if (page.length < 1000) break;
  }
  const earliest = subs[0];
  console.log(`earliest subscriber created_at: ${earliest?.created_at}`);
  // First subscriber that was ever active
  const earliestActivated = subs.find((s) => s.confirmed_at !== null);
  console.log(`earliest confirmed_at:          ${earliestActivated?.confirmed_at ?? "—"}`);

  // ── 7. UNSUBSCRIBE REASONS (system-level only — user-level is brand new) ─
  console.log("\n══ UNSUBSCRIBE REASONS (current breakdown) ════════════");
  type UR = { unsubscribe_reason: string | null };
  const { data: urs } = await db.from("subscribers").select("unsubscribe_reason").eq("status", "unsubscribed");
  const counts = new Map<string, number>();
  for (const r of (urs ?? []) as UR[]) {
    const k = r.unsubscribe_reason ?? "(null)";
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  for (const [k, v] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(14)} ${v}`);
  }

  // ── 8. OPEN-TRACKING WINDOW (today minus 2026-05-30) ────────────────
  console.log("\n══ OPEN TRACKING WINDOW ═══════════════════════════════");
  const start = new Date("2026-05-30T00:00:00Z");
  const now = new Date();
  const days = Math.floor((now.getTime() - start.getTime()) / 86_400_000);
  console.log(`OPEN_TRACKING_START_ISO = 2026-05-30; days elapsed: ${days}`);

  // ── 9. TOTAL ad campaigns + paid status ─────────────────────────────
  console.log("\n══ AD CAMPAIGNS ═══════════════════════════════════════");
  const { count: campTotal } = await db.from("ad_campaigns").select("id", { count: "exact", head: true });
  const { count: campPaid }  = await db.from("ad_campaigns").select("id", { count: "exact", head: true }).not("paid_at", "is", null);
  const { count: campApproved } = await db.from("ad_campaigns").select("id", { count: "exact", head: true }).eq("status", "approved");
  console.log(`total ad_campaigns: ${campTotal}`);
  console.log(`  approved:        ${campApproved}`);
  console.log(`  paid (paid_at IS NOT NULL): ${campPaid}`);

  // ── 10. CRON RUNS — actual count, route breakdown ───────────────────
  console.log("\n══ CRON HEALTH (all-time totals by route) ═════════════");
  type CR = { route: string; status: string };
  const cr: CR[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from("cron_runs").select("route, status").range(from, from + 999);
    const page = (data ?? []) as CR[];
    cr.push(...page);
    if (page.length < 1000) break;
  }
  const byRoute = new Map<string, { ok: number; failed: number; other: number }>();
  for (const r of cr) {
    const b = byRoute.get(r.route) ?? { ok: 0, failed: 0, other: 0 };
    if (r.status === "ok") b.ok++;
    else if (r.status === "failed") b.failed++;
    else b.other++;
    byRoute.set(r.route, b);
  }
  for (const [route, b] of [...byRoute.entries()].sort((a, b) => (b[1].ok + b[1].failed + b[1].other) - (a[1].ok + a[1].failed + a[1].other))) {
    console.log(`  ${route.padEnd(20)} ok=${b.ok}  failed=${b.failed}  other=${b.other}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
