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
  generateDailySequence,
  type StatSharksCard,
  type DailySequenceItem,
} from "@/lib/games/statsharks/picker";
import { STATS, statForDate, type StatKey } from "@/lib/games/statsharks/stats";
import { supabaseAdmin } from "@/lib/supabase";

export const DAILY_ROUND_COUNT = 10;

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

// ─── Daily sequence ──────────────────────────────────────────────

/** Public card list for the daily 10-round sequence. Stat values stay
 * hidden — they're only revealed when the user scores a round. */
export type DailyPublicPair = {
  left:  PublicCard;
  right: PublicCard;
};

/** Read-or-create today's daily sequence from puzzle_picks. Once the
 * first subscriber loads the page, the sequence is locked for the day
 * and every subsequent subscriber reads the same one. */
export async function getDailySequence(opts: {
  playedOn: string;
  statKey:  StatKey;
}): Promise<DailyPublicPair[]> {
  const db = supabaseAdmin();
  const { data: existing, error: readErr } = await db
    .from("puzzle_picks")
    .select("notes")
    .eq("game", "statsharks")
    .eq("puzzle_date", opts.playedOn)
    .maybeSingle<{ notes: { sequence?: DailySequenceItem[] } | null }>();
  if (readErr) throw new Error(`getDailySequence read: ${readErr.message}`);

  let items: DailySequenceItem[];
  if (existing?.notes?.sequence?.length) {
    items = existing.notes.sequence;
  } else {
    items = await generateDailySequence({
      statKey: opts.statKey,
      date:    opts.playedOn,
      count:   DAILY_ROUND_COUNT,
    });
    // Insert. ignoreDuplicates handles the race where two subscribers
    // load the page at the same instant — whichever wins the upsert
    // sets the canonical sequence; the loser falls through to a read.
    const { error: upErr } = await db
      .from("puzzle_picks")
      .upsert(
        {
          game:        "statsharks",
          puzzle_date: opts.playedOn,
          subject_ref: opts.statKey,
          notes:       { sequence: items },
        },
        { onConflict: "game,puzzle_date", ignoreDuplicates: true },
      );
    if (upErr) console.error(`getDailySequence write: ${upErr.message}`);
    // Read back in case of race so we return the canonical sequence.
    const { data: confirmed } = await db
      .from("puzzle_picks")
      .select("notes")
      .eq("game", "statsharks")
      .eq("puzzle_date", opts.playedOn)
      .maybeSingle<{ notes: { sequence?: DailySequenceItem[] } | null }>();
    if (confirmed?.notes?.sequence?.length) items = confirmed.notes.sequence;
  }

  // Hydrate the cards (player name / season / team) for the client.
  const allIds = Array.from(new Set(items.flatMap((p) => [p.leftId, p.rightId])));
  const { data: rows } = await db
    .from("player_seasons")
    .select("id, player_id, season, team_abbr, players!inner(full_name)")
    .in("id", allIds);
  type Row = {
    id: number; player_id: number; season: number; team_abbr: string | null;
    players: { full_name: string } | Array<{ full_name: string }>;
  };
  const byId = new Map<number, PublicCard>();
  for (const r of (rows ?? []) as unknown as Row[]) {
    const ps = Array.isArray(r.players) ? r.players[0] : r.players;
    byId.set(r.id, {
      id:          r.id,
      player_name: ps?.full_name ?? "(unknown)",
      season:      r.season,
      team_abbr:   r.team_abbr,
    });
  }
  return items.map((it) => ({
    left:  byId.get(it.leftId)  ?? { id: it.leftId,  player_name: "(unknown)", season: 0, team_abbr: null },
    right: byId.get(it.rightId) ?? { id: it.rightId, player_name: "(unknown)", season: 0, team_abbr: null },
  }));
}

/** Insert a completed Endless run for the signed-in subscriber. No-op
 * for anonymous sessions (they keep only localStorage state). The
 * insert is fire-and-forget from the client's perspective — even if
 * it fails the client's local "best" tracking is canonical for
 * display. */
export async function persistEndlessRun(opts: {
  statKey:  StatKey;
  rounds:   PersistedRound[];
  playedOn: string;
}): Promise<void> {
  const jar = await cookies();
  const session = await validateSession(jar.get(SUBSCRIBER_SESSION_COOKIE)?.value);
  if (!session) return;
  const streak = opts.rounds.filter((r) => r.wasCorrect).length;
  const { error } = await supabaseAdmin()
    .from("statsharks_endless_runs")
    .insert({
      subscriber_id: session.subscriber_id,
      stat_key:      opts.statKey,
      streak,
      rounds:        opts.rounds,
      played_on:     opts.playedOn,
    });
  if (error) console.error(`persistEndlessRun: ${error.message}`);
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
