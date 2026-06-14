import { requireAdmin } from "../require-admin";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Games analytics | admin | boxscore",
  robots: { index: false },
};

const RECENT_DAYS = 7;

// ─── Type shapes ─────────────────────────────────────────────────

type SharksDailyAttempt = {
  puzzle_date: string;
  puzzle_subject_id: string;       // the day's stat key (HR, K, …)
  guesses: { rounds?: Array<{ wasCorrect: boolean }> };
  guess_count: number;
  solved: boolean | null;
  subscriber_id: string;
};

type LinescordleAttempt = {
  puzzle_date: string;
  guess_count: number;
  solved: boolean | null;
  hint_count: number;
  subscriber_id: string;
};

type EndlessRun = {
  subscriber_id: string;
  stat_key: string;
  streak: number;
  played_on: string;
  rounds:   Array<{ pickedSide?: string; wasCorrect?: boolean; elapsedMs?: number }>;
};

// ─── Data loaders ────────────────────────────────────────────────

function recentDateRange(): { from: string; to: string } {
  const today = new Date();
  const to   = today.toISOString().slice(0, 10);
  const fromDate = new Date(today.getTime() - RECENT_DAYS * 24 * 60 * 60 * 1000);
  const from = fromDate.toISOString().slice(0, 10);
  return { from, to };
}

async function loadStatSharksDaily(): Promise<SharksDailyAttempt[]> {
  const { from } = recentDateRange();
  const db = supabaseAdmin();
  const PAGE = 1000;
  const out: SharksDailyAttempt[] = [];
  let cursor = "0";
  for (;;) {
    const { data, error } = await db
      .from("puzzle_attempts")
      .select("puzzle_date, puzzle_subject_id, guesses, guess_count, solved, subscriber_id, id")
      .eq("game", "statsharks")
      .gte("puzzle_date", from)
      .gt("id", cursor)
      .order("id", { ascending: true })
      .limit(PAGE);
    if (error) throw new Error(`statsharks daily: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data) {
      out.push(r as unknown as SharksDailyAttempt);
    }
    cursor = String((data[data.length - 1] as { id: number }).id);
    if (data.length < PAGE) break;
  }
  return out;
}

async function loadLinescordleAttempts(): Promise<LinescordleAttempt[]> {
  const { from } = recentDateRange();
  const db = supabaseAdmin();
  const PAGE = 1000;
  const out: LinescordleAttempt[] = [];
  let cursor = "0";
  for (;;) {
    const { data, error } = await db
      .from("puzzle_attempts")
      .select("puzzle_date, guess_count, solved, hint_count, subscriber_id, id")
      .eq("game", "linescordle")
      .gte("puzzle_date", from)
      .gt("id", cursor)
      .order("id", { ascending: true })
      .limit(PAGE);
    if (error) throw new Error(`linescordle: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data) out.push(r as unknown as LinescordleAttempt);
    cursor = String((data[data.length - 1] as { id: number }).id);
    if (data.length < PAGE) break;
  }
  return out;
}

async function loadEndlessRuns(): Promise<EndlessRun[]> {
  const db = supabaseAdmin();
  const PAGE = 1000;
  const out: EndlessRun[] = [];
  let cursor = 0;
  for (;;) {
    const { data, error } = await db
      .from("statsharks_endless_runs")
      .select("id, subscriber_id, stat_key, streak, played_on, rounds")
      .gt("id", cursor)
      .order("id", { ascending: true })
      .limit(PAGE);
    if (error) throw new Error(`endless: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data as Array<EndlessRun & { id: number }>) {
      out.push({
        subscriber_id: r.subscriber_id,
        stat_key:      r.stat_key,
        streak:        r.streak,
        played_on:     r.played_on,
        rounds:        Array.isArray(r.rounds) ? r.rounds : [],
      });
    }
    cursor = (data[data.length - 1] as { id: number }).id;
    if (data.length < PAGE) break;
  }
  return out;
}

// ─── Computations ────────────────────────────────────────────────

type StatSharksDayRow = {
  date:      string;
  stat:      string;
  attempts:  number;
  wins:      number;     // streak === 10
  losses:    number;     // ended without 10
  inProgress: number;
  avgScore:  number;     // average streak (correct rounds) across completed
  scoreDist: number[];   // length 11 — counts for 0/10 … 10/10
  timeoutPct: number;    // % of all completed rounds that ended on a 30s timeout
  avgAnswerMs: number;   // avg ms-to-answer across all rounds with elapsedMs
};

function streakFromGuesses(r: SharksDailyAttempt): number {
  return r.guesses?.rounds?.filter((x) => x.wasCorrect).length ?? r.guess_count ?? 0;
}

// Sum of completed rounds (wins + losses + early-ended) so we can
// roll up timeout / answer-time stats across an entire day.
function roundsOfAttempt(r: SharksDailyAttempt): Array<{ pickedSide?: string; wasCorrect?: boolean; elapsedMs?: number }> {
  return (r.guesses as { rounds?: Array<{ pickedSide?: string; wasCorrect?: boolean; elapsedMs?: number }> })?.rounds ?? [];
}

function isEnded(r: SharksDailyAttempt): boolean {
  // streak===10 wins; less-than-10 with the last round wrong is a
  // loss. The `solved` flag is set when ended.
  return r.solved !== null;
}

function aggSharksDaily(rows: SharksDailyAttempt[]): StatSharksDayRow[] {
  const byDay = new Map<string, SharksDailyAttempt[]>();
  for (const r of rows) {
    const arr = byDay.get(r.puzzle_date) ?? [];
    arr.push(r);
    byDay.set(r.puzzle_date, arr);
  }
  const out: StatSharksDayRow[] = [];
  for (const [date, rs] of byDay) {
    const stat = rs[0]?.puzzle_subject_id ?? "?";
    const attempts = rs.length;
    let wins = 0, losses = 0, inProgress = 0;
    const scoreDist = new Array<number>(11).fill(0);
    let totalScore = 0, completed = 0;
    let totalRounds = 0, timeoutRounds = 0;
    let answerMsSum = 0, answerMsCount = 0;
    for (const r of rs) {
      const streak = streakFromGuesses(r);
      if (!isEnded(r)) { inProgress++; continue; }
      if (streak >= 10) wins++; else losses++;
      const bucket = Math.min(10, Math.max(0, streak));
      scoreDist[bucket] = (scoreDist[bucket] ?? 0) + 1;
      totalScore += streak;
      completed++;
      // Per-round aggregates for timeout % and avg time.
      for (const round of roundsOfAttempt(r)) {
        totalRounds++;
        if (round.pickedSide === "timeout") timeoutRounds++;
        if (typeof round.elapsedMs === "number") {
          answerMsSum   += round.elapsedMs;
          answerMsCount++;
        }
      }
    }
    out.push({
      date, stat, attempts, wins, losses, inProgress,
      avgScore: completed > 0 ? totalScore / completed : 0,
      scoreDist,
      timeoutPct:  totalRounds   > 0 ? (timeoutRounds / totalRounds) * 100 : 0,
      avgAnswerMs: answerMsCount > 0 ? answerMsSum / answerMsCount      : 0,
    });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

type LinescordleDayRow = {
  date:     string;
  attempts: number;
  wins:     number;
  losses:   number;
  inProgress: number;
  winRatePct:    number;
  avgWinGuesses: number;
  withHintPct:   number;
};

function aggLinescordle(rows: LinescordleAttempt[]): LinescordleDayRow[] {
  const byDay = new Map<string, LinescordleAttempt[]>();
  for (const r of rows) {
    const arr = byDay.get(r.puzzle_date) ?? [];
    arr.push(r);
    byDay.set(r.puzzle_date, arr);
  }
  const out: LinescordleDayRow[] = [];
  for (const [date, rs] of byDay) {
    const attempts = rs.length;
    let wins = 0, losses = 0, inProgress = 0, hinted = 0;
    let winGuessSum = 0, winCount = 0;
    for (const r of rs) {
      if (r.solved === null) { inProgress++; continue; }
      if (r.solved) { wins++; winGuessSum += r.guess_count; winCount++; }
      else { losses++; }
      if (r.hint_count > 0) hinted++;
    }
    const completed = wins + losses;
    out.push({
      date, attempts, wins, losses, inProgress,
      winRatePct:    completed > 0 ? (wins / completed) * 100 : 0,
      avgWinGuesses: winCount > 0 ? winGuessSum / winCount : 0,
      withHintPct:   completed > 0 ? (hinted / completed) * 100 : 0,
    });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

type EndlessStatRow = {
  stat:        string;
  runs:        number;
  uniqueSubs:  number;
  avgStreak:   number;
  medianStreak: number;
  topStreak:   number;
  timeoutPct:   number;
  avgAnswerMs:  number;
};

function aggEndless(rows: EndlessRun[]): EndlessStatRow[] {
  const byStat = new Map<string, EndlessRun[]>();
  for (const r of rows) {
    const arr = byStat.get(r.stat_key) ?? [];
    arr.push(r);
    byStat.set(r.stat_key, arr);
  }
  const out: EndlessStatRow[] = [];
  for (const [stat, rs] of byStat) {
    const runs = rs.length;
    const subs = new Set(rs.map((r) => r.subscriber_id));
    const streaks = rs.map((r) => r.streak).sort((a, b) => a - b);
    const sum = streaks.reduce((a, b) => a + b, 0);
    const median = streaks.length === 0 ? 0
      : streaks.length % 2 === 1
        ? streaks[(streaks.length - 1) / 2]!
        : (streaks[streaks.length / 2 - 1]! + streaks[streaks.length / 2]!) / 2;
    let totalRounds = 0, timeoutRounds = 0, answerMsSum = 0, answerMsCount = 0;
    for (const r of rs) {
      for (const round of r.rounds) {
        totalRounds++;
        if (round.pickedSide === "timeout") timeoutRounds++;
        if (typeof round.elapsedMs === "number") {
          answerMsSum += round.elapsedMs;
          answerMsCount++;
        }
      }
    }
    out.push({
      stat,
      runs,
      uniqueSubs: subs.size,
      avgStreak:  runs > 0 ? sum / runs : 0,
      medianStreak: median,
      topStreak:  streaks.length > 0 ? streaks[streaks.length - 1]! : 0,
      timeoutPct:  totalRounds   > 0 ? (timeoutRounds / totalRounds) * 100 : 0,
      avgAnswerMs: answerMsCount > 0 ? answerMsSum / answerMsCount      : 0,
    });
  }
  return out.sort((a, b) => b.runs - a.runs);
}

// Top 5 endless streaks across all stats, with the subscriber email.
async function loadEndlessLeaderboard(): Promise<Array<{
  email: string; stat_key: string; streak: number; played_on: string;
}>> {
  const db = supabaseAdmin();
  const { data } = await db
    .from("statsharks_endless_runs")
    .select("stat_key, streak, played_on, subscribers!inner(email)")
    .order("streak", { ascending: false })
    .limit(10);
  type Row = { stat_key: string; streak: number; played_on: string; subscribers: { email: string } | { email: string }[] };
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    email:     (Array.isArray(r.subscribers) ? r.subscribers[0]?.email : r.subscribers?.email) ?? "(unknown)",
    stat_key:  r.stat_key,
    streak:    r.streak,
    played_on: r.played_on,
  }));
}

// ─── Render ──────────────────────────────────────────────────────

function PctBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{ display: "flex", height: 10, background: "#eee", borderRadius: 2, overflow: "hidden", width: 80 }}>
      <div style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

export default async function AdminGamesView() {
  await requireAdmin();
  const [sharksDailyRows, lineRows, endlessRuns, leaderboard] = await Promise.all([
    loadStatSharksDaily(),
    loadLinescordleAttempts(),
    loadEndlessRuns(),
    loadEndlessLeaderboard(),
  ]);
  const sharksDaily   = aggSharksDaily(sharksDailyRows);
  const lineDaily     = aggLinescordle(lineRows);
  const endlessByStat = aggEndless(endlessRuns);
  const endlessTotal  = endlessRuns.length;
  const endlessUniqueSubs = new Set(endlessRuns.map((r) => r.subscriber_id)).size;

  return (
    <main className="admin">
      <h1>Games analytics</h1>
      <p className="admin-meta">Last {RECENT_DAYS} days of Daily attempts; all-time Endless runs.</p>

      {/* ─── Stat Sharks Daily ───────────────────────────────── */}
      <h2 style={{ marginTop: 24 }}>Stat Sharks · Daily</h2>
      {sharksDaily.length === 0 ? (
        <p className="admin-meta">No attempts in the last {RECENT_DAYS} days.</p>
      ) : (
        <table className="admin-clicks-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Stat</th>
              <th style={{ textAlign: "right" }}>Attempts</th>
              <th style={{ textAlign: "right" }}>Wins (10/10)</th>
              <th style={{ textAlign: "right" }}>Losses</th>
              <th style={{ textAlign: "right" }}>In progress</th>
              <th style={{ textAlign: "right" }}>Avg score</th>
              <th style={{ textAlign: "right" }}>Timeout %</th>
              <th style={{ textAlign: "right" }}>Avg time</th>
              <th>Distribution (0–10)</th>
            </tr>
          </thead>
          <tbody>
            {sharksDaily.map((r) => {
              const maxBucket = Math.max(1, ...r.scoreDist);
              return (
                <tr key={r.date}>
                  <td><code>{r.date}</code></td>
                  <td><code>{r.stat}</code></td>
                  <td style={{ textAlign: "right", fontFamily: "ui-monospace, monospace" }}>{r.attempts.toLocaleString()}</td>
                  <td style={{ textAlign: "right", fontFamily: "ui-monospace, monospace", color: "#1f7a3a", fontWeight: 700 }}>{r.wins}</td>
                  <td style={{ textAlign: "right", fontFamily: "ui-monospace, monospace" }}>{r.losses}</td>
                  <td style={{ textAlign: "right", fontFamily: "ui-monospace, monospace", color: "#888" }}>{r.inProgress}</td>
                  <td style={{ textAlign: "right", fontFamily: "ui-monospace, monospace" }}>{r.avgScore.toFixed(2)}</td>
                  <td style={{ textAlign: "right", fontFamily: "ui-monospace, monospace", color: r.timeoutPct > 10 ? "#c4392a" : undefined }}>{r.timeoutPct.toFixed(1)}%</td>
                  <td style={{ textAlign: "right", fontFamily: "ui-monospace, monospace" }}>
                    {r.avgAnswerMs > 0 ? `${(r.avgAnswerMs / 1000).toFixed(1)}s` : "—"}
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 2, alignItems: "flex-end", height: 28 }} title={r.scoreDist.map((c, i) => `${i}: ${c}`).join(", ")}>
                      {r.scoreDist.map((c, i) => (
                        <div key={i} style={{
                          width: 8,
                          height: `${(c / maxBucket) * 100}%`,
                          minHeight: c > 0 ? 2 : 0,
                          background: i === 10 ? "#1f7a3a" : "#3a5fcc",
                          opacity: c > 0 ? 1 : 0.2,
                        }} />
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* ─── Stat Sharks Endless ─────────────────────────────── */}
      <h2 style={{ marginTop: 28 }}>Stat Sharks · Endless</h2>
      <p className="admin-meta">
        <b>{endlessTotal.toLocaleString()}</b> runs across <b>{endlessUniqueSubs.toLocaleString()}</b> subscribers.
      </p>
      {endlessByStat.length === 0 ? (
        <p className="admin-meta">No endless runs persisted yet.</p>
      ) : (
        <table className="admin-clicks-table">
          <thead>
            <tr>
              <th>Stat</th>
              <th style={{ textAlign: "right" }}>Runs</th>
              <th style={{ textAlign: "right" }}>Unique subs</th>
              <th style={{ textAlign: "right" }}>Avg streak</th>
              <th style={{ textAlign: "right" }}>Median</th>
              <th style={{ textAlign: "right" }}>Top streak</th>
              <th style={{ textAlign: "right" }}>Timeout %</th>
              <th style={{ textAlign: "right" }}>Avg time</th>
            </tr>
          </thead>
          <tbody>
            {endlessByStat.map((r) => (
              <tr key={r.stat}>
                <td><code>{r.stat}</code></td>
                <td style={{ textAlign: "right", fontFamily: "ui-monospace, monospace" }}>{r.runs.toLocaleString()}</td>
                <td style={{ textAlign: "right", fontFamily: "ui-monospace, monospace" }}>{r.uniqueSubs.toLocaleString()}</td>
                <td style={{ textAlign: "right", fontFamily: "ui-monospace, monospace" }}>{r.avgStreak.toFixed(2)}</td>
                <td style={{ textAlign: "right", fontFamily: "ui-monospace, monospace" }}>{r.medianStreak}</td>
                <td style={{ textAlign: "right", fontFamily: "ui-monospace, monospace", fontWeight: 700, color: "#1f7a3a" }}>{r.topStreak}</td>
                <td style={{ textAlign: "right", fontFamily: "ui-monospace, monospace", color: r.timeoutPct > 10 ? "#c4392a" : undefined }}>{r.timeoutPct.toFixed(1)}%</td>
                <td style={{ textAlign: "right", fontFamily: "ui-monospace, monospace" }}>
                  {r.avgAnswerMs > 0 ? `${(r.avgAnswerMs / 1000).toFixed(1)}s` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* ─── Endless leaderboard ─────────────────────────────── */}
      <h3 style={{ marginTop: 18, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        Top 10 endless streaks
      </h3>
      {leaderboard.length === 0 ? (
        <p className="admin-meta">No persisted runs yet.</p>
      ) : (
        <table className="admin-clicks-table">
          <thead>
            <tr>
              <th>Subscriber</th>
              <th>Stat</th>
              <th style={{ textAlign: "right" }}>Streak</th>
              <th>Played on</th>
            </tr>
          </thead>
          <tbody>
            {leaderboard.map((r, i) => (
              <tr key={i}>
                <td>{r.email}</td>
                <td><code>{r.stat_key}</code></td>
                <td style={{ textAlign: "right", fontFamily: "ui-monospace, monospace", fontWeight: 700 }}>{r.streak}</td>
                <td className="admin-meta">{r.played_on}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* ─── Linescordle ─────────────────────────────────────── */}
      <h2 style={{ marginTop: 28 }}>Linescordle</h2>
      {lineDaily.length === 0 ? (
        <p className="admin-meta">No attempts in the last {RECENT_DAYS} days.</p>
      ) : (
        <table className="admin-clicks-table">
          <thead>
            <tr>
              <th>Date</th>
              <th style={{ textAlign: "right" }}>Attempts</th>
              <th style={{ textAlign: "right" }}>Wins</th>
              <th style={{ textAlign: "right" }}>Losses</th>
              <th style={{ textAlign: "right" }}>In progress</th>
              <th style={{ textAlign: "right" }}>Win rate</th>
              <th></th>
              <th style={{ textAlign: "right" }}>Avg win guesses</th>
              <th style={{ textAlign: "right" }}>% w/ hints</th>
            </tr>
          </thead>
          <tbody>
            {lineDaily.map((r) => (
              <tr key={r.date}>
                <td><code>{r.date}</code></td>
                <td style={{ textAlign: "right", fontFamily: "ui-monospace, monospace" }}>{r.attempts.toLocaleString()}</td>
                <td style={{ textAlign: "right", fontFamily: "ui-monospace, monospace", color: "#1f7a3a", fontWeight: 700 }}>{r.wins}</td>
                <td style={{ textAlign: "right", fontFamily: "ui-monospace, monospace" }}>{r.losses}</td>
                <td style={{ textAlign: "right", fontFamily: "ui-monospace, monospace", color: "#888" }}>{r.inProgress}</td>
                <td style={{ textAlign: "right", fontFamily: "ui-monospace, monospace" }}>{r.winRatePct.toFixed(1)}%</td>
                <td><PctBar pct={r.winRatePct} color="#1f7a3a" /></td>
                <td style={{ textAlign: "right", fontFamily: "ui-monospace, monospace" }}>{r.avgWinGuesses.toFixed(2)}</td>
                <td style={{ textAlign: "right", fontFamily: "ui-monospace, monospace" }}>{r.withHintPct.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
