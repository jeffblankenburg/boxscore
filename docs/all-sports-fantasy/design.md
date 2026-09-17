# All-Sports Fantasy League — Design & Scoring Spec

Canonical design doc for the all-sports fantasy game. Tracking issue: **[#138](https://github.com/jeffblankenburg/boxscore/issues/138)**.

Managers draft **entire teams / individual competitors** (not position players) across every major sport, and score all season on **wins, weighted by the pre-game betting line, with playoffs and majors worth more.** A single normalized scoring system makes a great season in *any* league worth about the same, so no sport is a better pick than another.

---

## Roster — 15 slots

One team/competitor from **each of 12 required leagues**, plus **3 flex** (any league):

`MLB · NFL · NBA · NHL · MLS · NASCAR · PGA Tour · Men's Tennis · Women's Tennis · EPL · NCAA Football · NCAA Basketball`

> F1 was evaluated and **dropped** — only 11 constructors, so the pool is exhausted after the mandatory slot. NASCAR (~36 full-time drivers) replaces it and brings a real playoff plus clear "majors."

---

## The four scoring principles (fixed constraints)

1. **Different leagues have different win values.** Fewer games → each win worth more. (An NFL win ≈ 7 MLB wins.) The only intuitive weighting.
2. **An underdog win is worth more than a favorite win** — scaled to **that game's line, never the team's identity.** Eagles at +180 = Browns at +180. The scoring reads the line, not the reputation.
3. **A "best season" scores ≈ 1,000** — meaning **averaged over ~50 seasons, the top-scoring entity in each league averages ~1,000.** A benchmark, not a cap: historic outliers exceed it, weak champions dip below.
4. **All 12 leagues feel equally suitable for a flex pick.**

---

## Scoring mechanics

### Team sports (MLB, NFL, NBA, NHL, MLS, NCAA FB, NCAA BB, EPL)

`points per game = (league base per win) × (underdog multiplier)`, accumulated all season; playoffs escalate to the title.

**Per-league base value per win** — data-calibrated (see `backtest/`) so a championship season ≈ 1,000. **First-pass values anchored on one recent season; must be re-anchored to ~50-season averages before launch.**

| League | Base / win | Title run adds | Notes |
|---|---|---|---|
| NCAA Football | ~58 | +420 | 12-team CFP |
| NFL | ~54 | +450 | |
| EPL | ~38 | — | no playoff; table = title (winning ≈ 1,000) |
| MLS | ~27 | +420 | draw = ⅓ win |
| NCAA Basketball | ~24 | +360 | March Madness (Cinderella-friendly) |
| NHL | ~13 | +350 | OT/SO loss = ⅓ win |
| NBA | ~12 | +300 | |
| MLB | ~7 | +345 | |

**Underdog multiplier** (medium curve — see backtest for why not steeper):

| Line | −250 or worse | −150 to −250 | −110 to −150 | ~even | +110 to +250 | +250 or longer |
|---|---|---|---|---|---|---|
| Multiplier | 0.85× | 0.92× | 1.0× | 1.1× | 1.25× | **1.5×** |

- **Draws** (soccer) and **NHL OT/SO losses** = ⅓ of a win.
- Raw win total is **not** the scoreboard — adjusted wins are. A 90-win underdog team can out-score a 100-win favorite (confirmed: 2024 D-backs 89W > Dodgers 97W).

### Playoffs & the championship multiplier

Playoff wins are worth an escalating bonus each round, and **the title-clinching round carries a premium (~3–4× a regular win) — the "championship multiplier."** It is sized so that:

- **A champion almost always tops the leaderboard.** A beaten finalist misses the biggest single bonus, so the champion clears them by a clear margin (~150+ points).
- **But a truly historic regular season can, rarely, out-score a weak/underdog champion.** That's intentional and should be uncommon.

Illustrative per-round bonuses (final round largest; finalized during re-anchoring):

| League | Rounds (win each) → **title** | Title run |
|---|---|---|
| NFL | WC 55 · Div 95 · Conf 120 · **SB 180** | +450 |
| MLB | WC 40 · LDS 75 · LCS 100 · **WS 130** | +345 |
| NBA | R1 40 · R2 65 · ConfF 85 · **Finals 110** | +300 |
| NHL | R1 50 · R2 80 · ConfF 100 · **Cup 120** | +350 |
| MLS | R1 70 · R2 110 · ConfF 110 · **Cup 130** | +420 |
| NCAA FB | R1 70 · QF 100 · SF 120 · **Title 130** | +420 |
| NCAA BB | R64 25 · R32 40 · S16 55 · E8 70 · F4 80 · **Title 90** | +360 |
| EPL | — (no playoff; the league title is the crown) | — |

The underdog multiplier still applies in the playoffs (a playoff upset is a jackpot).

### Individual sports (PGA Tour, Tennis, NASCAR)

Per direction: **finish-based, reward a top-10 every event, majors count ~3×, and de-emphasize the season-ending "playoff"** (FedEx Cup / Tour Finals / NASCAR playoffs). The week-to-week is the product. No odds multiplier — winning a 100+ competitor field is already an upset.

| Finish | Golf (reg / **major**) | Tennis (1000-title / **Slam**) | NASCAR (reg / **crown-jewel**) |
|---|---|---|---|
| Win / Title | 100 / **280** | 100 / **280** | 55 / **160** |
| 2nd / Final | 60 / 165 | 60 / 170 | 38 / 100 |
| 3rd / Semi | 45 / 125 | 35 / 100 | 28 / 70 |
| T4–5 / QF | 32 / 90 | 18 / 55 | 20 / 55 |
| T6–10 / R16 | 18 / 50 | — / 25 | 11 / 30 |

- **Golf majors:** Masters, PGA Championship, U.S. Open, The Open.
- **Tennis:** Grand Slams ~3×; year-end Finals = a normal big event, not a playoff.
- **NASCAR crown jewels:** Daytona 500, Coca-Cola 600, Southern 500, Brickyard 400.

**Validation targets (all ≈ 1,000):** Scheffler 2024 (1 major + 6 wins) ≈ 1,060 · Alcaraz/Sinner 2025 (2 Slams + Masters) ≈ 1,020 · Dodgers 2024 (98 wins + WS) ≈ 1,000 · Man City EPL title ≈ 1,000.

---

## Draft modes (commissioner's choice — both required)

- **Snake draft** — pick in turns. Optional **"max 2 teams per league"** roster rule as a flex-diversity backstop.
- **Auction draft** — equal budgets, bid on teams.

### The flex/compression problem and its resolution

Baseball's 162-game season bunches teams tightly (median MLB team = **87%** of the league's best in points, vs. **62%** for soccer), so the best *available* baseball team is the "safe, high-floor" flex pick.

**This is provably unfixable at the scoring layer:** "a win is a win" (constant per-win) + "champion ≈ 1,000" (fixed ceiling) mathematically preserve each league's distribution shape. Decompressing needs either a floor offset (teams sit deeply negative for months — broken live UX) or a nonlinear per-win value (breaks "a win is a win").

So it's solved at the **draft layer**. An **auction** makes safety self-correcting — managers bid up safe teams until they're no longer a bargain; every team has a price at which it's worth it; the flex becomes "best value for my remaining budget" (different per manager). Scoring is untouched — the compression becomes a *pricing signal*, not a distortion.

---

## Data & build requirements

### Data source

- **ESPN API** — proven for team-sport results + **historical pre-game moneylines**:
  - Results: `site.api.espn.com/apis/site/v2/sports/{sport}/{league}/scoreboard?dates=…`
  - Odds: `sports.core.api.espn.com/v2/sports/{sport}/leagues/{league}/events/{eid}/competitions/{eid}/odds` — per-book moneylines (DraftKings, Caesars) on completed games, back multiple seasons.
  - **Gotcha:** `site.api` returns **403 to a `Mozilla/5.0` User-Agent** but 200 to curl's default UA. Do **not** send a browser UA.
  - Devig two-way moneyline → implied win prob → multiplier bucket.
- **Individual sports** need finish data + event-tier tagging (majors/crown-jewels) for golf, tennis (ATP + WTA), NASCAR. Sourcing TBD.
- Persist daily per house convention (every sport, every day).

### Storage (new tables, sketch)

- `leagues` / `entities` — draftable teams & competitors per sport, with schedules.
- `game_scores` — per-game scoring events (entity, date, W/D/L, line, multiplier, points) — the audit trail.
- `fantasy_leagues` — commissioner config (draft mode, roster rules, scoring version).
- `fantasy_rosters` / `draft_picks` — rosters and draft/auction results.
- `entity_season_totals` — running standings.
- A **`scoring_version`** contract (like the predictions engine's `model_version`) so historical scores stay attributable.

### Calibration

- A fitting script that re-anchors each league's base value to its **~50-season average top score**.
- Individual-sport point tables are structural estimates — validate against multi-season finish data.

---

## Open items

1. **Re-anchor all 12 leagues** to ~50-season average top scores (current values are single-season first-passes).
2. **Odds-backtest the individual sports** (or confirm the structural finish tables).
3. **Finalize per-round playoff bonuses** (the tables above are illustrative but carry the championship-multiplier intent).
4. **Auction spec** — budget size, nomination order, interaction with 12-required + 3-flex.
5. **Scope/placement** — large new surface, outside the current predictions/newsletter focus; confirm home and build priority.

## Resolved decisions

- **Underdog curve = medium (0.85→1.5)**, chosen from the NFL backtest (a steeper 0.7→1.8 curve scrambled quality too hard — buried the champion at 16th in regular-season scoring).
- **"Best season" ≈ champion.** A dominant non-champion *can* rarely out-score an underdog champion, but the **championship multiplier** (large title-clinching bonus) makes it hard — champions almost always top the board.
- **Draft:** offer both snake and auction; auction is the elegant fix for flex compression.
- **NASCAR replaces F1.**
