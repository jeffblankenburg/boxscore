import { cookies } from "next/headers";
import {
  validateSession,
  SUBSCRIBER_SESSION_COOKIE,
} from "@/lib/subscriber-auth";
import { getPair, loadAttempt, type PublicPair, type PersistedAttempt } from "./actions";
import { statForDate } from "@/lib/games/statsharks/stats";
import { todayInET } from "@/lib/dates";
import { StatSharksGame } from "./StatSharksGame";
import "./statsharks.css";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Stat Sharks — boxscore games",
  robots: { index: false },
};

export default async function StatSharksPage() {
  const playedOn = todayInET();
  const stat = statForDate(playedOn);

  // Server-side initial state: persisted attempt for signed-in users
  // (so they resume across devices), plus a first pair so the client
  // can render without an immediate roundtrip. Anonymous users get
  // the first pair plus a null attempt; the client resumes from
  // localStorage if it has one.
  const jar = await cookies();
  const isAuthed = !!(await validateSession(jar.get(SUBSCRIBER_SESSION_COOKIE)?.value));

  let initialAttempt: PersistedAttempt | null = null;
  if (isAuthed) initialAttempt = await loadAttempt(playedOn);

  // If the user already finished today's run, skip the pair fetch —
  // they'll see the end screen.
  let firstPair: PublicPair | null = null;
  if (!initialAttempt?.ended) {
    const usedIds: number[] = [];
    if (initialAttempt) {
      for (const r of initialAttempt.rounds) {
        usedIds.push(r.leftId, r.rightId);
      }
    }
    firstPair = await getPair({
      statKey: stat.key,
      round:   initialAttempt?.rounds.length ?? 0,
      usedPlayerSeasonIds: usedIds,
    });
  }

  return (
    <main className="statsharks">
      <header className="statsharks-h">
        <h2>Stat Sharks</h2>
        <p className="statsharks-sub">
          Today&rsquo;s category: <b>{stat.label}</b>
        </p>
      </header>
      <StatSharksGame
        statKey={stat.key}
        playedOn={playedOn}
        isAuthed={isAuthed}
        initialAttempt={initialAttempt}
        initialPair={firstPair}
      />
    </main>
  );
}
