import { cookies } from "next/headers";
import {
  validateSession,
  SUBSCRIBER_SESSION_COOKIE,
} from "@/lib/subscriber-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { computeStats, type NormalizedAttempt } from "@/lib/games/linescordle/stats";
import { StatsView } from "./StatsView";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Linescordle Stats — boxscore games",
  robots: { index: false },
};

export default async function LinescordleStatsPage() {
  // Authenticated path: query puzzle_attempts server-side and render
  // the computed stats. Anonymous path: hand a sentinel to the client
  // component which reads localStorage and computes there.
  const jar = await cookies();
  const session = await validateSession(jar.get(SUBSCRIBER_SESSION_COOKIE)?.value);

  if (!session) {
    return <StatsView mode="anonymous" initialStats={null} />;
  }

  const { data, error } = await supabaseAdmin()
    .from("puzzle_attempts")
    .select("puzzle_date, guess_count, solved")
    .eq("subscriber_id", session.subscriber_id)
    .eq("game", "linescordle")
    .order("puzzle_date", { ascending: true });
  if (error) throw new Error(`stats fetch: ${error.message}`);

  const normalized: NormalizedAttempt[] = ((data ?? []) as Array<{ puzzle_date: string; guess_count: number; solved: boolean | null }>).map((r) => ({
    puzzleDate: r.puzzle_date,
    guessCount: r.guess_count,
    solved: r.solved,
  }));
  const stats = computeStats(normalized);

  return <StatsView mode="authed" initialStats={stats} />;
}
