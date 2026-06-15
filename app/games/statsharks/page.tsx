import { cookies } from "next/headers";
import {
  validateSession,
  SUBSCRIBER_SESSION_COOKIE,
} from "@/lib/subscriber-auth";
import { getDailySequence, loadAttempt } from "./actions";
import type { PersistedAttempt } from "./types";
import { statForDate } from "@/lib/games/statsharks/stats";
import { todayInET } from "@/lib/dates";
import { EMAIL_LINK_BASE } from "@/lib/site";
import { StatSharksGame } from "./StatSharksGame";
import "./statsharks.css";

export const dynamic = "force-dynamic";

const META_DESC = "Two players, two seasons. Pick whose stat is higher. Build a streak. A daily puzzle from boxscore.";
const META_IMG  = `${EMAIL_LINK_BASE}/statsharks_icon.png`;
const META_URL  = `${EMAIL_LINK_BASE}/games/statsharks`;

export const metadata = {
  title:       "Stat Sharks | boxscore games",
  description: META_DESC,
  openGraph: {
    title:       "Stat Sharks",
    description: META_DESC,
    url:         META_URL,
    siteName:    "boxscore games",
    type:        "website",
    images: [{ url: META_IMG, width: 451, height: 490, alt: "Stat Sharks" }],
  },
  twitter: {
    card:        "summary",
    title:       "Stat Sharks",
    description: META_DESC,
    images:      [META_IMG],
  },
  // Disable iOS Safari's data detectors — it auto-links player
  // names and years (as if they were contacts or dates), which
  // breaks the card flex layout and renders text blue.
  formatDetection: {
    telephone: false,
    date:      false,
    address:   false,
    email:     false,
    url:       false,
  },
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

  // Daily sequence: 10 pairs in a fixed order, the same for every
  // subscriber today. Fetched once at page load — no per-round
  // roundtrips during play.
  const dailySequence = await getDailySequence({
    playedOn,
    statKey: stat.key,
  });

  return (
    <main className="statsharks">
      <header className="statsharks-h">
        <img src="/statsharks_icon.png" alt="" className="statsharks-h-logo" draggable={false} />
        <h2>Stat Sharks</h2>
        {/* Per-mode subtitle moved into the game box so the page header
            stays identical between Daily and Endless. */}
      </header>
      <StatSharksGame
        statKey={stat.key}
        playedOn={playedOn}
        isAuthed={isAuthed}
        initialAttempt={initialAttempt}
        dailySequence={dailySequence}
      />
    </main>
  );
}
