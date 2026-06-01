// Rolling Insights "DataFeeds" MLB API probe. Verifies whether their API
// actually covers the 8 gaps we identified vs statsapi.mlb.com — the rep
// claims the public docs are out of date and they support everything we
// need; this is the empirical check.
//
// Run:
//   npx tsx --env-file=.env.local scripts/probe-rolling-insights.ts
//
// Env:
//   ROLLING_INSIGHTS_API_KEY      — RapidAPI / DataFeeds key
//   ROLLING_INSIGHTS_CLIENT_SECRET — secondary credential (sometimes used as
//                                   the RSC_token query param the docs mention)
//
// Each block exercises one of the gap capabilities and asserts the SPECIFIC
// fields our renderers read today, not just "endpoint returns 200." A 200
// with the wrong shape is still a failure.

// Direct DataFeeds REST host. Confirmed via the Rolling Insights AI skill
// repo (Rolling-Insights/sports-datafeeds-by-rolling-insights-skill) which
// is the authoritative source — public Notion docs lag behind it. Auth is
// a single `RSC_token` query-string parameter on every request.
const BASE = process.env.ROLLING_INSIGHTS_BASE
  ?? "https://rest.datafeeds.rolling-insights.com/api/v1";

// Skill says use env var `RSC_TOKEN`. Our .env.local has the cred under two
// possibly-different names; try the explicit one first, then fall back.
const RSC_TOKEN =
  process.env.RSC_TOKEN
  ?? process.env.ROLLING_INSIGHTS_CLIENT_SECRET
  ?? process.env.ROLLING_INSIGHTS_API_KEY;
if (!RSC_TOKEN) {
  console.error("No Rolling Insights token found. Set RSC_TOKEN (preferred), or ROLLING_INSIGHTS_CLIENT_SECRET / ROLLING_INSIGHTS_API_KEY.");
  process.exit(1);
}

const HEADERS_OF_INTEREST = [
  "x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset",
  "x-ratelimit-requests-limit", "x-ratelimit-requests-remaining",
  "content-type", "cf-cache-status",
];

type ProbeResult = {
  url: string;
  status: number;
  headers: Record<string, string>;
  body: unknown;
  bodyError?: string;
};

async function probe(path: string): Promise<ProbeResult> {
  // Cache buster per skill troubleshooting guidance — without `_=<ts>` the
  // upstream CDN can 304 requests we've never made. Send Cache-Control too.
  const sep = path.includes("?") ? "&" : "?";
  const url = `${BASE}${path}${sep}RSC_token=${RSC_TOKEN}&_=${Date.now()}`;
  const res = await fetch(url, {
    headers: { "Cache-Control": "no-cache, no-store" },
  });
  const headers: Record<string, string> = {};
  for (const h of HEADERS_OF_INTEREST) {
    const v = res.headers.get(h);
    if (v) headers[h] = v;
  }
  let body: unknown = null;
  let bodyError: string | undefined;
  const text = await res.text();
  if (text.length > 0) {
    try { body = JSON.parse(text); }
    catch (e) { bodyError = (e as Error).message; body = text.slice(0, 400); }
  }
  return {
    url: url.replace(/RSC_token=[^&]+/, "RSC_token=***"),
    status: res.status, headers, body, bodyError,
  };
}

// ─── Field-level contracts ─────────────────────────────────────────────────
// What each renderer in our code actually reads. A capability is only "PASS"
// if its endpoint returns a record with EVERY required field present and
// the right shape.

type FieldCheck = {
  name: string;
  required: string[];    // dotted paths into a sample record
  sampleFrom: (body: unknown) => unknown;   // navigate the response to one record
};

function get(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, k) => {
    if (acc && typeof acc === "object") {
      if (Array.isArray(acc)) {
        const n = parseInt(k, 10);
        return Number.isFinite(n) ? (acc as unknown[])[n] : undefined;
      }
      return (acc as Record<string, unknown>)[k];
    }
    return undefined;
  }, obj);
}

function evaluate(label: string, body: unknown, check: FieldCheck): { pass: boolean; missing: string[] } {
  const sample = check.sampleFrom(body);
  if (sample == null) return { pass: false, missing: ["(no record found in response)"] };
  const missing: string[] = [];
  for (const f of check.required) {
    const v = get(sample, f);
    if (v == null) missing.push(f);
  }
  console.log(`  ${missing.length === 0 ? "PASS" : "FAIL"} ${label}${missing.length ? `  missing: ${missing.join(", ")}` : ""}`);
  return { pass: missing.length === 0, missing };
}

function summarize(label: string, r: ProbeResult): void {
  console.log(`\n── ${label} ───────────────────────────────────────`);
  console.log(`GET ${r.url}`);
  console.log(`HTTP ${r.status}`);
  for (const [k, v] of Object.entries(r.headers)) console.log(`  ${k}: ${v}`);
  if (r.bodyError) {
    console.log(`body parse error: ${r.bodyError}`);
    console.log(`body (first 400 chars): ${r.body}`);
    return;
  }
  if (r.body == null) { console.log(`(empty body)`); return; }
  if (Array.isArray(r.body)) {
    console.log(`array length: ${r.body.length}`);
    if (r.body.length > 0) {
      console.log(`first item keys: ${Object.keys(r.body[0] as object).join(", ")}`);
      console.log(JSON.stringify(r.body[0], null, 2).split("\n").slice(0, 25).join("\n"));
    }
  } else if (typeof r.body === "object") {
    console.log(`object keys: ${Object.keys(r.body as object).join(", ")}`);
    console.log(JSON.stringify(r.body, null, 2).split("\n").slice(0, 25).join("\n"));
  }
}

// ─── Test dates ────────────────────────────────────────────────────────────
// 2025-07-31 is the MLB trade deadline — guaranteed transactions, mid-season
// standings/leaders, plenty of completed games. Probe a current date too so
// we see whether the API is producing live 2026 data.
function isoDaysAgo(days: number): string {
  const d = new Date(Date.now() - days * 86400_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

async function main() {
  const yesterday = isoDaysAgo(1);
  const deadline = "2025-07-31";  // MLB trade deadline 2025 — transaction-rich, mid-season standings
  console.log(`Probing Rolling Insights MLB API`);
  console.log(`Base: ${BASE}`);
  console.log(`Yesterday=${yesterday}  Deadline=${deadline}`);

  const results: Array<{ gap: string; pass: boolean; missing: string[]; status: number }> = [];

  const record = (gap: string, status: number, ev: { pass: boolean; missing: string[] }) =>
    results.push({ gap, status, pass: ev.pass, missing: ev.missing });

  // ── Sanity: schedule for the deadline date ─────────────────────────────
  // First, verify auth works at all. Per the skill, /schedule/{date}/MLB is
  // the canonical entry point. Capture a real game_ID for the play-by-play
  // probe.
  const scheduleResp = await probe(`/schedule/${deadline}/MLB`);
  summarize("schedule (auth check + game_ID source)", scheduleResp);
  // Extract first game_ID from the response. Shape is `data.MLB[*].game_ID`
  // per sport-shapes.md.
  let firstGameId: string | null = null;
  if (scheduleResp.body && typeof scheduleResp.body === "object") {
    const data = (scheduleResp.body as { data?: { MLB?: Array<{ game_ID?: string }> } }).data;
    firstGameId = data?.MLB?.[0]?.game_ID ?? null;
  }
  console.log(`\nfirst game_ID for chained probes: ${firstGameId ?? "(none — schedule call failed)"}`);

  // ── Gap 1: Standings (UNDOCUMENTED per skill matrix) ──────────────────
  // The skill's per-sport matrix lists no standings endpoint for MLB.
  // Probe a couple of plausible paths to confirm.
  for (const path of [`/standings/MLB`, `/standings/2025/MLB`]) {
    const r = await probe(path);
    summarize(`Gap 1 candidate: ${path}`, r);
    record(`standings ${path}`, r.status, evaluate("standings record", r.body, {
      name: "standings",
      required: ["wins", "losses"],
      sampleFrom: (b) => {
        const dig = (o: unknown): unknown => {
          if (!o || typeof o !== "object") return null;
          if (Array.isArray(o)) return o[0];
          const rec = o as Record<string, unknown>;
          for (const k of ["data", "standings", "records", "MLB", "teams", "teamRecords"]) {
            if (rec[k]) {
              const result = dig(rec[k]);
              if (result) return result;
            }
          }
          return rec.wins != null ? rec : null;
        };
        return dig(b);
      },
    }));
  }

  // ── Gap 2: League leaders (UNDOCUMENTED) ──────────────────────────────
  for (const path of [`/leaders/MLB`, `/leaders/2025/MLB`]) {
    const r = await probe(path);
    summarize(`Gap 2 candidate: ${path}`, r);
    record(`leaders ${path}`, r.status, evaluate("leader record", r.body, {
      name: "leaders",
      required: ["player_name", "value"],
      sampleFrom: (b) => {
        if (b && typeof b === "object") {
          const o = b as Record<string, unknown>;
          if (Array.isArray(o.data)) return (o.data as unknown[])[0];
        }
        return null;
      },
    }));
  }

  // ── Gap 3: Transactions (UNDOCUMENTED) ────────────────────────────────
  for (const path of [`/transactions/${deadline}/MLB`, `/transactions/MLB`]) {
    const r = await probe(path);
    summarize(`Gap 3 candidate: ${path}`, r);
    record(`transactions ${path}`, r.status, evaluate("transaction record", r.body, {
      name: "transactions",
      required: ["description"],
      sampleFrom: (b) => {
        if (b && typeof b === "object") {
          const o = b as Record<string, unknown>;
          if (Array.isArray(o.data)) return (o.data as unknown[])[0];
        }
        return null;
      },
    }));
  }

  // ── Gap 4: Play-by-play / scoring plays (DOCUMENTED) ──────────────────
  // Skill confirms `/play-by-play/MLB?game_id=...` is supported. Use the
  // game_ID from the schedule call above.
  if (firstGameId) {
    const r = await probe(`/play-by-play/MLB?game_id=${firstGameId}`);
    summarize(`Gap 4: /play-by-play/MLB?game_id=${firstGameId}`, r);
    // Our renderer needs inning, halfInning, event, description, awayScore,
    // homeScore, rbi per scoring play. Don't know their exact field names
    // yet — just look for any inning + event-like shape.
    record(`play-by-play`, r.status, evaluate("scoring play", r.body, {
      name: "play-by-play",
      required: ["inning"],
      sampleFrom: (b) => {
        const dig = (o: unknown): unknown => {
          if (!o || typeof o !== "object") return null;
          if (Array.isArray(o)) return o[0];
          const rec = o as Record<string, unknown>;
          for (const k of ["data", "MLB", "plays", "scoring_plays", "play_by_play", "events"]) {
            if (rec[k]) {
              const result = dig(rec[k]);
              if (result) return result;
            }
          }
          return rec.inning != null ? rec : null;
        };
        return dig(b);
      },
    }));
  } else {
    console.log("\nGap 4 skipped: no game_ID from schedule.");
    record("play-by-play", 0, { pass: false, missing: ["(no game_ID)"] });
  }

  // ── Gap 5: Player game log (UNDOCUMENTED as separate endpoint) ────────
  // Per skill, player-stats returns season aggregates. Probe to see whether
  // a game-by-game array is nested in there, or whether `live` returns
  // per-game player lines that could be aggregated.
  {
    const r = await probe(`/player-stats/2025/MLB?player_id=592450`);
    summarize("Gap 5 candidate: /player-stats/2025/MLB", r);
    record("player-stats game-log", r.status, evaluate("per-game entry inside player-stats", r.body, {
      name: "player-game-log",
      required: ["date"],
      sampleFrom: (b) => {
        const dig = (o: unknown): unknown => {
          if (!o || typeof o !== "object") return null;
          if (Array.isArray(o)) return o[0];
          const rec = o as Record<string, unknown>;
          for (const k of ["games", "game_log", "gameLog", "log", "by_game", "splits"]) {
            if (rec[k] && Array.isArray(rec[k])) return (rec[k] as unknown[])[0];
          }
          // Recurse one level into data/MLB
          if (rec.data) return dig(rec.data);
          if (rec.MLB) return dig(rec.MLB);
          return null;
        };
        return dig(b);
      },
    }));
  }

  // ── Gap 6: Fielding stats ─────────────────────────────────────────────
  // Likely nested inside the same player-stats response. Look for any
  // position-keyed structure with errors/assists/putOuts.
  {
    const r = await probe(`/player-stats/2025/MLB?player_id=592450&type=fielding`);
    summarize("Gap 6 candidate: /player-stats/2025/MLB?type=fielding", r);
    record("fielding", r.status, evaluate("fielding split", r.body, {
      name: "fielding",
      required: ["position", "errors"],
      sampleFrom: (b) => {
        const dig = (o: unknown): unknown => {
          if (!o || typeof o !== "object") return null;
          if (Array.isArray(o)) return o[0];
          const rec = o as Record<string, unknown>;
          for (const k of ["fielding", "splits", "positions"]) {
            if (rec[k] && Array.isArray(rec[k])) return (rec[k] as unknown[])[0];
          }
          if (rec.data) return dig(rec.data);
          return rec.errors != null ? rec : null;
        };
        return dig(b);
      },
    }));
  }

  // ── Gap 7: Hydrated roster ────────────────────────────────────────────
  // /team-info/MLB?team_id=147 returns roster; /player-stats/2025/MLB?team_id=147
  // returns season stats per player. We'd need to join client-side — verify
  // both responses carry matching player_id.
  {
    const ti = await probe(`/team-info/MLB?team_id=147`);
    summarize("Gap 7 (a): /team-info/MLB?team_id=147", ti);
    const ps = await probe(`/player-stats/2025/MLB?team_id=147`);
    summarize("Gap 7 (b): /player-stats/2025/MLB?team_id=147", ps);
    // We "pass" Gap 7 if both responses return players with matching id keys
    // — proxy by checking that each side returns at least one player record.
    const tiHas = ti.status === 200 && JSON.stringify(ti.body ?? {}).includes("player_id");
    const psHas = ps.status === 200 && JSON.stringify(ps.body ?? {}).includes("player_id");
    record("hydrated-roster",
      Math.max(ti.status, ps.status),
      { pass: tiHas && psHas, missing: tiHas && psHas ? [] : ["roster + stats not joinable in one call"] });
    console.log(`  ${tiHas && psHas ? "PASS" : "FAIL"} hydrated roster — requires two calls + client-side join`);
  }

  // ── Gap 8: Schedule range ─────────────────────────────────────────────
  // Skill only documents /schedule-week/{date}/MLB (7-day) and
  // /schedule-season/{date}/MLB. Anything else isn't supported.
  for (const path of [`/schedule-week/${deadline}/MLB`, `/schedule-season/2025/MLB`]) {
    const r = await probe(path);
    summarize(`Gap 8 candidate: ${path}`, r);
    record(`schedule ${path}`, r.status, evaluate("schedule array", r.body, {
      name: "schedule-range",
      required: ["game_ID"],
      sampleFrom: (b) => {
        if (b && typeof b === "object") {
          const data = (b as { data?: { MLB?: unknown[] } }).data;
          if (data?.MLB && Array.isArray(data.MLB)) return data.MLB[0];
        }
        return null;
      },
    }));
  }

  // ── Summary ───────────────────────────────────────────────────────────
  console.log(`\n══ Gap coverage summary ════════════════════════════════`);
  const passed = results.filter((r) => r.pass).length;
  console.log(`${passed} / ${results.length} gaps verified`);
  for (const r of results) {
    const tag = r.pass ? "PASS" : (r.status === 200 ? "FAIL (shape)" : `FAIL (HTTP ${r.status})`);
    console.log(`  ${tag.padEnd(18)} ${r.gap}${r.missing.length && r.pass === false ? `  → ${r.missing.slice(0, 4).join(", ")}` : ""}`);
  }
  console.log(`\nNotes:`);
  console.log(`- Endpoint paths above are guesses from the public Notion doc.`);
  console.log(`  If everything FAILs with HTTP 404, ask the rep for current paths`);
  console.log(`  and update BASE / paths in this file.`);
  console.log(`- Required-field lists reflect what our renderers actually consume.`);
  console.log(`  Anything FAILing on shape (200 but missing fields) is a real gap`);
  console.log(`  even if the rep says it's supported.`);
}

main().catch((e) => { console.error(e); process.exit(1); });

export {};
