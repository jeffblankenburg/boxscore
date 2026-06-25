// Outcome side of the fantasy system. Pulls yesterday's snapshotted
// projections from daily_fantasy_projections, finds each player's actual
// game line in daily_raw.payload.games[gamePk].boxscore, computes the
// actual fantasy score with the same constants the projector uses, and
// upserts to daily_fantasy_results.
//
// Mirrors /api/cron/predictions-comparator in shape — runs the morning
// after games finalize, idempotent, reads the cached daily_raw rather
// than re-hitting statsapi.

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { yesterdayInET, isValidIsoDate } from "@/lib/dates";
import {
  scoreHittingLine,
  scorePitchingLine,
  ipStringToDecimal,
} from "@/lib/sports/mlb/fantasy";

export const runtime = "nodejs";
export const maxDuration = 120;

function isAuthorized(req: Request): boolean {
  if (process.env.NODE_ENV === "development") return true;
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

// ─── Raw payload subset ─────────────────────────────────────────────────

type RawScheduleGame = {
  gamePk?: number;
  status?: { abstractGameState?: string; detailedState?: string };
  teams?: {
    away?: { team?: { id?: number } };
    home?: { team?: { id?: number } };
  };
};
type RawSchedule = { dates?: Array<{ games?: RawScheduleGame[] }> };

type RawPlayerStats = {
  batting?: Partial<{
    hits: number; doubles: number; triples: number; homeRuns: number;
    runs: number; rbi: number; baseOnBalls: number; stolenBases: number;
    atBats: number; plateAppearances: number;
  }>;
  pitching?: Partial<{
    inningsPitched: string;
    strikeOuts: number;
    earnedRuns: number;
    hits: number;
    runs: number;
    baseOnBalls: number;
    homeRuns: number;
  }>;
};
type RawBoxPlayer = {
  person?: { id?: number };
  stats?: RawPlayerStats;
};
type RawBoxGame = {
  boxscore?: {
    teams?: {
      away?: { team?: { id?: number }; players?: Record<string, RawBoxPlayer> };
      home?: { team?: { id?: number }; players?: Record<string, RawBoxPlayer> };
    };
  };
};

type RawPayload = {
  schedule?: RawSchedule;
  games?: Record<string, RawBoxGame>;
};

// ─── Helpers ─────────────────────────────────────────────────────────────

// Find every player's actual line for the day. Returns a Map keyed by
// mlb_id holding { gamePk, status, stats } so each projection row can
// look up its actual in O(1) without scanning boxscores again.
function buildPlayerLineIndex(payload: RawPayload): Map<number, {
  gamePk: number;
  status: string;
  stats: RawPlayerStats;
}> {
  const out = new Map<number, { gamePk: number; status: string; stats: RawPlayerStats }>();
  const games = payload.games ?? {};
  const scheduleGames = (payload.schedule?.dates ?? []).flatMap((d) => d.games ?? []);
  // Build (gamePk → detailedState) map once so we don't walk the
  // schedule for every player.
  const statusByGame = new Map<number, string>();
  for (const g of scheduleGames) {
    if (typeof g.gamePk !== "number") continue;
    const s = g.status?.detailedState ?? g.status?.abstractGameState ?? "unknown";
    statusByGame.set(g.gamePk, s);
  }
  for (const [pkStr, game] of Object.entries(games)) {
    const gamePk = Number(pkStr);
    if (!Number.isFinite(gamePk)) continue;
    const status = statusByGame.get(gamePk) ?? "unknown";
    for (const side of ["away", "home"] as const) {
      const players = game.boxscore?.teams?.[side]?.players ?? {};
      for (const p of Object.values(players)) {
        const pid = p?.person?.id;
        if (typeof pid !== "number") continue;
        // First occurrence wins — a player can't appear in two games on
        // the same day (doubleheader teams have separate gamePks but a
        // player only plays one of them; we'd take whichever lists him).
        if (!out.has(pid)) {
          out.set(pid, { gamePk, status, stats: p.stats ?? {} });
        }
      }
    }
  }
  return out;
}

function statsBlob(
  category: string,
  stats: RawPlayerStats,
): Record<string, number | null> {
  if (category === "SP") {
    const pi = stats.pitching ?? {};
    return {
      inningsPitched: ipStringToDecimal(pi.inningsPitched),
      strikeOuts:     pi.strikeOuts  ?? 0,
      earnedRuns:     pi.earnedRuns  ?? 0,
      hits:           pi.hits        ?? 0,
      runs:           pi.runs        ?? 0,
      baseOnBalls:    pi.baseOnBalls ?? 0,
      homeRuns:       pi.homeRuns    ?? 0,
    };
  }
  const b = stats.batting ?? {};
  return {
    plateAppearances: b.plateAppearances ?? 0,
    atBats:           b.atBats           ?? 0,
    hits:             b.hits             ?? 0,
    doubles:          b.doubles          ?? 0,
    triples:          b.triples          ?? 0,
    homeRuns:         b.homeRuns         ?? 0,
    runs:             b.runs             ?? 0,
    rbi:              b.rbi              ?? 0,
    baseOnBalls:      b.baseOnBalls      ?? 0,
    stolenBases:      b.stolenBases      ?? 0,
  };
}

function actualScore(category: string, stats: RawPlayerStats): number {
  if (category === "SP") {
    const pi = stats.pitching ?? {};
    if (!pi.inningsPitched) return 0;
    return scorePitchingLine({
      inningsPitched: pi.inningsPitched,
      strikeOuts:     pi.strikeOuts ?? 0,
      earnedRuns:     pi.earnedRuns ?? 0,
    });
  }
  const b = stats.batting ?? {};
  // "Played" check below decides whether to write actual_score = null.
  return scoreHittingLine({
    hits:        b.hits        ?? 0,
    doubles:     b.doubles     ?? 0,
    triples:     b.triples     ?? 0,
    homeRuns:    b.homeRuns    ?? 0,
    runs:        b.runs        ?? 0,
    rbi:         b.rbi         ?? 0,
    baseOnBalls: b.baseOnBalls ?? 0,
    stolenBases: b.stolenBases ?? 0,
  });
}

// A player counts as "played" if their stat block has any non-zero
// counter for their category. A bench player who never appeared in
// the box still gets a players[] entry with all zeros — we want to
// distinguish those from goose-egg appearances.
function playedInBox(category: string, stats: RawPlayerStats): boolean {
  if (category === "SP") {
    const pi = stats.pitching ?? {};
    return Boolean(pi.inningsPitched && ipStringToDecimal(pi.inningsPitched) > 0);
  }
  const b = stats.batting ?? {};
  return (b.plateAppearances ?? 0) > 0 || (b.atBats ?? 0) > 0;
}

// ─── Handler ─────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const sport = url.searchParams.get("sport") ?? "mlb";
  const date = url.searchParams.get("date") ?? yesterdayInET();
  if (sport !== "mlb") {
    return NextResponse.json({ error: `no comparator for sport=${sport}` }, { status: 501 });
  }
  if (!isValidIsoDate(date)) {
    return NextResponse.json({ error: "invalid date" }, { status: 400 });
  }

  const sb = supabaseAdmin();

  // 1. Snapshotted projections for the target date.
  type ProjRow = {
    sport: string; date: string; player_id: number; model_version: string;
    full_name: string; team_abbr: string; opp_abbr: string;
    is_home: boolean; category: string; proj_score: number;
    batting_order: number | null; lineup_status: string;
  };
  const { data: projectionsRaw } = await sb
    .from("daily_fantasy_projections")
    .select(
      "sport, date, player_id, model_version, full_name, team_abbr, opp_abbr, " +
      "is_home, category, proj_score, batting_order, lineup_status",
    )
    .eq("sport", sport)
    .eq("date", date);
  const projections = ((projectionsRaw ?? []) as unknown) as ProjRow[];
  if (projections.length === 0) {
    return NextResponse.json({ ok: true, date, scored: 0, note: "no projections for date" });
  }

  // 2. Raw payload for the date — has schedule + per-game boxscores.
  const { data: rawRows } = await sb
    .from("daily_raw")
    .select("payload")
    .eq("sport", sport)
    .eq("date", date)
    .limit(1);
  const payload = ((rawRows?.[0]?.payload as RawPayload | undefined) ?? {}) as RawPayload;

  const lineIndex = buildPlayerLineIndex(payload);

  // 3. Score each projection.
  const rows = projections.map((p) => {
    const line = lineIndex.get(p.player_id);
    const category = p.category;
    const projScore = Number(p.proj_score);
    if (!line) {
      // Player's team didn't play (or boxscore missing) — write a
      // not-played row so the surface can show "no game" rather
      // than silently dropping the projection.
      return {
        ...p,
        game_pk: null,
        game_status: null,
        played: false,
        actual_score: null,
        actual_stats: {},
        delta: null,
      };
    }
    const played = playedInBox(category, line.stats);
    const actual = played ? Number(actualScore(category, line.stats).toFixed(2)) : null;
    return {
      ...p,
      game_pk:      line.gamePk,
      game_status:  line.status,
      played,
      actual_score: actual,
      actual_stats: statsBlob(category, line.stats),
      delta:        actual !== null ? Number((actual - projScore).toFixed(2)) : null,
    };
  });

  const { error } = await sb
    .from("daily_fantasy_results")
    .upsert(rows, { onConflict: "sport,date,player_id,model_version" });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const played = rows.filter((r) => r.played);
  const totalProj = played.reduce((s, r) => s + Number(r.proj_score), 0);
  const totalActual = played.reduce((s, r) => s + (r.actual_score ?? 0), 0);
  return NextResponse.json({
    ok: true,
    date,
    scored: rows.length,
    played: played.length,
    avg_proj:   played.length > 0 ? Number((totalProj   / played.length).toFixed(2)) : null,
    avg_actual: played.length > 0 ? Number((totalActual / played.length).toFixed(2)) : null,
  });
}
