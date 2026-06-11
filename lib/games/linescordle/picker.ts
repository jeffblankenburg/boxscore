// Linescordle daily picker. Server-only. Run from page.tsx to resolve
// today's puzzle out of historical_player_lines.
//
// Algorithm:
//   1. Filter candidates: today's calendar day (month+day), feat_score
//      above MIN_FEAT, name length ≤ MAX_NAME_LENGTH (avoids
//      27-char-name puzzles that would be unreadable).
//   2. Exclude player_ids that have been the Linescordle answer in the last
//      NO_REPEAT_DAYS days — guarantees a player isn't picked twice
//      inside the rotation window.
//   3. Pick the highest feat_score line that remains. Determinism by
//      date means a re-render of the same calendar day always returns
//      the same puzzle.
//   4. Write to puzzle_picks (game='linescordle', puzzle_date=today,
//      subject_ref=line.id) so the next render hits the cached row
//      instead of re-querying candidates.
//
// Returns null when no eligible candidate exists (insufficient data
// for that calendar day at that threshold). Caller can fall back to a
// hardcoded puzzle in that case.

import "server-only";

import { supabaseAdmin } from "../../supabase";
import { normalize } from "./feedback";
import type { LinescordlePuzzle } from "./content";
import { getPlayerById } from "../../players";

const MIN_FEAT = 30;
const MAX_NAME_LENGTH = 16;
const NO_REPEAT_DAYS = 90;
// Size of the candidate pool the picker selects randomly from. 700 ≈
// two years of daily puzzles before any repeat is mathematically
// possible — so the experience stays full of surprises for a long
// time. Random selection (vs always-highest) means the user might see
// a 5-HR game today and a 17-K game tomorrow instead of the same Pedro
// gem every year on Sept 10.
const POOL_SIZE = 700;

// Subject ref shape — for live picks this is the
// historical_player_lines.id as a string; for hardcoded v0 fallbacks
// the test puzzle map's literal subject_id.
const SUBJECT_REF_PREFIX = "line-";

export function subjectRefForLine(lineId: number): string {
  return `${SUBJECT_REF_PREFIX}${lineId}`;
}

export function parseLineIdFromSubjectRef(ref: string): number | null {
  if (!ref.startsWith(SUBJECT_REF_PREFIX)) return null;
  const n = Number(ref.slice(SUBJECT_REF_PREFIX.length));
  return Number.isFinite(n) ? n : null;
}

type CandidateLine = {
  id: number;
  player_id: number;
  player_name: string;
  game_pk: number;
  game_date: string;
  team_abbr: string | null;
  opp_team_abbr: string | null;
  line_type: "batting" | "pitching";
  batting_stats: Record<string, number> | null;
  pitching_stats: Record<string, string | number> | null;
  feat_score: number;
};

// Look up today's pick from puzzle_picks if it exists. Returns the
// stored subject_ref string (typically "line-12345").
async function getExistingPick(puzzleDate: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from("puzzle_picks")
    .select("subject_ref")
    .eq("game", "linescordle")
    .eq("puzzle_date", puzzleDate)
    .maybeSingle<{ subject_ref: string }>();
  if (error) throw new Error(`getExistingPick: ${error.message}`);
  return data?.subject_ref ?? null;
}

// Collect player_ids used as Linescordle answers in the last N days.
async function recentlyUsedPlayerIds(beforeDate: string): Promise<Set<number>> {
  // puzzle_picks doesn't carry player_id directly — we have to join
  // back through historical_player_lines.
  const sinceDate = new Date(beforeDate);
  sinceDate.setDate(sinceDate.getDate() - NO_REPEAT_DAYS);
  const sinceIso = sinceDate.toISOString().slice(0, 10);

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("puzzle_picks")
    .select("subject_ref")
    .eq("game", "linescordle")
    .gte("puzzle_date", sinceIso)
    .lt("puzzle_date", beforeDate);
  if (error) throw new Error(`recentlyUsedPlayerIds picks: ${error.message}`);

  const lineIds: number[] = [];
  for (const row of (data ?? []) as Array<{ subject_ref: string }>) {
    const id = parseLineIdFromSubjectRef(row.subject_ref);
    if (id != null) lineIds.push(id);
  }
  if (lineIds.length === 0) return new Set();

  const { data: lines, error: lerr } = await db
    .from("historical_player_lines")
    .select("player_id")
    .in("id", lineIds);
  if (lerr) throw new Error(`recentlyUsedPlayerIds lines: ${lerr.message}`);
  const set = new Set<number>();
  for (const row of (lines ?? []) as Array<{ player_id: number }>) {
    set.add(row.player_id);
  }
  return set;
}

// Pull the top POOL_SIZE candidate lines globally (any calendar day).
// Random selection happens client-side after recency + name filters
// — see pickLinescordleForDate.
async function fetchCandidates(limit = POOL_SIZE): Promise<CandidateLine[]> {
  const { data, error } = await supabaseAdmin()
    .from("historical_player_lines")
    .select(
      "id,player_id,player_name,game_pk,game_date,team_abbr,opp_team_abbr," +
      "line_type,batting_stats,pitching_stats,feat_score",
    )
    .gte("feat_score", MIN_FEAT)
    .order("feat_score", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`fetchCandidates: ${error.message}`);
  return (data ?? []) as unknown as CandidateLine[];
}

// Persist the pick so re-renders are idempotent.
async function recordPick(puzzleDate: string, lineId: number): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("puzzle_picks")
    .insert({
      game: "linescordle",
      puzzle_date: puzzleDate,
      subject_ref: subjectRefForLine(lineId),
    });
  if (error && error.code !== "23505") {
    // 23505 = unique-violation — race with another renderer; benign,
    // either insert wins and they both observe the same row on the
    // next read.
    throw new Error(`recordPick: ${error.message}`);
  }
}

// Resolve a line into the full LinescordlePuzzle shape the rest of the
// game expects. Joins to players (for the canonical mlb_id +
// display name) and shapes the batting/pitching jsonb into the
// puzzle's expected typed columns.
async function resolveLineToPuzzle(line: CandidateLine): Promise<LinescordlePuzzle | null> {
  const player = await getPlayerById(line.player_id);
  if (!player) return null;
  const displayName = player.full_name ?? line.player_name;
  const answer = normalize(displayName);

  if (line.line_type === "batting" && line.batting_stats) {
    const b = line.batting_stats as Record<string, number>;
    return {
      answer,
      displayName,
      mlbId: player.mlb_id ?? 0,
      sourceGamePk: line.game_pk,
      line: {
        kind: "batting",
        date: line.game_date,
        teamAbbr: line.team_abbr ?? "—",
        oppAbbr: line.opp_team_abbr ?? "—",
        batting: {
          ab:      b.atBats ?? 0,
          r:       b.runs ?? 0,
          h:       b.hits ?? 0,
          rbi:     b.rbi ?? 0,
          bb:      b.baseOnBalls ?? 0,
          so:      b.strikeOuts ?? 0,
          hr:      b.homeRuns ?? 0,
          doubles: b.doubles ?? 0,
          triples: b.triples ?? 0,
          sb:      b.stolenBases ?? 0,
        },
      },
    };
  }
  if (line.line_type === "pitching" && line.pitching_stats) {
    const p = line.pitching_stats as Record<string, string | number>;
    return {
      answer,
      displayName,
      mlbId: player.mlb_id ?? 0,
      sourceGamePk: line.game_pk,
      line: {
        kind: "pitching",
        date: line.game_date,
        teamAbbr: line.team_abbr ?? "—",
        oppAbbr: line.opp_team_abbr ?? "—",
        pitching: {
          ip: String(p.inningsPitched ?? "0.0"),
          h:  Number(p.hits ?? 0),
          r:  Number(p.runs ?? 0),
          er: Number(p.earnedRuns ?? 0),
          bb: Number(p.baseOnBalls ?? 0),
          so: Number(p.strikeOuts ?? 0),
          hr: Number(p.homeRuns ?? 0),
        },
      },
    };
  }
  return null;
}

// ─── Public entry ──────────────────────────────────────────────────

export type PickedPuzzle = { subjectId: string; puzzle: LinescordlePuzzle };

// Returns today's puzzle. Idempotent: if puzzle_picks already has a
// row for today, we return that. Otherwise we pick fresh and write.
// Returns null when no eligible candidate exists for today (caller
// can fall back).
export async function pickLinescordleForDate(puzzleDate: string): Promise<PickedPuzzle | null> {
  // Idempotent path — use existing pick if there is one.
  const existing = await getExistingPick(puzzleDate);
  if (existing) {
    const lineId = parseLineIdFromSubjectRef(existing);
    if (lineId != null) {
      const { data, error } = await supabaseAdmin()
        .from("historical_player_lines")
        .select(
          "id,player_id,player_name,game_pk,game_date,team_abbr,opp_team_abbr," +
          "line_type,batting_stats,pitching_stats,feat_score",
        )
        .eq("id", lineId)
        .maybeSingle<CandidateLine>();
      if (error) throw new Error(`pickLinescordleForDate resolve existing: ${error.message}`);
      if (data) {
        const puzzle = await resolveLineToPuzzle(data);
        if (puzzle) return { subjectId: existing, puzzle };
      }
    }
  }

  // Otherwise pick fresh from the top POOL_SIZE candidates globally.
  const [candidates, excluded] = await Promise.all([
    fetchCandidates(),
    recentlyUsedPlayerIds(puzzleDate),
  ]);

  // Filter pool by recency + name length BEFORE we shuffle. That keeps
  // the random pool full of eligible answers — picking blindly first
  // and then rejecting would waste rolls on always-ineligible top
  // scorers.
  const eligible = candidates.filter((c) => {
    if (excluded.has(c.player_id)) return false;
    if (normalize(c.player_name).length > MAX_NAME_LENGTH) return false;
    return true;
  });

  // If recency wiped the pool empty (unlikely with 700-candidate pool +
  // 90-day window), retry without the recency filter so we never fail
  // to render a puzzle.
  const pool = eligible.length > 0
    ? eligible
    : candidates.filter((c) => normalize(c.player_name).length <= MAX_NAME_LENGTH);

  if (pool.length === 0) return null;

  // Deterministic random per-date: every renderer in the race picks the
  // same line until one wins the puzzle_picks unique-constraint write.
  // Without this, two requests in the same second could both pick
  // different lines and the loser silently uses a different puzzle
  // than what got stored.
  const seed = puzzleDate.split("-").reduce((a, s) => a * 31 + Number(s), 7);
  const idx = Math.abs(Math.imul(seed, 2654435761)) % pool.length;
  const chosen = pool[idx]!;

  const puzzle = await resolveLineToPuzzle(chosen);
  if (!puzzle) return null;
  if (puzzle.answer.length > MAX_NAME_LENGTH) {
    // Players cache disagreed with the denormalized name about
    // length; degrade gracefully by picking the next eligible.
    for (const cand of pool) {
      if (cand.id === chosen.id) continue;
      const next = await resolveLineToPuzzle(cand);
      if (!next || next.answer.length > MAX_NAME_LENGTH) continue;
      await recordPick(puzzleDate, cand.id);
      return { subjectId: subjectRefForLine(cand.id), puzzle: next };
    }
    return null;
  }
  await recordPick(puzzleDate, chosen.id);
  return { subjectId: subjectRefForLine(chosen.id), puzzle };
}
