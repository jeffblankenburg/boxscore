# Predictions v7 — collaborator workspace

Design proposal: [design.md](./design.md). Frozen data fixtures for offline fitting + backtests: [fixtures/](./fixtures/).

The maintainer's expectation is that v7 work happens against these fixtures, not live Supabase, until the model is ready to run in production. Everything committed here is a deterministic snapshot — rerun `scripts/export-predictions-v7-fixtures.ts` to refresh.

## Fixture catalog

All CSVs have a header row.

| File | Rows | Purpose |
| --- | --- | --- |
| `linescores_2024.csv` | 52,169 | Half-inning run counts for the 2024 MLB regular + postseason. Primary fitting set for the negative-binomial dispersion parameter. |
| `linescores_2025.csv` | 52,333 | Same shape for 2025. Combine with 2024 for a two-season fit. |
| `linescores_2026.csv` | 23,949 | Current-season half-innings through 2026-07-04. In-progress; refresh the export as the season continues. |
| `daily_predictions.csv` | 1,330 | Model output at snapshot time — one row per (sport, date, game_pk). Includes `inputs_json` (the exact aggregates + probable SP used for the prediction — enough provenance to reconstruct the pick offline). |
| `prediction_results.csv` | 4,565 | Graded outcomes after games finalize. Multiple rows per game_pk when the model_version changed. Includes 8 open/close odds columns for CLV analysis. |
| `daily_odds_first.csv` | 1,323 | Opening prices per (date, game_pk, book). DraftKings ML lines from ESPN's core API; FanDuel NRFI/YRFI from FanDuel's public JSON. |

### Linescore schema

```
game_pk,date,inning,half,runs
745820,2024-03-28,1,T,0        # 2024 season opener: SD @ LAD, top of 1st, 0 runs
745820,2024-03-28,1,B,1        # LAD scored 1 in the bottom of 1st
```

`half` is `T` (away) or `B` (home). Innings 1-9 only for regulation; extra innings if present. Suspended / postponed games are excluded from 2026 (they'd emit truncated linescores that skew the NB fit); historical seasons include only games that reached final status per the MLB API.

## Sanity anchors

If your NB dispersion + λ fit doesn't reproduce these against the fixture data, something is wrong before you look at market comparison:

| Metric | Fixture value | Fable's initial anchor |
| --- | --- | --- |
| Scoreless half-inning rate, 2024 | 72.61% | 72–73% |
| Scoreless half-inning rate, 2025 | 72.32% | 72–73% |
| Scoreless half-inning rate, 2026 (thru 07-04) | 72.60% | 72–73% |
| Mean λ (runs/half-inning), 2024 | 0.5038 | ~0.50 |
| Mean λ (runs/half-inning), 2025 | 0.5126 | ~0.50 |
| Mean λ (runs/half-inning), 2026 (thru 07-04) | 0.5060 | ~0.50 |
| 2026 NRFI hit rate (all model_versions) | 48.51% over 4,529 graded 1st-inning outcomes | 0.49 |

Note on Poisson vs. Negative Binomial: Poisson at λ=0.5 predicts a scoreless half-inning rate of `exp(-0.5) = 60.65%`. Observed is ~72.6%. That ~12pp gap is the reason the design doc argues for negative binomial with a fitted dispersion parameter — Poisson underweights scoreless halves because scoring clusters within halves (leadoff single → walk → double). The dispersion `r` is what the fit should recover.

## Working style

- Run `npm run typecheck` before every commit. `next build` should also stay clean.
- Bump `PREDICTIONS_MODEL_VERSION` when the pipeline output changes. Historical `prediction_results` rows stay attributable to the version that produced them; A/B comparison and calibration depend on that.
- Every fitted constant needs a fitting script committed with it — see `scripts/fit-calibration.ts` for the reference pattern. Include a comment in the model file naming the script + dataset that produced each constant.
- No editorial content or narrative framing. The output surface is structured numbers only.
- Odds data is internal — the public UI (Season Picks, ROI cards) surfaces aggregate metrics, never per-game lines.
- Never `git push` without an explicit yes from the maintainer.

## Regenerating the fixtures

```
npx tsx --env-file=.env.local scripts/export-predictions-v7-fixtures.ts
```

Rewrites every file in `fixtures/`. Takes ~2 minutes against production Supabase (limited by daily_raw payload size). Requires `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in `.env.local`.

## What's not here yet

- **Season aggregates snapshot.** The `inputs_json` column in `daily_predictions.csv` embeds the exact team/pitcher aggregates the model used at prediction time, so full backtest reconstruction is possible per date. But a normalized "team X's runs/game as of date Y" export would be nicer. Add if the current fixture proves inconvenient.
- **Park factors as a fixture.** They're static constants — see `lib/sports/mlb/park-factors.ts`. If v7 wants to re-fit them, add an export for `historical_boxscores` grouped by venue.
- **Closing odds.** `daily_odds` (append-only since migration 0071) has closing-price history via 30-min polling since 2026-07-05. Once ~30 days of closing data have accumulated, add a `daily_odds_closing.csv` export that resolves the "latest capture before scheduled first pitch" per (game, book).
