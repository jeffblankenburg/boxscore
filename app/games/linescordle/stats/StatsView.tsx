"use client";

import { useEffect, useState } from "react";
import { computeStats, type Stats } from "@/lib/games/linescordle/stats";
import { listAttempts } from "@/lib/games/linescordle/localStore";
import "./stats.css";

export function StatsView({
  mode, initialStats,
}: {
  mode: "anonymous" | "authed";
  initialStats: Stats | null;
}) {
  const [stats, setStats] = useState<Stats | null>(initialStats);
  // For anonymous players the server can't know the stats — read from
  // localStorage on mount and compute. Authed players already have
  // server-computed stats handed in.
  useEffect(() => {
    if (mode !== "anonymous") return;
    const local = listAttempts();
    const normalized = local.map(({ puzzleDate, attempt }) => ({
      puzzleDate,
      guessCount: attempt.guesses.length,
      solved: attempt.solved,
    }));
    setStats(computeStats(normalized));
  }, [mode]);

  if (!stats) {
    return (
      <main className="linescordle-stats">
        <header className="linescordle-stats-h">
          <h1>Linescordle Stats</h1>
        </header>
        <p className="linescordle-stats-empty">Loading…</p>
      </main>
    );
  }

  const maxDist = Math.max(1, ...stats.guessDistribution);

  return (
    <main className="linescordle-stats">
      <header className="linescordle-stats-h">
        <h1>Linescordle Stats</h1>
        <p className="linescordle-stats-sub">
          {mode === "anonymous"
            ? "Saved in this browser. Sign in to keep them across devices."
            : "Saved to your account."}
        </p>
      </header>

      <section className="linescordle-stats-headline">
        <KpiBlock label="Played"        value={stats.gamesPlayed} />
        <KpiBlock label="Win %"         value={`${stats.winPct}`} />
        <KpiBlock label="Current"       value={stats.currentStreak} />
        <KpiBlock label="Max streak"    value={stats.maxStreak} />
      </section>

      <section className="linescordle-stats-section">
        <h2 className="linescordle-stats-h2">Guess distribution</h2>
        {stats.guessDistribution.every((n) => n === 0) ? (
          <p className="linescordle-stats-empty">No wins yet.</p>
        ) : (
          <ol className="linescordle-stats-dist">
            {stats.guessDistribution.map((n, i) => {
              const width = (n / maxDist) * 100;
              return (
                <li key={i} className="linescordle-stats-dist-row">
                  <span className="linescordle-stats-dist-label">{i + 1}</span>
                  <span
                    className="linescordle-stats-dist-bar"
                    style={{ width: `${Math.max(width, 6)}%` }}
                  >
                    {n}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <p className="linescordle-stats-back">
        <a href="/games/linescordle">← Back to Linescordle</a>
      </p>
    </main>
  );
}

function KpiBlock({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="linescordle-stats-kpi">
      <div className="linescordle-stats-kpi-value">{value}</div>
      <div className="linescordle-stats-kpi-label">{label}</div>
    </div>
  );
}
