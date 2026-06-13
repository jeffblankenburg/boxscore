import { cookies } from "next/headers";
import {
  validateSession,
  SUBSCRIBER_SESSION_COOKIE,
} from "@/lib/subscriber-auth";
import { getOrStartRun, type ClientState } from "./actions";
import { StatSharksGame } from "./StatSharksGame";
import "./statsharks.css";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Stat Sharks — boxscore games",
  robots: { index: false },
};

export default async function StatSharksPage() {
  const jar = await cookies();
  const session = await validateSession(jar.get(SUBSCRIBER_SESSION_COOKIE)?.value);
  if (!session) {
    return (
      <main className="statsharks">
        <header className="statsharks-h">
          <h2>Stat Sharks</h2>
          <p className="statsharks-sub">Sign in to play today&rsquo;s run.</p>
        </header>
        <section className="statsharks-signin">
          <p>
            Daily Stat Sharks streaks are tracked per-subscriber. Free
            play (no sign-in) lands later this week.
          </p>
          <a className="statsharks-signin-btn" href="/settings">Sign in →</a>
        </section>
      </main>
    );
  }

  let initial: ClientState;
  try {
    initial = await getOrStartRun();
  } catch (e) {
    return (
      <main className="statsharks">
        <header className="statsharks-h">
          <h2>Stat Sharks</h2>
        </header>
        <p style={{ padding: 16, color: "#a33" }}>
          Couldn&rsquo;t start a run: {(e as Error).message}
        </p>
      </main>
    );
  }

  return (
    <main className="statsharks">
      <header className="statsharks-h">
        <h2>Stat Sharks</h2>
        <p className="statsharks-sub">
          Today&rsquo;s category: <b>{initial.stat.label}</b>
        </p>
      </header>
      <StatSharksGame initial={initial} />
    </main>
  );
}
