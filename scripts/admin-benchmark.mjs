// Steady-state load-time benchmark for every /admin page on production.
//
// Usage:
//   BOXSCORE_ADMIN_COOKIE='<paste boxscore_admin_session value>' \
//     node --env-file=.env.local scripts/admin-benchmark.mjs
//
// What it does:
//   1. Resolves real values for dynamic-route params from prod Supabase
//      (recent gamePk, latest advertiser/campaign/creative ids, yesterday's
//      date in ET, etc.).
//   2. Hits each URL 4 times in series: 1 warm-up (discarded) + 3 timed.
//      Median is reported as the steady-state number.
//   3. Sorts the table slowest-first so the worst offenders surface.
//
// Notes:
//   - Only measures TTLB (total request time) via fetch timings. Does not
//     break that into network/render/DB segments.
//   - Steady-state per Jeff: we ignore cold starts. Each URL gets a warm-up
//     hit first.
//   - 3xx is treated as success (login redirect indicates bad cookie). The
//     script exits 1 if the first warm-up hits 302→/admin/login.

import { createClient } from "@supabase/supabase-js";

const BASE = process.env.BOXSCORE_BASE_URL || "https://boxscore.email";
const COOKIE = process.env.BOXSCORE_ADMIN_COOKIE;
if (!COOKIE) {
  console.error("Set BOXSCORE_ADMIN_COOKIE to the value of the boxscore_admin_session cookie.");
  process.exit(2);
}

const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SECRET_KEY;
if (!SUPA_URL || !SUPA_KEY) {
  console.error("Need SUPABASE_URL + SUPABASE_SECRET_KEY in .env.local.");
  process.exit(2);
}

const sb = createClient(SUPA_URL, SUPA_KEY);

function ymdET(d = new Date()) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  return f.format(d);
}

function yesterdayET() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return ymdET(d);
}

async function resolveDynamicParams() {
  const yest = yesterdayET();

  const [adv, camp, creat, game] = await Promise.all([
    sb.from("ad_advertisers").select("id").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    sb.from("ad_campaigns").select("id").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    sb.from("ad_creatives").select("id").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    sb.from("daily_raw").select("payload->schedule").eq("sport", "mlb").eq("date", yest).maybeSingle(),
  ]);

  let gamePk = null;
  try {
    const sched = game.data && (game.data.schedule || (game.data)["?column?"]);
    const dates = sched?.dates ?? [];
    const games = dates.flatMap((d) => d.games ?? []);
    const finals = games.filter((g) => g.status?.codedGameState === "F");
    gamePk = (finals[0] ?? games[0])?.gamePk ?? null;
  } catch (e) { /* fall through */ }

  return {
    yesterday: yest,
    advertiserId: adv.data?.id ?? null,
    campaignId: camp.data?.id ?? null,
    creativeId: creat.data?.id ?? null,
    gamePk,
  };
}

function buildUrls(p) {
  const u = [
    "/admin",
    "/admin/mlb",
    "/admin/ads",
    "/admin/ads/advertisers",
    "/admin/ads/explore",
    "/admin/clicks",
    "/admin/content/digests",
    "/admin/data-model",
    "/admin/data-model/sportsdataio",
    "/admin/data-model/statsapi",
    "/admin/demographics",
    "/admin/discord",
    "/admin/followers",
    "/admin/games",
    "/admin/historical",
    "/admin/historical/backfill",
    "/admin/historical/feats",
    "/admin/images",
    "/admin/metrics/rss",
    "/admin/metrics/sends",
    "/admin/metrics/sources",
    "/admin/metrics/subscribers",
    "/admin/operations/crons",
    "/admin/operations/deliverability",
    "/admin/operations/email-lookup",
    "/admin/operations/sends",
    "/admin/preview/mlb",
    "/admin/preview/mlb/nym",
    "/admin/preview/canonical",
    `/admin/preview/canonical/${p.yesterday}`,
    `/admin/preview/canonical/${p.yesterday}/diff`,
    `/admin/preview/canonical/${p.yesterday}/sxs`,
    "/admin/share-preview",
    "/admin/sports",
    "/admin/team-email/nym",
    "/admin/twitter",
    `/admin/email/${p.yesterday}`,
  ];
  if (p.advertiserId) u.push(`/admin/ads/advertisers/${p.advertiserId}`);
  if (p.campaignId)   u.push(`/admin/ads/campaigns/${p.campaignId}`);
  if (p.creativeId)   u.push(`/admin/ads/creatives/${p.creativeId}/preview`);
  if (p.gamePk)       u.push(`/admin/historical/${p.gamePk}`);
  return u;
}

async function timeOnce(url) {
  const t0 = performance.now();
  const res = await fetch(BASE + url, {
    redirect: "manual",
    headers: {
      cookie: `boxscore_admin_session=${COOKIE}`,
      "user-agent": "boxscore-admin-benchmark/1.0",
    },
  });
  const ms = performance.now() - t0;
  // Drain body so connection can be reused.
  await res.arrayBuffer();
  return { ms, status: res.status, bytes: Number(res.headers.get("content-length") ?? 0) };
}

function median(xs) {
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function benchmark(url) {
  // Warm-up.
  let warm;
  try {
    warm = await timeOnce(url);
  } catch (e) {
    return { url, status: "ERR", error: String(e), p50: 0 };
  }
  if (warm.status >= 300 && warm.status < 400) {
    return { url, status: `${warm.status} → /admin/login`, p50: warm.ms };
  }
  // 3 timed.
  const samples = [];
  let last = warm;
  for (let i = 0; i < 3; i++) {
    last = await timeOnce(url);
    samples.push(last.ms);
  }
  return { url, status: last.status, bytes: last.bytes, p50: median(samples), samples };
}

async function main() {
  const params = await resolveDynamicParams();
  console.log("Params:", JSON.stringify(params));
  const urls = buildUrls(params);
  console.log(`Benchmarking ${urls.length} URLs against ${BASE} (3 warm samples each)\n`);

  const results = [];
  for (const url of urls) {
    process.stderr.write(`  ${url} ... `);
    const r = await benchmark(url);
    results.push(r);
    process.stderr.write(`${r.status}  ${r.p50.toFixed(0)}ms\n`);
  }

  results.sort((a, b) => (b.p50 ?? 0) - (a.p50 ?? 0));

  console.log("\n=== Results (steady-state, median of 3) ===");
  console.log("median   status              url");
  console.log("------   ------              ---");
  for (const r of results) {
    console.log(
      `${String(Math.round(r.p50)).padStart(5)}ms  ${String(r.status).padEnd(18)}  ${r.url}`,
    );
  }

  const over3s = results.filter((r) => typeof r.p50 === "number" && r.p50 > 3000);
  console.log(`\n${over3s.length}/${results.length} pages over 3000ms.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
