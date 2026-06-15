import { cookies } from "next/headers";
import {
  validateSession,
  SUBSCRIBER_SESSION_COOKIE,
} from "@/lib/subscriber-auth";
import { todayInET } from "@/lib/dates";
import { EMAIL_LINK_BASE } from "@/lib/site";
import { getDailyGame, loadAttempt } from "./actions";
import type { PersistedAttempt } from "./types";
import { TimeMachineGame } from "./TimeMachineGame";
import "./time-machine.css";

export const dynamic = "force-dynamic";

const META_DESC = "Guess the year of a real MLB box score. Six tries, higher / lower hints. A daily puzzle from boxscore.";
const META_IMG  = `${EMAIL_LINK_BASE}/timemachine_icon.png`;
const META_URL  = `${EMAIL_LINK_BASE}/games/time-machine`;

export const metadata = {
  title:       "Time Machine | boxscore games",
  description: META_DESC,
  openGraph: {
    title:       "Time Machine",
    description: META_DESC,
    url:         META_URL,
    siteName:    "boxscore games",
    type:        "website",
    images: [{ url: META_IMG, width: 464, height: 492, alt: "Time Machine" }],
  },
  twitter: {
    card:        "summary",
    title:       "Time Machine",
    description: META_DESC,
    images:      [META_IMG],
  },
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
