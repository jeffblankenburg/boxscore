// Backfill player_seasons (#64). For every player in the players cache
// hit /api/v1/people/{mlb_id}/stats?stats=yearByYear&group=hitting,pitching
// and upsert one row per (player, season). Two-way players collapse
// onto a single row with both blocks populated.
//
// Resumable: tracks the last processed players.id in backfill_progress
// (job='player-seasons'). Re-running picks up from the cursor.
//
// Usage:
//   set -a && source .env.local && set +a && npx tsx scripts/backfill-player-seasons.ts
//   (optional) --limit=N  process only the next N players
//   (optional) --force    re-fetch even players we've already processed
//
// Rate: ~200ms per player single-threaded × ~26K players ≈ 90 minutes.

import { supabaseAdmin } from "../lib/supabase";
import {
  computeEligibility,
  parseInnings,
} from "../lib/games/statsharks/eligibility";

const REQUEST_DELAY_MS = 200;
const JOB = "player-seasons";
const PROGRESS_SENTINEL_SEASON = 0;

type Args = { limit?: number; force: boolean };
function parseArgs(): Args {
  const args = process.argv.slice(2);
  const limitRaw = args.find((x) => x.startsWith("--limit="))?.split("=")[1];
  return {
    limit: limitRaw ? Number(limitRaw) : undefined,
    force: args.includes("--force"),
  };
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

// Subset of the MLB stats payload we care about.
type StatBlock = {
  // Batting + pitching share many key names. Caller decides which
  // subset to read based on the group.displayName.
  plateAppearances?:    number;
  atBats?:              number;
  hits?:                number;
  homeRuns?:            number;
  rbi?:                 number;
  runs?:                number;
  stolenBases?:         number;
  baseOnBalls?:         number;
  doubles?:             number;
  triples?:             number;
  avg?:                 string;
  obp?:                 string;
  slg?:                 string;
  ops?:                 string;
  inningsPitched?:      string;
  strikeOuts?:          number;
  wins?:                number;
  saves?:               number;
  era?:                 string;
  whip?:                string;
};
type Split = {
  season?: string;
  team?:   { abbreviation?: string };
  league?: { id?: number };
  stat?:   StatBlock;
};
type StatsResponse = {
  stats?: Array<{
    group?:  { displayName?: string };
    splits?: Split[];
  }>;
};

type PlayerRow = {
  id:               number;
  mlb_id:           number;
  primary_position: string | null;
};

async function fetchYearByYear(mlbId: number): Promise<StatsResponse | null> {
  const url = `https://statsapi.mlb.com/api/v1/people/${mlbId}/stats?stats=yearByYear&group=hitting,pitching&sportId=1`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) return null;
  return (await res.json()) as StatsResponse;
}

// Parse a "1.234" / ".234" / null avg-style string. Returns a number or
// null. Stripping leading "." matches MLB's display format ("avg":".321").
function parseAvg(s: string | undefined): number | null {
  if (!s) return null;
  if (s === ".---" || s === "-.--" || s === "*.***" ) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function parseRate(s: string | undefined): number | null {
  return parseAvg(s);
}

type RowToUpsert = {
  player_id:         number;
  season:            number;
  primary_position:  string | null;
  team_abbr:         string | null;
  games_played:      number | null;
  pa:                number | null;
  ab:                number | null;
  h:                 number | null;
  hr:                number | null;
  rbi:               number | null;
  r:                 number | null;
  sb:                number | null;
  bb_bat:            number | null;
  doubles:           number | null;
  triples:           number | null;
  avg:               number | null;
  obp:               number | null;
  slg:               number | null;
  ops:               number | null;
  ip:                number | null;
  k:                 number | null;
  w:                 number | null;
  sv:                number | null;
  era:               number | null;
  whip:              number | null;
  hr_allowed:        number | null;
  bb_pitch:          number | null;
  batter_eligible:   boolean;
  pitcher_eligible:  boolean;
};

function buildSeasonRows(player: PlayerRow, payload: StatsResponse): RowToUpsert[] {
  // Merge hitting + pitching splits keyed by season — two-way players
  // get both blocks on the same row.
  const bySeason = new Map<number, RowToUpsert>();
  for (const grp of payload.stats ?? []) {
    const displayName = grp.group?.displayName;
    if (displayName !== "hitting" && displayName !== "pitching") continue;
    for (const sp of grp.splits ?? []) {
      // Skip minor-league splits (sportId filter in the URL should
      // already exclude these, but a few historical splits sneak
      // through with league.id outside MLB's 103/104).
      if (sp.league?.id !== 103 && sp.league?.id !== 104) continue;
      const seasonNum = Number(sp.season);
      if (!Number.isInteger(seasonNum)) continue;
      const st = sp.stat ?? {};
      const existing = bySeason.get(seasonNum);
      const base: RowToUpsert = existing ?? {
        player_id:        player.id,
        season:           seasonNum,
        primary_position: player.primary_position,
        team_abbr:        sp.team?.abbreviation ?? null,
        games_played:     null,
        pa: null, ab: null, h: null, hr: null, rbi: null, r: null, sb: null,
        bb_bat: null, doubles: null, triples: null,
        avg: null, obp: null, slg: null, ops: null,
        ip: null, k: null, w: null, sv: null,
        era: null, whip: null, hr_allowed: null, bb_pitch: null,
        batter_eligible: false, pitcher_eligible: false,
      };
      if (displayName === "hitting") {
        base.pa      = st.plateAppearances ?? null;
        base.ab      = st.atBats           ?? null;
        base.h       = st.hits             ?? null;
        base.hr      = st.homeRuns         ?? null;
        base.rbi     = st.rbi              ?? null;
        base.r       = st.runs             ?? null;
        base.sb      = st.stolenBases      ?? null;
        base.bb_bat  = st.baseOnBalls      ?? null;
        base.doubles = st.doubles          ?? null;
        base.triples = st.triples          ?? null;
        base.avg     = parseAvg(st.avg);
        base.obp     = parseAvg(st.obp);
        base.slg     = parseAvg(st.slg);
        base.ops     = parseAvg(st.ops);
      } else {
        base.ip         = parseInnings(st.inningsPitched);
        base.k          = st.strikeOuts   ?? null;
        base.w          = st.wins         ?? null;
        base.sv         = st.saves        ?? null;
        base.era        = parseRate(st.era);
        base.whip       = parseRate(st.whip);
        base.hr_allowed = st.homeRuns     ?? null;
        base.bb_pitch   = st.baseOnBalls  ?? null;
      }
      bySeason.set(seasonNum, base);
    }
  }
  // Compute eligibility once per row using the player's primary
  // position from the players cache (which has been backfilled from
  // MLB's people endpoint).
  for (const row of bySeason.values()) {
    const elig = computeEligibility({
      primary_position: row.primary_position,
      mlb_id:           player.mlb_id,
      pa:               row.pa,
      ip:               row.ip,
    });
    row.batter_eligible  = elig.batter_eligible;
    row.pitcher_eligible = elig.pitcher_eligible;
  }
  return Array.from(bySeason.values()).sort((a, b) => a.season - b.season);
}

async function getCursor(): Promise<number> {
  const { data } = await supabaseAdmin()
    .from("backfill_progress")
    .select("games_seen")
    .eq("job", JOB)
    .eq("season", PROGRESS_SENTINEL_SEASON)
    .maybeSingle<{ games_seen: number }>();
  return data?.games_seen ?? 0;
}

async function saveCursor(maxPlayerId: number, totalRows: number) {
  await supabaseAdmin().from("backfill_progress").upsert({
    job: JOB,
    season: PROGRESS_SENTINEL_SEASON,
    last_date_done: null,
    games_seen: maxPlayerId,
    games_ingested: totalRows,
    failed_game_pks: [],
    finished_at: new Date().toISOString(),
  }, { onConflict: "job,season" });
}

async function main() {
  const args = parseArgs();
  const db = supabaseAdmin();
  const PAGE = 200;
  let cursor = args.force ? 0 : await getCursor();
  let processed = 0;
  let upserted  = 0;
  let totalRows = 0;
  const startedAt = Date.now();

  console.log(`Starting from players.id > ${cursor}`);

  for (;;) {
    const { data: players, error } = await db
      .from("players")
      .select("id, mlb_id, primary_position")
      .gt("id", cursor)
      .order("id", { ascending: true })
      .limit(PAGE);
    if (error) throw new Error(`page players: ${error.message}`);
    if (!players || players.length === 0) break;

    for (const p of players as PlayerRow[]) {
      if (args.limit && processed >= args.limit) break;
      try {
        const payload = await fetchYearByYear(p.mlb_id);
        if (payload) {
          const rows = buildSeasonRows(p, payload);
          if (rows.length > 0) {
            const { error: upErr } = await db
              .from("player_seasons")
              .upsert(rows, { onConflict: "player_id,season" });
            if (upErr) {
              console.error(`  player ${p.mlb_id} upsert failed: ${upErr.message}`);
            } else {
              upserted++;
              totalRows += rows.length;
            }
          }
        }
      } catch (e) {
        console.error(`  player ${p.mlb_id} threw: ${(e as Error).message}`);
      }
      processed++;
      cursor = p.id;
      await sleep(REQUEST_DELAY_MS);
    }

    await saveCursor(cursor, totalRows);
    const elapsedMin = (Date.now() - startedAt) / 60000;
    const rate = processed / Math.max(0.0001, elapsedMin);
    console.log(`  processed=${processed.toLocaleString()} upserted=${upserted.toLocaleString()} rows=${totalRows.toLocaleString()} cursor=${cursor}  ~${rate.toFixed(0)} players/min`);

    if (args.limit && processed >= args.limit) break;
    if (players.length < PAGE) break;
  }

  console.log(`\nDone. processed=${processed.toLocaleString()} upserted=${upserted.toLocaleString()} rows=${totalRows.toLocaleString()}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
