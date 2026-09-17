# All-Sports Fantasy League — research archive

Design/scoring work for a new section of the app: draft **whole teams / individual competitors** across 12 leagues + 3 flex, score all season on **line-weighted wins** with a **normalized ~1,000 "great season" anchor** across every sport.

- **Canonical spec:** [`design.md`](./design.md)
- **Tracking issue:** [#138](https://github.com/jeffblankenburg/boxscore/issues/138)
- **This file:** the research and backtest that produced the numbers, so we never re-run it from scratch.

## Prior art

- **OmniLeague** — draft real teams across ~11 sports; scores off live prediction-market implied probabilities (a "predict the market" game).
- **Wins League Fantasy** — 4 majors only; flat cumulative wins; no normalization, no odds.
- **Brendan Hunt's private league** (the *Ted Lasso* origin) — ~10 sports, keeper, one team per sport, a "balance bonus" for breadth; scoring kept vague.

None normalize across sports or weight by the betting line — that's our niche.

## Key backtest findings

Real, line-by-line backtests via the ESPN API — **8 leagues, ~7,000+ games, <2% missing lines** (2023/2024 seasons):

- **Champions land ≈ 1,000** with the calibrated base values in `design.md`.
- **Medium underdog curve (0.85→1.5) chosen from data.** A steeper 0.7→1.8 curve scrambled team quality too hard — it buried the eventual NFL champion at **16th** in regular-season scoring (correlation to wins 0.83). Medium holds correlation at **0.96** while still paying a big-underdog win ~1.75× a favorite win.
- **Spread compression is real and measured.** Median team as a % of the league's best (in points): MLB **87%**, NBA 82%, NHL 80%, NFL 72%, EPL 66%, MLS 62%. Baseball is the tightest → the "safe flex," which is why the fix lives in the draft layer (auction), not scoring.
- **Adjusted wins ≠ raw wins.** 2024 example: the 89-win, underdog-heavy Diamondbacks (96.3 adj) out-scored the 97-win, favorite-heavy Dodgers (95.0 adj).

Per-league calibrated base values, playoff/championship structure, and the full model live in [`design.md`](./design.md).

## Distribution research (5-year averages, for re-anchoring)

Gathered from Wikipedia/sports-reference season pages + published betting stats. Regular-season **win** totals unless noted. Use these to re-anchor base values to ~50-season averages (current values are single-season first-passes).

| League | Champion | Best record | Playoff cutoff | Median | Worst | Favorite wins SU |
|---|---|---|---|---|---|---|
| MLB (162g) | ~95 | ~103 | ~86 | ~82 | ~48 | ~58–60% |
| NBA (82g)\* | ~57 | ~61 | ~36 | ~42 | ~17 | ~68–70% |
| NHL (82g)\* | ~48 | ~55 | ~38 | ~39 | ~20 | ~59–62% |
| NFL (17g) | ~12.4 | ~13.8 | ~9.0 | ~8.7 | ~2.4 | ~66–67% |
| NCAA FB (~13g) | ~12.2 | ~12.8 | ~10.5 | ~6 | ~1.5 | ~74–75% |
| NCAA BB (~31g) | ~28\*\* | ~28–29 | ~20 | ~16 | ~5 | ~70–72% |
| EPL (38g) | 27.4 W / 88.6 pts | 27.4 | ~20 (4th) | ~15 | ~4.6 | ~55–60%\*\*\* |
| MLS (34g) | ~18 (Cup) / 21 (Shield) | ~21 | ~11 | ~12 | ~5.2 | ~55–60%\*\*\* |

\* 2020-21 was COVID-shortened (72g NBA, 56g NHL) and drags the averages down — treat as an outlier.
\*\* Entering the NCAA tournament (reg + conf tourney); pure regular-season is ~3–6 lower.
\*\*\* Soccer is 3-way: ~25% of matches are draws (~9 per team per season), so a "favorite" wins outright only ~55–60%.

**Individual sports** (structural, not odds-backtested):
- **Golf:** ~45 events/season; a dominant season is 6–7 wins (Scheffler 2024 = 7 incl. 1 major); the pre-tournament favorite wins only ~1 in 8–10 majors. 4 majors.
- **Tennis:** ~18–22 events played; a dominant season ≈ 8 titles + 2 Slams (Świątek '22, Sinner '24, Alcaraz '25). Men's Slams favorite-heavy; women's wide open (qualifier/unseeded winners occur).
- **NASCAR:** ~36 races; a champion wins ~5–8, top-10s most weeks. Crown jewels: Daytona 500, Coca-Cola 600, Southern 500, Brickyard 400.
- **F1 (evaluated, dropped):** 22–24 races; dominant constructor wins 14–21 (Red Bull 2023 = 21/22); favorite-dominated; race wins ≠ title twice in 5 yrs (2021 Mercedes, 2024 McLaren won on points depth). Only 11 constructors → pool too shallow for a draft.

## Backtest artifacts

`backtest/` — Python 3, stdlib + curl only. Run from inside `backtest/`.

| File | What it does |
|---|---|
| `core.py` | Reusable ESPN fetcher (parallel curl), moneyline devig, the medium multiplier curve, scoreboard parsers. |
| `season.py <mlb\|nba\|nhl\|epl\|mls>` | Full-season odds-weighted backtest for a team league → `results/<key>_res.json`. |
| `ncaaf.py` | NCAA FB (week-based, FBS). |
| `ncaab_champ.py` | NCAA BB champion + sample teams (full-league pull is too large). |
| `nfl_fulltest.py` | NFL 2023 full-season backtest (self-contained) → `results/nfl2023.json`. |
| `nfl_pergame.py` | Stores NFL 2023 per-game devigged probs → `results/nfl2023_games.json` (used to test curve strengths without re-fetching). |
| `calibrate.py` | Loads results, computes per-league base value + title-run bonus so the champion ≈ 1,000. |
| `results/*.json` | Frozen per-league adjusted-win-unit data (what each team scored). |

### Reproduce

```bash
cd docs/all-sports-fantasy/backtest
python3 season.py mlb        # or nba / nhl / epl / mls
python3 ncaaf.py
python3 calibrate.py         # prints the per-league base values
```

**ESPN gotcha:** `site.api.espn.com` returns **403 to a `Mozilla/5.0` User-Agent** but 200 to curl's default UA. `core.py` uses plain curl — do not add a browser UA. Historical moneylines come from the `sports.core.api.espn.com/.../odds` endpoint (DraftKings/Caesars), available multiple seasons back.
