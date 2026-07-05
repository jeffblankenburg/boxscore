# Repository guide for AI collaborators

You're working in `boxscore` — a daily MLB email newsletter and web archive. Current focus for AI collaboration is the **predictions engine** (`/mlb/predictions`, `/mlb/fantasy`). Everything else in the repo (digest generator, email crons, admin dashboard) is out of scope unless a task explicitly says otherwise.

Design work for the next predictions iteration is captured in `docs/predictions-v7/design.md`. Frozen data fixtures for offline fitting + backtests live in `docs/predictions-v7/fixtures/`. Sanity anchors and fixture catalog: `docs/predictions-v7/README.md`.

## Predictions engine — the files that matter

- `lib/sports/mlb/predictions.ts` — v6 engine. Pythagorean expectation → log5 matchup → home-field bump; NRFI computed from a separate baseline + team/pitcher deltas. Read the top-of-file comments — they document the shrinkage story (`WIN_SHRINKAGE = 0.20`, `NRFI_SHRINKAGE = 0.30`) that's the main motivation for v7.
- `lib/sports/mlb/season-aggregates.ts` — input aggregations for the model. Team run rates, bullpen ERA/K9/BB9, pitcher first-inning stats. All derived from cached `daily_raw` payloads (statsapi.mlb.com). No new tables, no crons — all in-memory scans.
- `lib/sports/mlb/park-factors.ts` — static park factors used for run-scoring normalization.
- `lib/sports/mlb/predictions-data.ts` — orchestrator that calls the engine for a slate.
- `lib/sports/mlb/predictions-history.ts` — read side for the Season Picks table on `/mlb/predictions`; wraps `prediction_results` + `daily_odds_first`.
- `lib/sports/mlb/clv.ts` — Closing Line Value math (American → implied → devigged → pp).
- `scripts/backtest-model.ts` — pick-rule / play-rule backtester over `prediction_results` + odds.
- `scripts/compare-model-versions.ts` — pairwise A/B comparisons across `model_version` values.
- `scripts/fit-calibration.ts` — where `WIN_SHRINKAGE` / `NRFI_SHRINKAGE` came from. Refit target for v7 empirical-Bayes.

## Data plane

- `daily_predictions` — one snapshot per (sport, date, game_pk). Model output + provenance JSON.
- `prediction_results` — one row per (sport, date, game_pk, model_version) after outcomes score. Now includes `linescore` (JSONB, r/h/e + inning-by-inning), 8 open/close odds columns for CLV, and `win_correct` / `nrfi_correct` / `win_brier` / `nrfi_brier`. Written by `/api/cron/predictions-comparator` at 09:30 UTC.
- `daily_odds` — append-only since migration `0071`. New capture every 30 min by `/api/cron/predictions-odds-poll` from 11 AM ET to 11:30 PM ET. Readers should use the `daily_odds_first` view for opening-price semantics; the comparator derives closing per game as "last capture before scheduled first pitch."
- `daily_raw` — one row per (sport, date). Full statsapi payload for that day — schedule with linescore + per-game boxscores. Big rows (~1MB); paginate access.
- `historical_boxscores` + `historical_games` — everything before 2026 season. Joined on `game_pk`; use `historical_games.game_date` and `season` for filtering.

## House conventions

- **Pure functions.** The engine and math helpers accept plain data, return plain data. No I/O inside `lib/sports/mlb/predictions.ts` or `clv.ts`. Do I/O in `predictions-data.ts` (server-side) or in scripts.
- **Comments explain WHY, not WHAT.** Assume the reader can read the code. Every non-obvious constant, threshold, or shrinkage value has a comment naming the fitting script and dataset that produced it. See `predictions.ts:113-133` for the pattern.
- **`npm run typecheck` must pass before commit.** `next build` should stay clean too — it catches route-type mismatches `tsc` doesn't.
- **Migrations.** Sequential numbered files in `supabase/migrations/`. Each includes a top-of-file comment explaining motivation. Include `notify pgrst, 'reload schema';` at the bottom so PostgREST picks up new columns/tables.
- **`model_version` is a contract.** Any code change that alters model output requires a `PREDICTIONS_MODEL_VERSION` bump. Historical `prediction_results` stays attributable to the version that produced it. See the constant near the top of `predictions-data.ts`.
- **Scripts.** `npx tsx --env-file=.env.local scripts/foo.ts [args]`. Scripts should be idempotent and print a summary at the end.
- **No BC hacks.** If code is unused, delete it. Don't leave `// removed …` comments, unused `_var` renames, or backwards-compat shims. Same rule for admin surfaces that no longer serve a purpose.
- **Never `git push` without an explicit yes.** House rule. `git commit` is fine locally.

## Ground rules for prediction changes

- Data-only. No editorial framing, no narrative outputs. The public UI shows structured numbers.
- Public UI never shows scraped per-game odds. Aggregated metrics (ROI %, hit %, CLV %) are the public surface. Odds are internal-only.
- Every new fitted constant needs a fitting script committed with it (see `scripts/fit-calibration.ts` as the reference).
- Prefer authoritative sources over heuristics. If the SDIO or statsapi feed exposes something, don't compute it from PBP.
- Every prediction shipped to production must be attributable to a specific `model_version`, and the `daily_predictions.inputs` JSONB must contain enough provenance to reconstruct the pick offline.

## Sanity anchors for a run-model fit

The v7 design proposes moving from three disconnected formulas to one latent expected-runs-per-half-inning model. If your fit doesn't reproduce these, something is wrong before you look at ML/NRFI/OU output:

- League scoreless half-inning rate: **~72–73%** (2020-2025 average).
- Measured 2026 NRFI rate through 2026-07-04: **0.49** over 1,279 graded games (source: `prediction_results` where `actual_nrfi` is not null).
- League λ (mean runs per half-inning): **~0.50** (2020-2025 average).
- Home team ML win rate over the 2026 season through 2026-07-04: `select avg((actual_winner='home')::int) from prediction_results where sport='mlb' and status like '%Final%'`.

## Working with humans on this repo

Jeff (the maintainer) prefers direct tradeoff analysis over promotional framing. He wants commercial-grade predictions accuracy — help build toward that. Don't hedge with "we won't beat the sharps." When making a claim about a model change, back it with a number, not vibes.
