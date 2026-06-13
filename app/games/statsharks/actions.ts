"use server";

// Server actions for Stat Sharks (#64). Stateless scoring + pair
// generation, plus an optional persistence sync for signed-in
// subscribers. Mirrors the Linescordle pattern: the answer never
// reaches the client until a round is scored, but the client owns the
// run state and replays via localStorage. Anonymous play works out of
// the box.

import { cookies } from "next/headers";
import {
  validateSession,
  SUBSCRIBER_SESSION_COOKIE,
} from "@/lib/subscriber-auth";
import { saveAttempt, getAttempt } from "@/lib/games/attempts";
import {
  pickStatSharksPair,
  type StatSharksCard,
} from "@/lib/games/statsharks/picker";
import { STATS, statForDate, type StatKey } from "@/lib/games/statsharks/stats";
import { supabaseAdmin } from "@/lib/supabase";

// ─── Shared types ────────────────────────────────────────────────

/** Public card — what the client sees BEFORE a round is scored. No
 * stat value; the value is only revealed by scorePair() after the
 * user picks. */
export type PublicCard = {
  id:          number;
  player_name: string;
  season:      number;
  team_abbr:   string | null;
};

export type PublicPair = {
  left:  PublicCard;
  right: PublicCard;
};

export type ScoreResult = {
  leftValue:   number;
  rightValue:  number;
  correctSide: "left" | "right";
  wasCorrect:  boolean;
};

// Persisted history per attempt — what we store in puzzle_attempts
// for authed subscribers + in localStorage for everyone.
export type PersistedRound = {
  leftId:      number;
  rightId:     number;
  pickedSide:  "left" | "right" | "timeout";
  wasCorrect:  boolean;
};
export type PersistedAttempt = {
  stat:    StatKey;
  rounds:  PersistedRound[];
  ended:   boolean;
};

// ─── Helpers ─────────────────────────────────────────────────────

function toPublic(card: StatSharksCard): PublicCard {
  return {
    id:          card.id,
    player_name: card.player_name,
    season:      card.season,
    team_abbr:   card.team_abbr,
  };
}

// ─── Pair generation ─────────────────────────────────────────────

/** Generate the next pair given the user's history. Stateless on the
 * server — the client passes the list of player_seasons.ids already
 * used in this run. Returns null when the pool is exhausted (the run
 * effectively ends with whatever the streak was). */
export async function getPair(opts: {
  statKey: StatKey;
  round:   number;
  usedPlayerSeasonIds: number[];
}): Promise<PublicPair | null> {
  const pair = await pickStatSharksPair({
    statKey:             opts.statKey,
    round:               opts.round,
    usedPlayerSeasonIds: opts.usedPlayerSeasonIds,
  });
  if (!pair) return null;
  return { left: toPublic(pair.left), right: toPublic(pair.right) };
}

// ─── Scoring ─────────────────────────────────────────────────────

/** Score a single pick. Server re-fetches both player_seasons rows
 * so a tampered client can't fake a higher value. */
export async function scorePair(opts: {
  statKey:    StatKey;
  leftId:     number;
  rightId:    number;
  pickedSide: "left" | "right" | "timeout";
}): Promise<ScoreResult> {
  const stat = STATS[opts.statKey];
  if (!stat) throw new Error(`unknown stat: ${opts.statKey}`);

  const { data, error } = await supabaseAdmin()
    .from("player_seasons")
    .select(`id, ${stat.column}`)
    .in("id", [opts.leftId, opts.rightId]);
  if (error) throw new Error(`scorePair: ${error.message}`);
  const byId = new Map<number, number>();
  for (const r of (data ?? []) as unknown as Array<Record<string, unknown>>) {
    const id = r.id as number;
    const v = r[stat.column];
    if (typeof v === "number") byId.set(id, v);
  }
  const leftValue  = byId.get(opts.leftId)  ?? 0;
  const rightValue = byId.get(opts.rightId) ?? 0;
  const correctSide: "left" | "right" = stat.direction === "higher"
    ? (leftValue >= rightValue ? "left" : "right")
    : (leftValue <= rightValue ? "left" : "right");
  const wasCorrect = opts.pickedSide !== "timeout" && opts.pickedSide === correctSide;
  return { leftValue, rightValue, correctSide, wasCorrect };
}

// ─── Persistence (authed only) ───────────────────────────────────

/** Push the current attempt state to puzzle_attempts. Idempotent
 * upsert — fine to call after every round. No-op for anonymous
 * sessions. */
export async function persistAttempt(opts: {
  playedOn:  string;
  statKey:   StatKey;
  rounds:    PersistedRound[];
  ended:     boolean;
}): Promise<void> {
  const jar = await cookies();
  const session = await validateSession(jar.get(SUBSCRIBER_SESSION_COOKIE)?.value);
  if (!session) return;       // anonymous — nothing to persist server-side
  const persisted: PersistedAttempt = {
    stat:   opts.statKey,
    rounds: opts.rounds,
    ended:  opts.ended,
  };
  const streak = opts.rounds.filter((r) => r.wasCorrect).length;
  await saveAttempt({
    subscriberId:    session.subscriber_id,
    game:            "statsharks",
    puzzleDate:      opts.playedOn,
    puzzleSubjectId: opts.statKey,
    guesses:         persisted as unknown,
    hints:           [],
    solved:          opts.ended ? streak >= 1 : null,
    guessCount:      opts.rounds.length,
    hintCount:       0,
  });
}

/** Server-side initial-state lookup for authed subscribers. Returns
 * the persisted attempt for today, or null if no row exists yet. */
export async function loadAttempt(playedOn: string): Promise<PersistedAttempt | null> {
  const jar = await cookies();
  const session = await validateSession(jar.get(SUBSCRIBER_SESSION_COOKIE)?.value);
  if (!session) return null;
  const row = await getAttempt({
    subscriberId: session.subscriber_id,
    game:         "statsharks",
    puzzleDate:   playedOn,
  });
  return (row?.guesses as PersistedAttempt | undefined) ?? null;
}
