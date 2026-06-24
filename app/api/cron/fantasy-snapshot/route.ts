import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { todayInET, isValidIsoDate } from "@/lib/dates";
import {
  loadFantasyForDate,
  FANTASY_MODEL_VERSION,
} from "@/lib/sports/mlb/fantasy-data";
import {
  HITTER_CATEGORIES,
  type FantasyHitterRow,
  type FantasySpRow,
} from "@/lib/sports/mlb/fantasy";

export const runtime = "nodejs";
export const maxDuration = 120;

function isAuthorized(req: Request): boolean {
  if (process.env.NODE_ENV === "development") return true;
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

type SnapshotRow = {
  sport: string;
  date: string;
  player_id: number;
  model_version: string;
  full_name: string;
  team_abbr: string;
  opp_abbr: string;
  is_home: boolean;
  category: string;
  proj_score: number;
  proj_inputs: Record<string, unknown>;
  batting_order: number | null;
  lineup_status: string;
};

function hitterRowToSnapshot(
  sport: string,
  date: string,
  r: FantasyHitterRow,
): SnapshotRow {
  return {
    sport, date,
    player_id: r.playerId,
    model_version: FANTASY_MODEL_VERSION,
    full_name: r.name,
    team_abbr: r.teamAbbr,
    opp_abbr: r.oppAbbr,
    is_home: r.isHome,
    category: r.category,
    proj_score: Number(r.projection.score.toFixed(2)),
    batting_order: r.battingOrder,
    lineup_status: r.lineupStatus,
    proj_inputs: {
      bats: r.bats,
      season: r.season,
      oppSp: r.oppSp,
      projection: r.projection,
    },
  };
}

function spRowToSnapshot(
  sport: string,
  date: string,
  r: FantasySpRow,
): SnapshotRow {
  return {
    sport, date,
    player_id: r.playerId,
    model_version: FANTASY_MODEL_VERSION,
    full_name: r.name,
    team_abbr: r.teamAbbr,
    opp_abbr: r.oppAbbr,
    is_home: r.isHome,
    category: "SP",
    proj_score: Number(r.projection.score.toFixed(2)),
    batting_order: null,
    lineup_status: "projected",
    proj_inputs: {
      throws: r.throws,
      season: r.season,
      oppOffense: r.oppOffense,
      projection: r.projection,
    },
  };
}

// Snapshot the day's fantasy projections to daily_fantasy_projections.
// Idempotent — onConflict updates the row so re-running overwrites.
export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const sport = url.searchParams.get("sport") ?? "mlb";
  const date = url.searchParams.get("date") ?? todayInET();
  if (sport !== "mlb") {
    return NextResponse.json({ error: `no fantasy for sport=${sport}` }, { status: 501 });
  }
  if (!isValidIsoDate(date)) {
    return NextResponse.json({ error: "invalid date" }, { status: 400 });
  }

  const { projections } = await loadFantasyForDate(date);
  const rows: SnapshotRow[] = [];
  for (const cat of HITTER_CATEGORIES) {
    for (const r of projections.byPosition[cat]) {
      rows.push(hitterRowToSnapshot(sport, date, r));
    }
  }
  for (const r of projections.startingPitchers) {
    rows.push(spRowToSnapshot(sport, date, r));
  }

  if (rows.length === 0) {
    return NextResponse.json({ ok: true, date, written: 0, note: "no projections" });
  }

  const sb = supabaseAdmin();
  const { error } = await sb
    .from("daily_fantasy_projections")
    .upsert(rows, { onConflict: "sport,date,player_id,model_version" });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({
    ok: true,
    date,
    written: rows.length,
    model: FANTASY_MODEL_VERSION,
    gameCount: projections.gameCount,
    confirmedCount: projections.confirmedCount,
  });
}
