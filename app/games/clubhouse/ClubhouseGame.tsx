"use client";

import { useEffect, useMemo, useState } from "react";
import type { ClubhousePuzzle } from "@/lib/games/clubhouse/generate";
import { TeamStatCards } from "./StatCards";
import { computeStreaks, type DayResult, type ClubhouseStats } from "@/lib/games/clubhouse/stats";
import { persistClubhouseAttempt, syncClubhouseStreak } from "./actions";

const MAX_MISTAKES = 4;

type Saved = {
  solvedTeams: string[]; // team labels, in solve order
  mistakes: number;
  guesses: number[][]; // each guess = the 4 selected tiles' true group index
  guessedKeys: string[]; // sorted-id keys of every set of 4 already submitted
  status: "playing" | "won" | "lost";
};

export function ClubhouseGame({ puzzle, isAdmin = false }: { puzzle: ClubhousePuzzle; isAdmin?: boolean }) {
  const storeKey = `clubhouse:${puzzle.date}`;

  // playerId -> its true solution group index (0-3)
  const groupOf = useMemo(() => {
    const m = new Map<number, number>();
    puzzle.groups.forEach((g, i) => g.playerIds.forEach((id) => m.set(id, i)));
    return m;
  }, [puzzle]);
  const nameOf = useMemo(() => new Map(puzzle.tiles.map((t) => [t.id, t.name])), [puzzle]);

  const [selected, setSelected] = useState<number[]>([]);
  const [order, setOrder] = useState<number[]>(puzzle.tiles.map((t) => t.id));
  const [solvedTeams, setSolvedTeams] = useState<string[]>([]);
  const [mistakes, setMistakes] = useState(0);
  const [guesses, setGuesses] = useState<number[][]>([]);
  const [guessedKeys, setGuessedKeys] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<Saved["status"]>("playing");
  const [flash, setFlash] = useState<string>("");
  const [shakeIds, setShakeIds] = useState<number[]>([]);
  // `hydrated` gates the board until we've read localStorage, so a completed
  // puzzle never flashes the empty playing board before showing results.
  const [hydrated, setHydrated] = useState(false);
  const [stats, setStats] = useState<ClubhouseStats | null>(null);
  // Which result band is expanded (accordion) — only one at a time, so the
  // finished screen never gets absurdly tall.
  const [openTeam, setOpenTeam] = useState<string | null>(null);
  const toggleTeam = (t: string) => setOpenTeam((prev) => (prev === t ? null : t));

  // Restore prior play for today.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storeKey);
      if (raw) {
        const s: Saved = JSON.parse(raw);
        let restored = s.solvedTeams ?? [];
        // A finished game always reveals all four bands — heal any partial save
        // (e.g. rows written before the loss-persistence fix).
        if (s.status === "won" || s.status === "lost") {
          const missing = puzzle.groups.map((g) => g.team).filter((t) => !restored.includes(t));
          restored = [...restored, ...missing];
        }
        setSolvedTeams(restored);
        setMistakes(s.mistakes ?? 0);
        setGuesses(s.guesses ?? []);
        setGuessedKeys(new Set(s.guessedKeys ?? []));
        setStatus(s.status ?? "playing");
      }
    } catch { /* ignore */ }
    setHydrated(true);
  }, [storeKey]);

  // Recompute streak/stats from all stored daily results on this device.
  // Reruns when status flips (win/loss) so the streak updates immediately.
  useEffect(() => {
    if (!hydrated) return;
    const local: Array<{ date: string; solved: boolean; mistakes: number }> = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith("clubhouse:")) continue;
        const parsed = JSON.parse(localStorage.getItem(k) || "{}");
        if (parsed.status === "won" || parsed.status === "lost") {
          local.push({ date: k.slice("clubhouse:".length), solved: parsed.status === "won", mistakes: parsed.mistakes ?? 0 });
        }
      }
    } catch { /* ignore */ }
    const localResults: DayResult[] = local.map((d) => ({ date: d.date, solved: d.solved }));
    setStats(computeStreaks(localResults, puzzle.date)); // immediate, device-local

    // Logged-in players: merge in the cross-device history from the server.
    syncClubhouseStreak(local).then((server) => {
      if (!server) return; // anonymous — keep the local-only streak
      const merged = new Map<string, boolean>();
      for (const d of localResults) merged.set(d.date, d.solved);
      for (const d of server) merged.set(d.date, d.solved);
      setStats(computeStreaks([...merged].map(([date, solved]) => ({ date, solved })), puzzle.date));
    }).catch(() => { /* ignore */ });
  }, [hydrated, status, puzzle.date]);

  const persist = (next: Partial<Saved>) => {
    const cur: Saved = { solvedTeams, mistakes, guesses, guessedKeys: [...guessedKeys], status, ...next };
    try { localStorage.setItem(storeKey, JSON.stringify(cur)); } catch { /* ignore */ }
  };

  const solvedIds = useMemo(() => {
    const ids = new Set<number>();
    for (const team of solvedTeams) {
      const g = puzzle.groups.find((x) => x.team === team);
      g?.playerIds.forEach((id) => ids.add(id));
    }
    return ids;
  }, [solvedTeams, puzzle]);

  const remaining = order.filter((id) => !solvedIds.has(id));
  const done = status !== "playing";

  const toggle = (id: number) => {
    if (done) return;
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= 4 ? prev : [...prev, id],
    );
  };

  const submit = () => {
    if (selected.length !== 4 || done) return;
    // Block re-submitting an identical set of 4 — don't burn a mistake on it.
    const key = [...selected].sort((a, b) => a - b).join(",");
    if (guessedKeys.has(key)) {
      setFlash("Already guessed");
      setTimeout(() => setFlash(""), 1400);
      return;
    }
    const nextGuessed = new Set(guessedKeys).add(key);
    setGuessedKeys(nextGuessed);
    const groupIdxs = selected.map((id) => groupOf.get(id)!);
    const guess = [...groupIdxs];
    const nextGuesses = [...guesses, guess];
    setGuesses(nextGuesses);

    const counts = groupIdxs.reduce<Record<number, number>>((a, g) => ((a[g] = (a[g] ?? 0) + 1), a), {});
    const max = Math.max(...Object.values(counts));

    if (max === 4) {
      const team = puzzle.groups[groupIdxs[0]!]!.team;
      const nextSolved = [...solvedTeams, team];
      setSolvedTeams(nextSolved);
      setSelected([]);
      const won = nextSolved.length === 4;
      const nextStatus = won ? "won" : "playing";
      setStatus(nextStatus);
      setFlash(won ? "" : team);
      setTimeout(() => setFlash(""), 1400);
      persist({ solvedTeams: nextSolved, guesses: nextGuesses, guessedKeys: [...nextGuessed], status: nextStatus });
      void persistClubhouseAttempt({ puzzleDate: puzzle.date, guesses: nextGuesses, mistakes, solved: won ? true : null });
    } else {
      const nextMistakes = mistakes + 1;
      setMistakes(nextMistakes);
      setShakeIds(selected);
      setTimeout(() => setShakeIds([]), 500);
      setFlash(max === 3 ? "One away…" : "Not a team");
      setTimeout(() => setFlash(""), 1400);
      if (nextMistakes >= MAX_MISTAKES) {
        // Reveal every remaining team, in group order. Persist the FULL revealed
        // list (not the stale `solvedTeams`) so a reload restores all four bands.
        const rest = puzzle.groups.map((g) => g.team).filter((t) => !solvedTeams.includes(t));
        const revealed = [...solvedTeams, ...rest];
        setSolvedTeams(revealed);
        setSelected([]);
        setStatus("lost");
        persist({ mistakes: nextMistakes, guesses: nextGuesses, guessedKeys: [...nextGuessed], status: "lost", solvedTeams: revealed });
      } else {
        setStatus("playing");
        persist({ mistakes: nextMistakes, guesses: nextGuesses, guessedKeys: [...nextGuessed], status: "playing", solvedTeams });
      }
      void persistClubhouseAttempt({ puzzleDate: puzzle.date, guesses: nextGuesses, mistakes: nextMistakes, solved: nextMistakes >= MAX_MISTAKES ? false : null });
    }
  };

  const shuffleRemaining = () => setOrder((o) => shuffle(o));

  const reset = () => {
    if (typeof window !== "undefined" && !window.confirm("Reset today's puzzle? This clears your progress.")) return;
    try { localStorage.removeItem(storeKey); } catch { /* ignore */ }
    setSelected([]);
    setOrder(puzzle.tiles.map((t) => t.id));
    setSolvedTeams([]);
    setMistakes(0);
    setGuesses([]);
    setGuessedKeys(new Set());
    setStatus("playing");
    setFlash("");
    setShakeIds([]);
  };

  return (
    <div className="tm">
      <header className="tm-head">
        <h1>Clubhouse</h1>
        <p className="tm-sub">Group the 16 players into 4 teams they played for.</p>
        <p className="tm-meta">{prettyDate(puzzle.date)}{stats && stats.current > 0 ? ` · 🔥 ${stats.current} day streak` : ""}</p>
      </header>

      {!hydrated ? (
        <div className="tm-loading" aria-hidden="true" />
      ) : (
        <>
          {/* Solved bands — during play in solve order; once finished, reordered
              to the puzzle's group order and turned into tappable accordions that
              reveal each team's player stat cards. */}
          <div className="tm-solved">
            {(done ? puzzle.groups.map((g) => g.team).filter((t) => solvedTeams.includes(t)) : solvedTeams).map((team) => {
              const g = puzzle.groups.find((x) => x.team === team)!;
              const gi = puzzle.groups.indexOf(g);
              const open = openTeam === team;
              return (
                <div key={team} className="tm-band-wrap">
                  <div
                    className={`tm-band grp-${gi}${done ? " tm-band-acc" : ""}${open ? " open" : ""}`}
                    onClick={done ? () => toggleTeam(team) : undefined}
                    role={done ? "button" : undefined}
                    tabIndex={done ? 0 : undefined}
                    onKeyDown={done ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleTeam(team); } } : undefined}
                  >
                    <div className="tm-band-team">{team}</div>
                    <div className="tm-band-players">{g.playerIds.map((id) => nameOf.get(id)).join(", ")}</div>
                    {done && <span className={`tm-band-caret${open ? " open" : ""}`}>›</span>}
                  </div>
                  {done && open && <TeamStatCards puzzle={puzzle} team={team} />}
                </div>
              );
            })}
          </div>

          {/* Remaining grid */}
          {!done && (
            <div className="tm-grid">
              {remaining.map((id) => {
                const on = selected.includes(id);
                const shaking = shakeIds.includes(id);
                return (
                  <button
                    key={id}
                    className={`tm-tile${on ? " on" : ""}${shaking ? " shake" : ""}`}
                    onClick={() => toggle(id)}
                    aria-pressed={on}
                  >
                    {nameOf.get(id)}
                  </button>
                );
              })}
            </div>
          )}

          {/* Fixed-height slot so the flash message never shifts the layout. */}
          {!done && <div className="tm-flash-slot">{flash && <div className="tm-flash">{flash}</div>}</div>}

          {/* Controls */}
          {!done && (
            <>
              <div className="tm-mistakes">
                Mistakes remaining:{" "}
                {Array.from({ length: MAX_MISTAKES }).map((_, i) => (
                  <span key={i} className={`tm-dot${i < mistakes ? " used" : ""}`} />
                ))}
              </div>
              <div className="tm-controls">
                <button className="tm-btn" onClick={shuffleRemaining}>Shuffle</button>
                <button className="tm-btn" onClick={() => setSelected([])} disabled={!selected.length}>Deselect</button>
                <button className="tm-btn tm-submit" onClick={submit} disabled={selected.length !== 4}>Submit</button>
              </div>
            </>
          )}

          {/* End screen */}
          {done && (
            <div className="tm-end">
              <p className="tm-end-title">{status === "won" ? "Solved it! 🎉" : "Out of guesses"}</p>

              {stats && (
                <div className="tm-stats">
                  <div className="tm-stat"><span className="tm-stat-n">{stats.current}</span><span className="tm-stat-l">Streak</span></div>
                  <div className="tm-stat"><span className="tm-stat-n">{stats.max}</span><span className="tm-stat-l">Max</span></div>
                  <div className="tm-stat"><span className="tm-stat-n">{stats.played}</span><span className="tm-stat-l">Played</span></div>
                  <div className="tm-stat"><span className="tm-stat-n">{stats.winPct}%</span><span className="tm-stat-l">Win</span></div>
                </div>
              )}

              <div className="tm-controls">
                <button className="tm-btn tm-submit" onClick={() => copyShare(puzzle, guesses, status)}>
                  Copy result
                </button>
              </div>
            </div>
          )}

          {isAdmin && <button className="tm-reset" onClick={reset}>Reset puzzle</button>}
        </>
      )}
    </div>
  );
}

function shuffle<T>(a: T[]): T[] { const r = [...a]; for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const tmp = r[i]!; r[i] = r[j]!; r[j] = tmp; } return r; }

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
// Format a YYYY-MM-DD puzzle date as "August 20, 2026" without timezone drift.
function prettyDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${d}, ${y}`;
}

const SQUARES = ["🟩", "🟨", "🟦", "🟪"];
function copyShare(puzzle: ClubhousePuzzle, guesses: number[][], status: string) {
  const header = `Clubhouse ${puzzle.date} (${puzzle.difficulty})`;
  const grid = guesses.map((g) => g.map((gi) => SQUARES[gi % 4]).join("")).join("\n");
  const result = status === "won" ? "" : "\nX/4";
  const text = `${header}${result}\n${grid}\nboxscore.email/games/clubhouse`;
  navigator.clipboard?.writeText(text).catch(() => {});
}
