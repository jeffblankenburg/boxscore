# SportsDataIO MLB feed — parity gap analysis

**Date:** 2026-06-05
**Author:** boxscore.email engineering
**Audience:** SportsDataIO (sales / product / support)
**Goal:** Migrate boxscore.email from `statsapi.mlb.com` (unlicensed) to the SportsDataIO MLB feed. This document enumerates every parity gap between what boxscore.email currently consumes and what is available on our **current production SDIO key**, so we can scope an upgrade or feature request and close them deterministically.

---

## TL;DR

- **What boxscore.email consumes today:** 10 distinct data needs from `statsapi.mlb.com`, all implemented in `lib/mlb.ts` (~30 exported functions).
- **What works on our current production SDIO key:** 4 of the 10 needs (Standings, Teams, league-wide PlayerSeasonStats, PlayerSeasonStatsByTeam).
- **Tier-gated on our key (401 "Unauthorized Endpoint"):** GamesByDate, Players bulk profile, PlayerGameStatsByDate, News, Players/{team}. These are required for everything beyond standings.
- **Not found (404) on our key:** Transactions/{date}, TransactionsBySeason/{season}, PlayersActive, PlayersByActive/{team}, DepthCharts. Either non-existent paths, mis-documented, or tier-gated returning 404 instead of 401.
- **Hard data-shape gap (not a tier issue):** Per-position fielding splits. `PlayerSeason` carries one Position field and basic counters (Errors, DoublePlays) but no per-position breakdown of Putouts, Assists, Chances, Innings, or FieldingPercentage.
- **Apparent low daily request quota:** Endpoints that returned `200 OK` in one probe run returned `401 "Unauthorized Endpoint"` minutes later in the next run. Suggests either a daily call cap or quota that returns 401 (not 429) when exhausted. Needs clarification.

---

## How boxscore.email uses MLB data

boxscore.email is a free daily MLB email digest (see https://boxscore.email). Each subscriber receives an email containing the full digest body — there is no clickthrough to a web app. The data is consumed in three rendering paths:

1. **League-wide daily digest** — Today's games, yesterday's box scores, standings (all 6 divisions + wildcard), leaders in each major stat category, transactions.
2. **Per-team daily digest** — All of the league digest, plus a team-focused view: active roster with season hitting + pitching stats, upcoming schedule for the week, recent results.
3. **Per-player page** — Player profile + season totals (hitting and/or pitching) + last 10 games + per-position fielding totals.

The full code surface is in [`lib/mlb.ts`](../lib/mlb.ts) (687 lines, 30 exports).

---

## Endpoint parity matrix

Each row: a `lib/mlb.ts` export, the SDIO endpoint that would replace it, the observed status on our production key, and the ask.

| # | `lib/mlb.ts` export | Current MLB endpoint | Target SDIO endpoint | Probe status | What we need |
|---|---|---|---|---|---|
| 1 | `getSchedule(date)` | `/v1/schedule?hydrate=linescore,team,decisions,probablePitcher` | `/scores/json/GamesByDate/{date}` | ✗ **401 tier-gated** | Access on production key |
| 2 | `getBoxscore(gamePk)` | `/v1/game/{pk}/boxscore` | `/stats/json/BoxScore/{gameid}` | ⚠️ blocked (depends on #1 to get GameID) | Access on production key |
| 3 | `getScoringPlays(gamePk)` | `/v1/game/{pk}/playByPlay` | `/pbp/json/PlayByPlay/{gameid}` | ⚠️ blocked (depends on #1 to get GameID) | Access on production key |
| 4 | `getStandings(season,date)` | `/v1/standings?leagueId=103,104` | `/scores/json/Standings/{season}` | ✓ **200 OK** (36 fields) | — strict superset |
| 5 | `getWildCardStandings` | `/v1/standings?...&standingsTypes=wildCard` | derive from Standings.WildCardRank/WildCardGamesBehind | ✓ **200 OK** | — covered by #4 |
| 6 | `getLeaders(category,...)` | `/v1/stats/leaders?...` (~20 calls/digest) | `/stats/json/PlayerSeasonStats/{season}` (one call, sort client-side) | ✓ **200 OK** (1179 players, 117 fields) | — one call replaces ~20 |
| 7 | `fetchTeamsRaw(season)` | `/v1/teams?sportId=1&season={s}` | `/scores/json/teams` | ✓ **200 OK** (30 teams) | — |
| 8 | `parseTransactions(date)` | `/v1/transactions?startDate={d}&endDate={d}` | `/stats/json/Transactions/{date}` | ? **404 not found** | Endpoint to exist + be accessible; alternatively confirm `News` is the intended replacement and unlock it |
| 9 | `parsePersonWL(personId)` | `/v1/people/{id}/stats?stats=season&group=pitching` | `/stats/json/PlayerSeasonStatsByPlayer/{season}/{playerid}` | ⚠️ untested (no sample PlayerID — depends on #1) | Access on production key |
| 10 | `getTeamRoster(teamId,season)` | `/v1/teams/{id}/roster?hydrate=person(stats(...))` | `/scores/json/Players/{teamkey}` + `/stats/json/PlayerSeasonStatsByTeam/{season}/{teamkey}` | ✗ Players/{team} **401**; PlayerSeasonStatsByTeam ✓ | Access to Players/{team} on production key |
| 11 | `getTeamScheduleRange(teamId,…)` | `/v1/schedule?teamId={id}&startDate={s}&endDate={e}` | Loop `/scores/json/GamesByDate/{date}` filtered by TeamID, or `/scores/json/Games/{season}` filtered client-side | ✗ blocked (depends on #1) | Access on production key; ideally a single `TeamGames` range endpoint |
| 12 | `parsePerson(personId)` | `/v1/people/{id}?hydrate=currentTeam` | `/scores/json/Player/{playerid}` OR `/scores/json/Players` (bulk) | ✗ **401 tier-gated** (both) | Access on production key |
| 13 | `parseSplitsBundle (gameLog)` | `/v1/people/{id}/stats?stats=season,seasonAdvanced,gameLog&group={g}` | `/stats/json/PlayerGameStatsBySeason/{season}/{playerid}/all` | ⚠️ untested (no sample PlayerID); `PlayerGameStatsByDate` returns **401 tier-gated** | Access on production key |
| 14 | `parseFielding (per-position)` | `/v1/people/{id}/stats?stats=season&group=fielding` (one split per position) | **(no equivalent)** | ✗ **data shape gap** | New endpoint or augmented `PlayerSeason` with per-position fielding splits — see [Field-level gaps](#field-level-gaps) |

**Score:** 4 endpoints accessible, 6 tier-gated, 4 not found, 1 data-shape gap (#14), plus an unresolved request-quota / 401-vs-429 issue.

---

## Field-level gaps

These are gaps where the endpoint exists or could exist, but the response shape doesn't carry data we need from MLB statsapi.

### 14a. Per-position fielding splits — **hard gap**

**What MLB statsapi returns** for `/v1/people/{id}/stats?stats=season&group=fielding`:

> An array of splits — one per position the player has appeared at this season — each carrying `games`, `gamesStarted`, `innings`, `chances`, `putOuts`, `assists`, `errors`, `doublePlays`, `triplePlays`, `fielding` (percentage).

Example (Aaron Judge in a season where he plays both RF and DH):
```
[
  { position: "RF", games: 95,  innings: "823.1", putOuts: 178, assists: 5, errors: 2, fielding: ".989" },
  { position: "DH", games: 27,  innings: "0.0",   putOuts: 0,   assists: 0, errors: 0, fielding: ".000" }
]
```

**What SDIO's PlayerSeason provides:** ONE row per player-season with a single `Position` field and basic counters (`Errors`, `DoublePlays`). No `Putouts`, no `Assists`, no `Chances`, no `FieldingPercentage`, no `Innings` at the position. No way to express "player X spent N innings at position Y."

**Ask:** Either (a) add per-position fielding splits as a new endpoint (`PlayerFieldingStatsBySeason/{season}/{playerid}` returning one row per position), OR (b) extend `PlayerSeason` to nest a `FieldingByPosition[]` array. The fields we'd need per split: Position, Games, GamesStarted, Innings, PutOuts, Assists, Errors, Chances, DoublePlays, TriplePlays, FieldingPercentage.

### 14b. ScoringPlay descriptions — minor shape difference

**What MLB statsapi returns** for `/v1/game/{pk}/playByPlay`:

> An `allPlays[]` array where each play has `result.description` (a human-readable sentence) and a `runners[]` array with per-runner movement. When a play is marked `isScoringPlay: false` but a runner still scores (wild pitch, balk, passed ball, error advance), the runner movement carries `isScoringEvent: true` and `movement.end === "score"`.

**Why this matters:** boxscore.email's scoring-play digest needs to surface runs that scored mid-at-bat (not just runs driven in by the batter). We currently inspect the runners array to catch these and synthesize a description like "Tena scores on wild pitch" (see [`lib/mlb.ts:144–187`](../lib/mlb.ts#L144)).

**SDIO's PlayByPlay** carries `Plays[]` with `Hit`, `Walk`, `Strikeout`, `Sacrifice`, `Error`, `Out` boolean flags and `RunsBattedIn`. It does NOT appear to carry per-runner movement, only the batter's at-bat result. Cleaner overall, but harder to surface "runner scored on wild pitch."

**Ask:** Confirm whether `Plays[].Description` includes mid-at-bat runner scoring (e.g., "Wild pitch by Smith, Jones scores"), OR add a `Plays[].RunnersAdvanced[]` array with `RunnerID`, `From`, `To`, `Scored`, `Reason`.

### 14c. Probable pitcher W-L on the schedule call

**What MLB statsapi returns** for `/v1/schedule?hydrate=probablePitcher,person.stats(season)`:

> The schedule call can be hydrated to include each probable pitcher's season W-L and ERA inline, eliminating per-pitcher follow-up calls for the "Today's Games" digest section.

**What SDIO's GamesByDate returns:** `HomeTeamProbablePitcherID` and `AwayTeamProbablePitcherID` — IDs only. Hydrating W-L/ERA requires a separate call to `PlayerSeasonStatsByPlayer` or filtering the bulk `PlayerSeasonStats/{season}` response per pitcher.

**Ask:** Either (a) add an optional `?include=probablePitcherStats` query parameter on `GamesByDate` that nests probable-pitcher W-L/ERA, OR document that `PlayerSeasonStats/{season}` (single call) is the intended path so a client can filter the 1,179-player response down to the day's probables.

### 14d. Per-team schedule range — single-call vs. day-loop

**What MLB statsapi returns** for `/v1/schedule?teamId={id}&startDate={s}&endDate={e}`:

> A single call returns every game for a team in a date range (typically 7 days for "upcoming this week" in per-team digests).

**SDIO equivalent:** Either loop `GamesByDate/{date}` 7 times (7 calls × 30 teams worst-case if expanded to all teams), or call `Games/{season}` (full season) and filter client-side.

**Ask:** Add a `TeamGamesByDateRange/{teamkey}/{startdate}/{enddate}` endpoint, OR document the recommended pattern and confirm `Games/{season}` is cache-friendly.

---

## Daily request quota / 401-vs-429 question

**Observed behavior on production key:**

Probe run #1 (single execution): `GamesByDate/2026-JUN-05` returned `200 OK` with 15 games.

Probe run #2 (~5 minutes later, same script): `GamesByDate/2026-JUN-05` returned `401 "Unauthorized Endpoint: You are not authorized to access this endpoint."`

The endpoint flipped from accessible to inaccessible without any change to the key or query.

**Hypothesis:** Either (a) a per-day request quota that returns `401` (instead of the more conventional `429`) when exhausted, or (b) a per-endpoint rate limit with similar behavior, or (c) the key really doesn't have GamesByDate access and probe run #1's `200` was a fluke.

**Ask:** Clarify the daily request budget on this key, whether endpoint access is binary or quota-based, and which HTTP status code indicates quota exhaustion vs. true authorization failure. The "Unauthorized Endpoint" message is misleading for a quota-exhaustion case.

---

## Consolidated asks for SDIO

In rough priority order:

1. **Grant access to the endpoints currently 401-gated on our production key:** `GamesByDate`, `BoxScore`, `PlayByPlay`, `Player`, `Players`, `Players/{team}`, `PlayerSeasonStatsByPlayer`, `PlayerGameStatsBySeason`, `PlayerGameStatsByDate`, `News`. These are the *minimum* to support a daily digest at parity with statsapi.mlb.com.

2. **Clarify Transactions endpoint** — `Transactions/{date}` and `TransactionsBySeason/{season}` both return 404. The data dictionary lists a Transaction table with `Date`, `Name`, `PlayerID`, `Team`, `TeamID`, `Type`, `Note`, `FormerTeam`. Either the path is different, or this is also tier-gated but returning 404 instead of 401. We need a single-day or short-range transactions feed.

3. **Add per-position fielding splits** — see §14a. Without this, boxscore.email cannot fully render per-player fielding panels on player pages.

4. **Clarify 401-vs-429 semantics** — see "Daily request quota" above. Even if all endpoints are unlocked, our current key flipped from `200` to `401` on the same endpoint within minutes, which suggests a quota system that returns the wrong status code.

5. **Inline probable pitcher W-L on GamesByDate** (nice to have, §14c) — would save ~10 follow-up calls per daily digest.

6. **Team schedule range endpoint** (§14d) — minor; can be worked around with the full-season call.

7. **Document mid-at-bat runner scoring in PlayByPlay** (§14b) — confirm `Plays[].Description` covers it, or add a `RunnersAdvanced[]` array.

---

## Appendix: probe methodology

All status data above came from two scripts in this repo:

- [`scripts/probe-sportsdata-migration.ts`](../scripts/probe-sportsdata-migration.ts) — focused on the open gaps from issue #28 (Transactions, gameLog, profile)
- [`scripts/probe-sportsdata-coverage.ts`](../scripts/probe-sportsdata-coverage.ts) — comprehensive coverage map: probes the SDIO endpoint for every `lib/mlb.ts` export and reports OK / EMPTY / TIER_GATED / NOT_FOUND / ERROR.

Run with:
```
npx tsx --env-file=.env.local scripts/probe-sportsdata-coverage.ts
```

Requires `SPORTSDATAIO_API_KEY` set in `.env.local`.

**Field lists** came from the [SportsDataIO MLB data dictionary CSV](../sportsdataio-mlb-data-dictionary.csv) (1631 rows), filtered per table.
