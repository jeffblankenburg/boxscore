import { cookies } from "next/headers";
import {
  validateSession,
  SUBSCRIBER_SESSION_COOKIE,
} from "@/lib/subscriber-auth";
import { todayInET } from "@/lib/dates";
import { getDailyGame, loadAttempt } from "./actions";
import type { PersistedAttempt } from "./types";
import { TimeMachineGame } from "./TimeMachineGame";
import "./time-machine.css";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Time Machine | boxscore games",
  robots: { index: false },
};

export default async function TimeMachinePage() {
  const playedOn = todayInET();

  const jar = await cookies();
  const isAuthed = !!(await validateSession(jar.get(SUBSCRIBER_SESSION_COOKIE)?.value));

  let initialAttempt: PersistedAttempt | null = null;
  if (isAuthed) initialAttempt = await loadAttempt(playedOn);

  const game = await getDailyGame(playedOn);

  return (
    <main className="time-machine">
      <header className="time-machine-h">
        <img src="/timemachine_icon.png" alt="" className="time-machine-h-logo" draggable={false} />
        <h2>Time Machine</h2>
        <p className="time-machine-sub">
          Guess the year from the box score.
        </p>
        <p className="time-machine-sub">
          Six tries, higher / lower hints after each miss.
        </p>
      </header>
      <TimeMachineGame
        playedOn={playedOn}
        isAuthed={isAuthed}
        game={game}
        initialAttempt={initialAttempt}
      />
    </main>
  );
}
