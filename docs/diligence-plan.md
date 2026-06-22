# boxscore: Diligence-Ready Plan

_Generated 2026-06-21, revised 2026-06-22 after Jeff caught a sells-y moat claim that didn't hold up. See "What changed in revision" at the bottom of this doc and §6 for open questions._

This document is the answer to: **if a check-writer sat across the table from you tomorrow, what could you prove?**

It is organized in nine parts:

1. **Honest positioning** — what we have, what we don't, where the bet sits. The v1 of this doc oversold a "moat" that doesn't hold up; this is the corrected framing.
2. **Headline metrics right now** — every number you can ship today, sourced.
3. **Audience-by-audience answers** — every question from the four-audience framework (advertisers, partners, acquirers, investors), with the answer if we have it, the gap if we don't, sourced.
4. **What to build next** — dashboards that visualize what we already collect, instrumentation for what we don't, and the order to ship in.
5. **Suggested order** — first-wave and second-wave work items.
6. **Open questions for Jeff** — positioning calls only the operator can make.
7. **Appendix: full data-asset inventory** — what every Supabase table contains.
8. **How to use this document.**
9. **GitHub issues filed.**

**Posture**: this is a working document. Where it cites a number, that number has a source in code or a public report. Where it makes a strategic claim, that claim is either evidence-backed or flagged as a hypothesis pending validation. The v1 of this doc failed that test — see §1 for the correction.

---

## 1. Honest Positioning (Not a Moat — Yet)

> **What do we know about sports fans that nobody else knows?**

Honestly? At 6,142 active subscribers, almost nothing nobody else also knows. ESPN's app collects favorite teams at onboarding. Yahoo Fantasy knows every player on every roster a user has drafted. The Athletic was acquired by The New York Times for $550M on January 31, 2022 [(Wikipedia)](https://en.wikipedia.org/wiki/The_Athletic); its newsletter audience surpassed 6 million subscribers by May 2025 with The Pulse alone at 3.5M [(The Drum, May 2025)](https://www.thedrum.com/news/2025/05/06/the-athletic-just-hit-5m-newsletter-subscribers-here-s-how-and-why-it-matters). Bleacher Report collects per-team app alerts. None of these is a hard-to-find moat.

**What boxscore actually has, with evidence (all numbers verified 2026-06-22 via `scripts/diag-verify-claims.ts`):**

1. **A built, end-to-end newsletter + ad-tech operation.** Database-backed ad campaign / creative / placement / first-party-click-tracking / advertiser portal stack. Code lives in `app/admin/ads/*`, `lib/ads-render.ts`, `lib/ad-impressions.ts`, `lib/link-tracking.ts`. This has resale value independent of the audience.

2. **38 days of automated public daily delivery.** First successful send-email cron run was 2026-05-15 (per `cron_runs` table); today is 2026-06-22. 38 distinct edition dates have shipped to the public list with `error IS NULL`. Team digests started 4 days later, 2026-05-19, covering 34 edition dates across all 30 MLB clubs. Across both, **249,703 total successful sends** in 38 days — avg ~6,571 sends/day. No manual operator intervention on the morning send during that window (per cron_runs status='ok').

3. **List-growth velocity from soft launch.** First subscriber created 2026-05-15 12:55 UTC; first morning's send delivered to **2,010 subscribers** (authoritative `sends` table count — the cron's own result JSON said 1,000, but that was a Supabase pagination bug fixed by the supervisor heal pass 6 minutes later; see §10). Today there are 6,142 actives. That's **3.06× growth in 38 days**. Per-day trajectory: 2,010 → 2,340 → 3,302 → 4,312 → 4,636 → 4,747 → 4,838 → 4,895 → 5,070 → 5,116 over the first 10 days, then linear growth to today. The big burst was the first 5 days (presumably a press hit or share event); growth has cooled to ~30-40/day since. Whether this curve sustains is unknown — see UTM-capture gap (#67).

4. **Engagement on a small base.** League open rate 46.4–49.0% across the last 10 daily editions; team open rate 62.3–66.6% same window (per `daily_metrics` rows). The "team open rate runs ~15-18pp higher than league" finding is real but expected for any segmented newsletter — The Athletic offers the same team-level segmentation.

5. **A consciously minimal editorial footprint.** "Data not spin" is the positioning bet — no takes, no narrative, no human voice. Different from The Athletic (premium editorial; 6M+ newsletter subs per The Drum), Front Office Sports (business-of-sports angle; 800K+ newsletter subs per their 2024 Subscribe page [reference](https://frontofficesports.com/subscribe-2024/) [search summary](https://discover.buysellads.com/front-office-sports)), and Huddle Up (sports business commentary; ~136K Substack subscribers, 3x weekly [Substack listing](https://huddleup.substack.com/)). Whether the market for "calm, just-the-data" is large enough to support a venture-scale business is the open question this product is testing.

**What we don't have:**

- A scale moat — we are ~0.1% of The Athletic's 6M+ newsletter audience.
- A data moat — competitors collect equivalent or richer team-affinity data.
- A brand moat — boxscore is unknown outside this small list.
- A distribution moat — we have no channel ESPN can't access.

**The honest diligence answer:** boxscore is a 38-day-old public newsletter operation with a working ad-tech stack, a category-relevant engagement profile on a fast-growing small base, and an editorial position that hasn't been market-tested at scale. The bet is that there's space between "free push notifications from ESPN" and "paid newsletter from The Athletic" for a free, content-light, opt-in-by-team daily email. Today that bet is a hypothesis with 6,142 data points after 38 days.

What would *make* this a defensible business: (a) sustaining the early growth curve past the point where it becomes operationally interesting to ESPN/The Athletic to acquire or replicate; (b) productizing the audience-intelligence layer as a data-licensing offering separately from sponsorship revenue; (c) signing a structural distribution partnership (a sports app's "we recommend boxscore" relationship). None of these exist today.

**Anchor the diligence conversation here, not on the moat claim that doesn't hold up.**

---

## 2. Headline Metrics — Live, As Of 2026-06-22

Every number below is sourced. Pull fresh with `scripts/diag-verify-claims.ts` before any external conversation.

### Subscribers

| Metric | Value | Source |
|---|---|---|
| Active subscribers | **6,142** | `subscribers.status='active'` |
| Pending (un-confirmed) | 82 | `subscribers.status='pending'` |
| Unsubscribed (lifetime) | 484 | `subscribers.status='unsubscribed'` |
| Lifetime signups | 6,708 | all rows in `subscribers` |
| Earliest signup | 2026-05-15 12:55 UTC | `min(subscribers.created_at)` |
| Earliest confirmed | 2026-05-15 12:57 UTC | `min(subscribers.confirmed_at)` |
| List age (days) | **38** | today (2026-06-22) − 2026-05-15 |
| Day-1 send size (authoritative) | **2,010 subscribers** | `count(sends)` where digest_date='2026-05-15', team_id IS NULL, error IS NULL. The first cron's `result.sent` JSON said 1,000 — that was a Supabase pagination-cap bug, caught by the supervisor heal pass 6 minutes later. |
| Growth multiple | 3.06× | 6,142 / 2,010 over 38 days |
| New last 7 days | 106 (~15/day) | `confirmed_at` within window |
| New last 30 days | 1,272 (~42/day) | `confirmed_at` within window |
| Unsub rate (lifetime) | 7.2% | 484 / 6,708 |

### Engagement (MLB, last 10 daily_metrics rows: editions 2026-06-12 → 2026-06-21)

| Metric | League digest | Team digests (aggregate across 30 clubs) |
|---|---|---|
| Delivered (avg/day) | 5,685 | 1,929 |
| Delivered (min — max) | 5,661 — 5,712 | 1,869 — 1,977 |
| Open rate (min — max) | **46.4% — 49.0%** | **62.3% — 66.6%** |
| Open rate (avg) | 48.1% | 64.9% |

All per `daily_metrics` rows; computed as `opened / delivered`. Backfill computed via `scripts/backfill-daily-metrics.ts`.

**Observation:** team-digest open rate runs ~15-18 percentage points higher than league on our list. This is a within-product comparison — people who self-select into per-team digests are higher-intent than people on a generic league list. This is true of any segmented sports newsletter (The Athletic offers the same team segmentation). The number is real and worth showing; the interpretation is "we have a high-intent subset," not "this is unique to boxscore."

### Total sends (the actual delivery volume)

| Metric | Value | Source |
|---|---|---|
| Total `sends` rows | 249,705 | `count(*)` |
| Successful sends (`error IS NULL`) | **249,703** | `count(*) where error is null` |
| League-only successful | 195,524 | `team_id IS NULL` |
| Team-only successful | 54,179 | `team_id IS NOT NULL` |
| Distinct league edition dates shipped | **38** | `distinct digest_date` where `team_id IS NULL`, `error IS NULL` |
| Distinct team edition dates shipped | 34 | same but `team_id NOT NULL` |
| Earliest league edition shipped | 2026-05-15 | first `digest_date` in sends with team_id null, error null |
| Earliest team edition shipped | 2026-05-19 | same with team_id not null |
| Teams covered (distinct team_ids in sends) | **30** | all MLB clubs |

### Subscriptions (active opt-ins, all-time)

| Surface | Count | Source |
|---|---|---|
| mlb / league | 5,754 | `email_subscriptions` where sport='mlb', scope='league', active=true |
| mlb / team (across all 30 clubs) | 1,990 | same with scope='team' |
| nba / league | 2 (admin-only sport) | same with sport='nba' |
| wnba / league | 1 (admin-only sport) | same with sport='wnba' |

### Why people leave (unsubscribe reasons — system category)

| Reason | Count | Share |
|---|---|---|
| user (clicked unsubscribe) | 272 | 56% |
| bounce (mail-server reject) | 168 | 35% |
| (null, legacy) | 40 | 8% |
| complaint (marked as spam) | **4** | **1%** |

Total = 484. Source: `count(unsubscribe_reason)` where `status='unsubscribed'`. Note: a separate user-stated reason field (`unsubscribe_user_reason`) was just added (migration 0056) for the dropdown survey on `/u/[token]`. No history yet.

**Complaint-rate framing:**
- Per signup: 4 / 6,708 = **0.060%** lifetime
- Per send: 4 / 249,703 = **0.0016%** lifetime

Gmail's Postmaster Tools documentation recommends staying below 0.10% per-send to avoid reputation impact ([Postmaster Tools — Sender Guidelines](https://support.google.com/mail/answer/81126)). Our per-send rate is ~60× under that line. (Earlier draft of this doc said 0.0001%; that was wrong — total sends are 249K not the 3-4M I hand-waved.)

### Revenue (current)

| Source | Status |
|---|---|
| Ko-fi tip-link clicks (lifetime) | 4,221 (`count(*) from support_clicks`) |
| Actual tip $ collected | Lives in Ko-fi; **not in our DB**. See issue #74 (revenue dashboard + Ko-fi import). |
| Ad campaigns | 3 total; 2 approved; 2 paid (`paid_at IS NOT NULL`). |
| Ad revenue lifetime | `sum(ad_campaigns.paid_amount_cents) where paid_at IS NOT NULL` — needs `/admin/metrics/revenue` per #74. |

### Adjacent traffic / surface

| Metric | Value | Source / Notes |
|---|---|---|
| Web pageviews (last 30 days, production) | 33,490 | `count from page_views` where event_type='pageview', vercel_environment='production', last 30 days |
| RSS aggregator polls (last 7 days) | 3,259 | `count from rss_polls` last 7 days |
| Twitter followers | 433 | `count(social_followers)` where platform='twitter', removed_at IS NULL |
| Bluesky followers | 309 | same with platform='bluesky' |
| Puzzle attempts (lifetime) | 332 | `count from puzzle_attempts` |
| StatSharks endless runs (lifetime) | 221 | `count from statsharks_endless_runs` |

### Content assets (the corpus — mostly public MLB data we've indexed)

| Asset | Rows | What it actually represents |
|---|---|---|
| daily_digests | 162 | Cached league-digest renders. **Includes pre-launch days back to 2025-07-14** (admin previews, on-this-day backfill). **Not 162 days of public delivery** — see "Distinct league edition dates shipped" above for the real number (38). |
| team_digests | 2,760 | Cached team-digest renders. Same caveat — includes pre-launch backfill. 30 teams × 34 actually-shipped dates = ~1,020 team-edition sends; the rest are cached renders never sent to the list. |
| historical_games | 163,308 | Public MLB Stats API data ingested + scored for excitement. Anyone can backfill in days. |
| historical_player_lines | 4,472,168 | Same — public data, our scoring layer. |

**Honest take on the corpus**: the historical data is public MLB Stats API data. A competitor can re-fetch it in a week. The scoring layers (excitement on historical_games, feat-scoring on historical_player_lines) are formulas we wrote and could re-derive equivalently fast.

The genuinely-not-easily-replicable asset is **the engagement log against this list since 2026-05-30** (when open tracking turned on, per `OPEN_TRACKING_START_ISO` in `lib/dashboard.ts`). That's **23 days** of subscriber-attributed opens as of 2026-06-22. Modest, growing daily, can't be retroactively created.

---

## 3. Audience-by-Audience Answers

Each question gets one of:
- **A** — answerable today from existing data (with source).
- **B** — answerable after a small computation we haven't done yet (work item created).
- **C** — we lack the data; instrumentation needed (work item created).

### 3.1 Advertiser questions

#### Audience

| Question | Status | Answer | Source |
|---|---|---|---|
| How many subscribers? | A | 6,142 active. | `subscribers.status='active'` |
| How fast is the list growing? | A | 1,272 new in last 30 days (~42/day); 106 in last 7 days (~15/day). Cooling vs. early surge. | `confirmed_at` in window |
| % opening emails? | A | League: 46.4–49.0% per edition, avg 48.1%. Team: 62.3–66.6%, avg 64.9%. | `daily_metrics` last 10 rows |
| % clicking? | C | Click tracking via Resend is disabled (broke activation links). First-party tracker exists for ad placements but not for digest body — see #69. | `/advertise/page.tsx` comment |
| Daily active readers? | B | ~2,735 unique league opens/edition + ~1,250 unique team opens/edition (open-rate × delivered). True DAU/WAU dedupe across editions — not yet computed. | `daily_metrics` avg |
| Subscribers receiving a digest every day? | A | 5,754 opted into MLB league + 99 team-only = 5,853 distinct people. | `email_subscriptions` + `diag-subscription-overlap.ts` |
| Unique teams represented? | A | All 30 MLB clubs. 1,990 active team subs total; 1,321 of those people also on league (93% overlap); 99 team-only. | `email_subscriptions` + overlap diag |
| What sports are most popular? | A | MLB is the entire public list. NBA (2) and WNBA (1) are admin-only test subscribers. | `email_subscriptions` grouped by sport |

#### Demographics

| Question | Status | Answer |
|---|---|---|
| Who reads it? | C | **Only 2.1% of active subscribers (130 people) have completed the welcome demographics form.** Need to lift this dramatically. |
| Where? | C | country + region captured for those 130. |
| Age? gender? income? | C | Same. Captured but sample is too small to quote externally. |
| Casual vs hardcore? | B | Computable from engagement cohorts: a "hardcore" subscriber opens N consecutive days and clicks team links. We don't have a cohort table yet. |
| How much sports content do they consume? | C | Not measurable from our data alone; would need to survey. |

#### Inventory

| Question | Status | Answer | Source |
|---|---|---|---|
| What ad placements? | A | Four formats: sponsor-line, standings-strip, display-box, classified. | `/advertise` page + `lib/ads-render.ts` |
| Impressions per sponsor? | A | At 48.1% avg open rate × 5,685 avg delivered = ~2,735 email impressions + ~90 web pageviews per day = ~2,825 per league-digest day. | `daily_metrics` 10-day averages |
| Can sponsorships target specific teams? | A | Yes — team digests are separate inventory; 30 individual audiences with 1,321–5,853 reach depending on the team. | `email_subscriptions` grouped by team_id (per-team breakdown pending dashboard #73) |
| Specific sports? | A | Yes (MLB only today; NBA/WNBA admin-only). | `sports` table visibility column |
| Geography? | C | Country-level possible for the 130 subscribers with demographics (2.1% of active list); unknown for the other 6,012. | `subscribers.demographics_completed_at` |
| Exclusive sponsorships? | A | Yes — sponsor-line and standings-strip slot uniqueness enforced via unique index `ad_placements_slot_uniq` on (sport, date, format, slot_index). | migration 0025 |

#### Performance

| Question | Status | Answer |
|---|---|---|
| Historical CTR? | C | Need first-party click tracking shipped (Resend's was disabled, in-house pending). |
| What advertisers perform best? | C | Insufficient sample — 2 paid campaigns total to date. |
| Tracking links? | A | Yes — `/r/ad/[placement_id]?to=…&sig=…` with HMAC. |
| Promo codes? | C | Not implemented. Lift trivial for sponsors — they can include codes in their own copy and reconcile externally. |
| Conversion measurement? | C | Not yet. Would need a pixel callback or sponsor-provided conversion endpoint. |

#### Brand safety

| Question | Status | Answer |
|---|---|---|
| Content near ads? | A | Pure box scores, standings, stat leaders. No editorial / human-voiced takes. (See `feedback_data_not_spin.md`.) |
| Advertiser-safe? | A | Yes, by construction. No politics, no betting takes, no opinion. |
| Policy on gambling/alcohol/politics? | C | **No documented house rules yet.** Already drafted on `/advertise`: "We will / We won't run" — but it's only public there. Codify in a `docs/ad-policy.md`. |

---

### 3.2 Strategic partner questions

#### Product fit

| Question | Status | Answer |
|---|---|---|
| What problem are we solving? | A | "I want yesterday's box scores in one quiet morning email instead of opening four apps." |
| Why pick boxscore over ESPN notifications? | A | Different format, not different data. Single morning email vs. a stream of app notifications. Pull-not-push, no algorithm. Whether that format is preferred by enough fans to be a real product is the bet. |
| What makes the audience unique? | B | Honest framing: per-team opt-in + daily-delivered + zero-editorial-noise is a defensible category position but **not unique** — The Athletic has per-team daily emails too, with vastly larger subscriber numbers. What we can argue is "this audience selected boxscore over The Athletic specifically because they prefer the data-only format" — but that's a hypothesis pending survey data we don't have. |

#### Distribution

| Question | Status | Answer |
|---|---|---|
| How are users finding us? | C | **No acquisition attribution.** We don't store referrer, UTM, or "where did you hear about us" — anywhere. This is the single biggest data hole. |
| Best acquisition channels? | C | Same — unknown without instrumentation. |
| CAC? | C | Unknowable without source attribution + cost tracking. |

#### Engagement

| Question | Status | Answer |
|---|---|---|
| How often do users interact? | A | Daily (open rate 48% league, 65% team means a typical subscriber opens 3-5 of 7 weekly editions). |
| Retention 30/90/180 days? | B | **Computable from `confirmed_at` + `unsubscribed_at`** — we just haven't run the cohort yet. Build it. |
| Season retention? | B | Same — start of 2026 season → end of 2026 season cohort math is straight pandas. |

#### Integration

| Question | Status | Answer |
|---|---|---|
| APIs? | C | RSS feeds exist (`/rss/[sport]`). No JSON API exposed publicly. The data behind the digest is renderable but not API'd. |
| Funnel users into partner products? | A | Yes via standard link tracking on placements. |
| Power partner newsletters? | C | Not architected for white-label. Possible but a real product surface. |
| Whitelabel digest? | C | Same. |

#### Economics

| Question | Status | Answer |
|---|---|---|
| How does partnership create revenue? | A | Sponsorship of a partner's adjacent content (e.g., card-grading-company places ads on team digests for their team fans). |
| Attribution? | A | First-party redirect on click; HMAC-signed destination. Sponsor provides conversion ping. |
| KPIs for success? | A | CTR on placements, conversion event from sponsor side, repeat-bookings. |

---

### 3.3 Potential acquirer questions

#### Growth

| Question | Status | Answer | Source |
|---|---|---|---|
| Subscribers today? | A | 6,142 active. | `subscribers.status='active'` |
| Monthly growth rate? | A | 1,272 net adds in last 30 days. List 30 days ago ≈ 6,142 − 1,272 = 4,870. **Growth = 1,272 / 4,870 = 26.1% MoM.** (Earlier draft cited "~21%" — that was 1,272 / today's-list, the wrong denominator.) | `confirmed_at` in window |
| Daily growth rate? | A | ~42/day last 30 days; ~15/day last 7 days. | same |
| Historical curve? | B | Need growth dashboard (#70) — `confirmed_at` over time as cumulative + per-day bars. List is only 38 days old, so the curve is short but well-defined. | issue #70 |

#### Retention

| Question | Status | Answer | Source |
|---|---|---|---|
| 30/90/180-day retention? | B | Computable from `confirmed_at` + `unsubscribed_at` + `status`. Not yet computed — issue #68. **Caveat: the list is only 38 days old, so 90/180-day cohorts don't exist yet.** Only 0/30-day retention is meaningfully measurable today. | issue #68 |
| Season-over-season retention? | B | Will be measurable starting April 2027 (one full MLB season retention vs the May 2026 cohort). Not measurable today. | — |

#### Engagement

| Question | Status | Answer | Source |
|---|---|---|---|
| Open rate? | A | League: avg 48.1%, range 46.4–49.0%. Team: avg 64.9%, range 62.3–66.6%. | `daily_metrics` last 10 rows |
| Click rate? | C | Resend tracking off; in-house digest-body tracker pending (#69). | — |
| Unsubscribe rate? | A | 484 unsubs / 6,708 lifetime signups = 7.2% lifetime. **Per-week breakdown not yet computed** — need to chart unsubscribed_at over time. | `subscribers.unsubscribe_reason IS NOT NULL` |
| Churn rate? | B | Same shape as retention. Will be computable as cohorts mature. | — |
| Spam complaint rate? | A | 4 complaints lifetime = 0.060% per-subscriber, 0.0016% per-send. Gmail Postmaster threshold is 0.10% per-send — we're ~60× under. | `subscribers.unsubscribe_reason='complaint'` |

#### Revenue

| Question | Status | Answer | Source |
|---|---|---|---|
| Current monthly revenue? | C | Two sources, both partial: (1) Ko-fi tips — 4,221 lifetime clicks, but actual $ collected lives in Ko-fi, not in our DB. (2) Ad campaigns — 2 paid, dollar total pending dashboard. See #74. | `support_clicks` + `ad_campaigns.paid_at` |
| Annual? | C | Same. List is 38 days old, so the question is more "MRR/run-rate." | — |
| Revenue by source? | C | Need consolidated revenue ledger (#74 + #75). | — |
| Sponsorship $ collected lifetime? | B | `sum(ad_campaigns.paid_amount_cents) where paid_at IS NOT NULL` — small (2 campaigns); needs to be surfaced on `/admin/metrics/revenue`. | `ad_campaigns` |
| Donations? | C | External — Ko-fi data not synced. | issue #74 |
| Memberships? | N/A | No tiers per `feedback_email_is_the_product.md` — tips and ads only. | project memory |
| Future revenue ops? | A | Per-team digest sponsorship (30 inventories) + display-box + classified bundle. Ads policy (gambling/alcohol) is an open decision — see §6. | `/advertise` page + `feedback_email_is_the_product.md` |

#### Subscriber quality

| Question | Status | Answer | Source |
|---|---|---|---|
| Active subscribers? | A | 6,142. | `subscribers.status='active'` |
| Inactive subscribers? | B | Define as "never opened in last 30 days." Computable from `sends` + `email_events`. Not yet computed — needs #72 (engagement snapshot). | issue #72 |
| Multi-team fans? | A | 1,990 total team subscriptions across 1,420 distinct subscribers (per `diag-subscription-overlap.ts`) ⇒ avg 1.40 teams per multi-team subscriber. | overlap diag |
| Avg digests/subscriber? | B | 249,703 successful sends / 6,142 currently-active = 40.7 sends per current subscriber. **Caveat**: this divides total sends by today's active list — subscribers who joined late received fewer; subscribers who unsubscribed received some sends before leaving. Per-cohort breakdown needs #72. | `sends` `count` / current active |
| Avg engagement per subscriber? | B | Needs per-subscriber opens (#72). | — |

#### Data asset

| Question | Status | Answer |
|---|---|---|
| What data do we collect? | A | See §7. Subscriber identity + per-team opt-in (6,142 / 1,990) + daily delivery log (249,703 sends in 38 days) + per-edition opens log (23 days, since 2026-05-30) + 4.5M historical player lines (public MLB API data we ingested). | §7 appendix |
| Proprietary data? | B | Honest answer: very little. The subscriber list + engagement log against it are ours. The historical corpus is public MLB Stats API data we re-fetched. Our excitement-scoring + feat-scoring formulas are ours but small in scope and easy to re-derive. | inspection |
| Hard to replicate? | B | The list + engagement log can't be retroactively created — but the engagement log is **23 days old** and the list is **38 days old**. The compounding window has barely started. Renderer, ad stack, scoring are recreatable in days-to-weeks. | `OPEN_TRACKING_START_ISO`; cron_runs |
| Historical data depth? | A | **38 days of public edition history**, **23 days of subscriber-level engagement**. 75+ years of MLB game data sits in the `historical_*` tables but it's public data, not ours. | cron_runs + tracking start |
| User preference data? | A | Sport + team opt-ins clean (5,754 / 1,990). Demographics: 130 / 6,142 = 2.1% completion. **Don't quote demographic distributions externally yet** — sample too small. | `subscribers.demographics_completed_at` |

#### Operational risk

| Question | Status | Answer | Source |
|---|---|---|---|
| Who runs it? | A | Solo operator (Jeff). | — |
| Reliability? | A | 110 ok send-email cron runs, 5 failed, across 38 days × 3 sports (114 expected). Other routes: generate 1215 ok / 3 failed; post-twitter 39 / 1; post-bluesky 40 / 1; post-discord 17 / 0; send-team-email 37 / 0; ad-stats-snapshot 15 / 6 (the recent failure cluster is the timeout incident — fixed via daily_metrics refactor). | `cron_runs` |
| Documentation? | B | Code is heavily commented; CLAUDE memory captures decisions. **No operator handbook exists** — see #82. | inspection |
| Could someone else operate it? | B | With handbook + access transfer, yes — the daily flow is fully cron-driven. | — |
| Single-operator risk? | A | Material. Handbook (#82) + access-recovery procedure is the mitigant. | — |

#### Technology

| Question | Status | Answer |
|---|---|---|
| Architecture? | A | Next.js on Vercel, Supabase/Postgres, Resend, Vercel Blob, MLB Stats API. Standard SaaS stack. |
| Hosting costs? | C | Not tracked in DB. Vercel + Supabase invoices live in their dashboards. |
| Data providers? | A | MLB Stats API (free, public) + Vercel Web Analytics + Resend webhooks. |
| Vendor dependencies? | A | Supabase, Vercel, Resend, Ko-fi, MLB API. |
| API costs? | C | All current vendors are flat-fee or volume-priced; no metered usage in DB. |
| Email costs? | C | Resend per-send pricing not tracked. Compute from sends × per-send price. |
| Technical debt? | A | The biggest items: (1) click tracking still on the Resend side and disabled; (2) Vercel Web Analytics drain captures pageviews but not subscriber-attributed; (3) no UTM/referrer capture at signup. |

#### Legal

| Question | Status | Answer |
|---|---|---|
| Content ownership? | A | MLB stats are public under MLB Stats API ToS. Our renderings + selections + scoring are ours. |
| Statistics ownership? | A | Same. |
| Licenses? | A | MLB Stats API ToS only (non-commercial use restriction is worth a lawyer's read — see open question). |
| Opt-in? | A | Yes, double opt-in (confirmation email click). |
| GDPR? | B | We capture email + optional demographics; have unsubscribe + deletion paths. Full GDPR compliance (subject-access requests, data-portability export) not built. |
| CAN-SPAM? | A | Compliant — physical address in footer, working unsubscribe, no deceptive subject lines. |
| Privacy policy? | A | Lives at `/privacy`. |

---

### 3.4 Investor questions

#### Market

| Question | Status | Answer | Source |
|---|---|---|---|
| How many sports fans? | B | Gallup has periodically polled "are you a sports fan?" with answers around half of US adults; I don't have a specific year+number in front of me. **Action: source a specific recent Gallup or Pew number before quoting externally.** | flagged |
| How many want a daily sports email? | A | Existence proof from comparable products: **The Athletic** 6M+ newsletter subscribers including The Pulse at 3.5M as of May 2025 [The Drum](https://www.thedrum.com/news/2025/05/06/the-athletic-just-hit-5m-newsletter-subscribers-here-s-how-and-why-it-matters); **Front Office Sports** 800K+ newsletter subscribers as of Sept 2024 [FOS Subscribe](https://frontofficesports.com/subscribe-2024/); **Huddle Up** ~136K Substack subscribers, 3x weekly [Substack](https://huddleup.substack.com/). The demand for daily sports email exists at meaningful scale. | web sources |
| Market share? | B | Skip until total addressable market (US adults who want a free daily sports email) has a sourced number. boxscore vs comparable newsletters: 6,142 vs The Athletic's 3.5M (Pulse) = **0.18%**, vs FOS's 800K = 0.77%, vs Huddle Up's 136K = 4.5%. The first ratio is the most relevant given direct format overlap. | computed from web sources above |

#### Vision

This is a positioning choice and it has to come from Jeff, not from this doc. Two candidate framings:

- **A** "boxscore is a free, content-light, opt-in-by-team daily sports email — for fans who want the data and none of the noise." Honest, modest, defensible. Doesn't oversell.
- **B** "boxscore is building the audience-intelligence layer for sports fandom; the daily digest is the collection mechanism." Bigger story; needs the audience-intelligence-as-product roadmap to be real, not aspirational. Today it isn't.

**Recommendation**: (A) in early conversations. (B) only after we've actually productized the audience-intelligence layer (data licensing, partner integrations, etc.). Claiming (B) today is the exact mistake the v1 draft of this doc made.

#### Moat

See section 1. Short version: **we don't have one yet.** What we have is a working operation + a category-relevant engagement profile + an editorial position that hasn't been market-validated at venture scale. Those are real but they aren't a moat. The honest investor pitch is "this is the bet" — not "this is defensible."

---

## 4. What to Build

Three categories of work, ordered by impact-on-diligence-conversation.

### Category A — Dashboards to visualize what we already collect

These ship as `/admin/metrics/*` pages backed by existing tables. No new instrumentation needed. **Highest leverage**: each dashboard answers a category of diligence question directly.

1. **Growth dashboard** (`/admin/metrics/growth`)
   - Cumulative active subscribers line (confirmed_at)
   - Per-day signups bar chart with 7-day moving average
   - Per-day unsubscribes overlay
   - Net growth bars (greens/reds)
   - Cohort table: month-of-signup × % still active today
   - **Answers**: growth questions for advertiser, partner, acquirer, investor.

2. **Retention dashboard** (`/admin/metrics/retention`)
   - Cohort triangle: month-of-signup down, age-in-months across, % retained
   - 30/90/180-day retention by cohort
   - Season-over-season retention (March → October)
   - Survival curve (Kaplan-Meier shape)
   - **Answers**: retention questions for partner, acquirer.

3. **Engagement dashboard** (`/admin/metrics/engagement`) — extension of the existing `/admin/ads/explore`
   - Open rate over time, by sport, by scope (league/team)
   - Click rate over time (once click tracking ships)
   - Open-rate distribution: of subscribers who got 30 sends, how many opened 0-5, 6-10, ... 26-30
   - "Heaviest readers" leaderboard: top 100 by open count (anonymized)
   - **Answers**: engagement quality, "casual vs hardcore" question, DAU/WAU shape.

4. **Subscriber quality dashboard** (`/admin/metrics/quality`)
   - **% of active list opted into ≥1 team digest** (today: 1,420 distinct subscribers with any team sub / 6,142 active = **23.1%**, per `diag-subscription-overlap.ts`). Earlier draft said "1,990 / 5,754 = 35%" — that ratio is subscription-count / league-count, not people / active-list, and double-counts subscribers opted into multiple teams.
   - Avg teams per multi-team subscriber: 1,990 / 1,420 = **1.40 teams**
   - Top 10 teams by subscription count
   - Multi-sport subscribers (when NBA/WNBA go public)
   - **Answers**: "subscribers fans of multiple teams?", "unique teams represented?"

5. **Revenue dashboard** (`/admin/metrics/revenue`)
   - Ad revenue: sum of `ad_campaigns.paid_amount_cents` by month
   - Tip-click count by source (web-header / web-footer / email-header / email-footer)
   - **Needs Ko-fi data import** (separate work item)
   - **Answers**: revenue, revenue-by-source for acquirer/investor.

6. **Demographics dashboard** (`/admin/metrics/demographics`) — partly built on `/advertise`
   - Country, age, gender, income breakdown
   - Completion rate (currently 2.1%)
   - **Answers**: demographic questions for advertisers.

7. **Brand-safety / inventory dashboard** (`/admin/metrics/inventory`)
   - Available slots per format per sport per day
   - Sold-through percentage
   - Approved/rejected/pending campaign mix
   - House rules (gambling/alcohol/politics policy) shown
   - **Answers**: ad-inventory questions, brand-safety.

8. **Operational health dashboard** (extends `/admin/operations/crons`)
   - Cron uptime: % of expected runs that fired on time over rolling windows
   - Mean execution duration per route
   - Daily SLA: did we send all required emails before 6 AM ET?
   - **Answers**: "is it reliable?" question for acquirer.

### Category B — Data we should start collecting

These are new instrumentation. Order by question they unblock.

1. **UTM + referrer capture at /subscribe** — _unblocks CAC, channel attribution, "how are users finding us"_. Highest priority. Without this we have **zero** acquisition story.
2. **First-party email click tracking on digest body** — _unblocks CTR_. Resend's tracker was disabled to fix activation-link breakage; we have the redirect tracker for ads (`/r/ad/[placement_id]`); apply the same shape to digest content links.
3. **Subscriber-attributed pageviews** — _unblocks email-to-web funnel_. Set a `boxscore_sid` cookie at /c/[token] activation, propagate to `/r/e` redirect tracker; correlate to subscriber_id.
4. **Ko-fi revenue webhook → DB** — _unblocks real revenue numbers_. Ko-fi has webhooks for new tips; route to a new `tips` table.
5. **Cost ledger** — _unblocks unit economics_. New table `cost_ledger` with manually-entered monthly Resend / Vercel / Supabase invoices keyed by month + vendor.
6. **Per-cohort engagement snapshot** — _unblocks "heaviest readers", retention analysis_. Nightly job writes per-subscriber rolling 30-day open/click count to a `subscriber_engagement` table.
7. **Demographics nudge campaign** — _unblocks audience claims_. Email subscribers who confirmed but haven't completed the welcome form (98% of the list). Even a 20% lift would move quoting demographics from "anecdotal" to "credible".
8. **GDPR data-portability export** — _legal de-risking_. `/settings/export` returns the subscriber's full record + sends + events as a JSON download.

### Category C — Documentation / process

1. **Operator handbook** — `docs/handbook.md`. What to do when:
   - Morning cron fails to fire (today's example: ad-stats-snapshot timeout)
   - Resend marks the domain as low-reputation
   - MLB Stats API changes a field shape
   - A subscriber requests deletion
   - An advertiser requests a refund
2. **House rules** — `docs/ad-policy.md`. Codify the gambling/alcohol/politics policy already shown on `/advertise`.
3. **Architecture diagram** — one-pager PNG showing Next.js / Supabase / Resend / MLB API / Ko-fi / Vercel Blob. Goes in every external deck.
4. **Diligence room** — a private folder of: this doc, the headline metrics report (run scripts/diag-diligence-snapshot.ts monthly), architecture diagram, sample editions, sample share images, ad pitch deck. Keeps the "do you have …" conversation under 30 minutes.

---

## 5. Suggested Order

The first three items unlock the biggest diligence answers per unit of work:

1. **UTM/referrer capture** — without this, every "how are you growing?" conversation stalls. (Category B.1, ~half a day.)
2. **Retention dashboard** — surfaces cohort retention numbers that anyone serious will ask about. (Category A.2, one day.) "Single chart every acquirer wants" was my framing in v1; closer to truth is "the chart that doesn't exist makes the others hard to interpret."
3. **First-party click tracking on digest body** — unlocks CTR for both diligence and advertiser pitches. (Category B.2, one day.)

Then:

4. Growth dashboard (A.1, ~half a day)
5. Engagement dashboard extension (A.3, ~half a day)
6. Subscriber quality dashboard (A.4, ~half a day)
7. Ko-fi revenue webhook (B.4, one day — depends on Ko-fi's API)
8. Operator handbook (C.1, ~half a day, ongoing)

The remainder is incremental — each dashboard or instrumentation unlocks ~one column of diligence answers.

---

## 6. Open Questions for Jeff (Decisions Only You Can Make)

After the v1 of this doc overpromised the moat story, the rewrite is honest at the cost of less narrative momentum. The questions below need your input before the doc is "diligence ready" — most are positioning calls that aren't mine to make.

### Positioning + narrative

1. **The vision sentence** (§3.4). Two candidates above (A: "free content-light daily sports email"; B: "audience-intelligence layer for sports fandom"). My recommendation is A for now, B only when we've actually productized affinity data. **Want me to commit (A) as the one-liner, or do you have a third framing?**
2. **The moat claim** (§1, §3.4). I rewrote it as "we don't have a moat yet — here's the bet." That's the honest answer but it's not what a check-writer wants to read. **Is that the framing you want to send into the room, or do you want me to find a more aggressive (but still defensible) angle?**
3. **Competitive anchors**. The rewrite names The Athletic, Front Office Sports, Huddle Up specifically. **Is that the right field to compare to, or do you want me to drop competitor names entirely?**

### Sourcing

4. **Open-rate benchmarks**. I removed all "industry average is X%" claims because I couldn't source them confidently. **Do you have a benchmark source (Beehiiv, Substack, ConvertKit publishes anything?) I should cite, or stay benchmark-free?**
5. **The Athletic comparison data**. Public reporting on their open rate, ARPU, and team-subscription depth is patchy. **Worth paying for a research report (e.g. Forrester, Press Gazette) to anchor the comparative claims, or operate without?**
6. **MLB Stats API ToS** (carried over). Non-commercial restriction needs a lawyer's read. **Want me to draft the specific question for your lawyer?**

### Strategic

7. **Audience-intelligence-as-product**. The biggest framing decision: do we ever productize the affinity data itself (data licensing, partner integrations) separately from sponsorship revenue? **If yes, vision (B) becomes defensible; if no, drop (B) from the doc.**
8. **Multi-sport expansion timing** (carried over). NBA/WNBA are admin-only. **What's the trigger for going public — subscriber count? Specific season? Specific partnership?**
9. **Acquisition vs fundraise vs continue-bootstrapping**. The doc's tone changes substantially depending on the audience. **Which conversation should this doc primarily serve?**

### Tactical

10. **Ko-fi vs Stripe migration** (carried over). Ko-fi fine for tips. **At what revenue threshold should we migrate to Stripe for cleaner financial reporting?**
11. **Premium tier** (carried over). `feedback_email_is_the_product.md` rules out "pay to remove ads." **Hold that line going into a fundraise, or revisit?**
12. **House rules (gambling / alcohol)**. Sponsor money sitting on the table from DraftKings, FanDuel, Bud Light, etc. **What's the editorial line?**

### Workstream

13. **Rewrite scope**. I corrected the most egregious section-1 / section-3 claims tonight without you. The rest of the doc may have other unsourced claims I haven't audited. **Want me to do a full second-pass tomorrow morning, or are sections 1-3 enough for now?**
14. **Issues created vs deferred**. I filed 22 GH issues (#67-#88). **Should I close any of those if they're predicated on a moat story we're walking back?** Specifically: #86 (LTV/CAC dashboard) and #87 (investor deck) assume an investor track that may not be the path.

---

## 7. Appendix — Full Data-Asset Inventory

_Compiled from `supabase/migrations/0001-0055`._

### Subscribers + identity
- **subscribers** — core user record. Fields: `id`, `email`, `status`, `created_at`, `confirmed_at`, `unsubscribed_at`, `unsubscribe_reason`, `is_admin`, plus demographics (`country`, `region`, `age_band`, `income_band`, `gender`, `demographics_completed_at`). **Missing**: acquisition source, referrer, UTM.
- **email_subscriptions** — per-newsletter opt-in. Fields: `subscriber_id`, `sport`, `scope` (league|team), `team_id`, `active`. The team-affinity asset.
- **admin_codes / admin_sessions** — admin auth (2FA codes + session cookies).
- **advertiser_codes / advertiser_sessions** — advertiser-portal auth, same pattern.

### Email send + delivery + engagement
- **sends** — per-(subscriber, sport, date) send log with resend_id and error. Idempotency + retry.
- **email_events** — Resend open + click events keyed on resend_id.
- **webhook_events** — Svix dedupe log to prevent double-processing retries.
- **email_link_clicks** — chrome-link clicks (Manage Subscriptions, etc.).
- **support_clicks** — Ko-fi tip-link clicks by insertion point.

### Web analytics
- **page_views** — Vercel Web Analytics drain. `path`, `route`, `event_type`, `country`, `device_type`, `session_id`, `device_id`. **Not joined to subscribers.**

### Ads
- **ad_advertisers** / **ad_campaigns** / **ad_creatives** / **ad_placements** — full booking + render pipeline.
- **ad_stats_snapshot** — singleton rolling stats for `/advertise`.
- **link_clicks** — first-party redirect tracker (used by ads; available for digest body when click tracking ships).
- **daily_metrics** — per-day per-sport headline metrics (delivered, opened, clicked, web_pageviews, active_subscribers) + team_* mirror. Backs the admin ticker cards.

### Content
- **daily_digests** / **team_digests** — rendered HTML cache.
- **daily_raw** — raw MLB API payloads per day.
- **historical_games** — game index 1950–present with excitement scoring.
- **historical_boxscores** — per-game raw payloads.
- **historical_player_lines** — per-line stat record (~4.5M rows). The corpus that powers daily puzzle picks.
- **players** / **player_seasons** — canonical player profiles + per-season stats.
- **announcements** — banner injection per (sport, date).

### Games / puzzles
- **puzzle_picks** — daily puzzle answers.
- **puzzle_attempts** — per-subscriber attempt log with guesses, hints, solved/unsolved.
- **statsharks_endless_runs** — endless-mode game runs.

### Social distribution
- **social_posts** — Twitter / Bluesky / Discord / Facebook post log.
- **social_followers** — follower registry with star + bidirectional-follow tracking.
- **social_followers_syncs** — sync checkpoints.
- **discord_webhooks** — registered Discord webhook destinations.
- **rss_polls** — RSS aggregator polling log.

### Operations
- **cron_runs** — every cron execution: route, sport, date, status, error, result.
- **admin_settings** — key-value config (ads_enabled, etc.).
- **sports** — sport catalog with visibility (public / admin_only).
- **backfill_progress** — historical-data crawler checkpoints.

---

## 8. How to Use This Document

- **Before any external conversation** — run `npx tsx --env-file=.env.local scripts/diag-diligence-snapshot.ts` and update section 2.
- **When the next dashboard ships** — flip the relevant question in section 3 from B/C to A.
- **When data gets stale** — regenerate this doc; the audience framework doesn't change, the numbers do.

If you can answer 80% of section 3's questions with "A" (data on-demand) AND have an honest moat / positioning story, you're diligence-ready. Today: roughly **60% A, 25% B, 15% C** on the data side; the positioning story (§1, §3.4) is still under review pending answers to the questions in §6. **The data work is a 2-week sprint; the positioning is a conversation, not a sprint.**

---

## 9. GitHub Issues Filed

All work items in section 4 exist as GitHub issues — see the meta-tracker at **#88** for the suggested execution order.

| # | Title | Category |
|---|---|---|
| **#67** | UTM + referrer capture at /subscribe | B.1 — instrumentation |
| **#68** | Retention dashboard | A.2 — dashboard |
| **#69** | First-party click tracking on digest body | B.2 — instrumentation |
| #70 | Growth dashboard | A.1 — dashboard |
| #71 | Engagement dashboard with cohorts | A.3 — dashboard |
| #72 | Subscriber-engagement snapshot table | B.6 — instrumentation |
| #73 | Subscriber quality dashboard | A.4 — dashboard |
| #74 | Revenue dashboard + Ko-fi tip import | A.5 + B.4 |
| #75 | Cost ledger | B.5 — instrumentation |
| #76 | Demographics nudge campaign | B.7 — campaign |
| #77 | Subscriber-attributed pageviews (cookie) | B.3 — instrumentation |
| #78 | Demographics dashboard | A.6 — dashboard |
| #79 | Ad inventory + brand-safety dashboard | A.7 — dashboard |
| #80 | House rules / `docs/ad-policy.md` | C.2 — docs |
| #81 | Operational health dashboard (cron SLA) | A.8 — dashboard |
| #82 | Operator handbook | C.1 — docs |
| #83 | GDPR data-portability export | B.8 — instrumentation |
| #84 | Architecture diagram | C.3 — docs |
| #85 | Diligence room folder | C.4 — docs |
| #86 | LTV/CAC unit-economics dashboard | downstream of #67/#71/#74/#75 |
| #87 | Live-data investor deck | downstream — synthesizes all of the above |
| **#88** | **Meta-tracker for this plan** | parent issue |

**Bold = first-wave: UTM capture, retention dashboard, click tracking.** Ship these three and ~40% of section 3's "B" + "C" answers become "A".

Adjacent issues already in the backlog (pre-existing, not refiled): #22 (admin health-of-service view, parent of #81), #28 (MLB API licensing risk — the legal open question from §6), #51 (first-party link tracker, related to #69), #52 (ad impression measurement, related to #69), #66 (dormant-subscriber re-engagement, consumer of #72).

---

## 10. What Changed in Revision

### Round 3 (2026-06-22, third pass — pagination audit)

Jeff spotted that "day-1 send size 1,000" matched the Supabase 1,000-row pagination cap (per memory `feedback_supabase_1000_row_cap.md`) and was suspicious. Verified via `scripts/diag-audit-1000.ts`:

- **Day-1 actual sends: 2,010**, not 1,000. The first cron at 09:15 UTC on 2026-05-16 reported `sent=1000, total_active_subscribers=1000`. That was the pagination bug — the cron's internal query capped at 1,000 rows. The supervisor heal pass at 09:21 (6 minutes later) found and delivered to the remaining 1,010 subscribers, reporting `sent=1010, skipped=1000, total_active_subscribers=2010`. The `sends` table contains all 2,010 rows; only the result-JSON snapshot was wrong.
- **2026-05-24 oddity**: authoritative `sends` count is 5,116 but cron's reported `sent=716`. The cron crashed/restarted partway and the result JSON didn't account for itself correctly. Delivery itself was complete (the supervisor's behavior accounts for it).
- **General rule going forward**: `cron_runs.result.sent` is advisory; the `sends` table is authoritative. Any historical narrative from cron's reported JSON values is suspect for the early days when pagination bugs were still being shaken out.

This pass fixed:
- §1 growth claim: 6.1× → **3.06×** (6,142 / 2,010, not / 1,000)
- §2 day-1 send-size row: corrected with explanation of why the cron number was wrong
- §1 trajectory: replaced the 1,000 → 1,010 → 2,340 narrative with the authoritative day-by-day numbers from the `sends` table (2,010 → 2,340 → 3,302 → 4,312 → ...)

**What's still verified clean** (not pagination-prone): all HEAD counts with `count: 'exact'` (active subscribers, total sends, paid campaigns, etc.), all paginated scans (distinct dates, subscribers grouped by sport, etc.), all `daily_metrics` aggregations.

### Round 2 (2026-06-22, second pass)

Jeff caught that the doc cited `daily_digests` row count (159) as "5 months of edition history" when the list is only **38 days old**. That table includes pre-launch cached renders back to 2025-07-14. Same error pattern existed across the doc.

This round fixed every number with a verifiable source via `scripts/diag-verify-claims.ts`:

- **Public delivery duration**: 5 months → 38 days. First successful send-email cron run was 2026-05-15, not earlier. The `daily_digests` and `team_digests` row counts (162 / 2,760) include cached renders for pre-launch dates and admin previews. The actual delivery numbers are 38 league edition dates + 34 team edition dates (per `sends` table, `team_id`/`error IS NULL`).
- **Total sends**: ~3-4M (hand-waved) → 249,703 (counted). Complaint rate per-send was 0.0001% in v2; correct is **0.0016%** (still 60× under Gmail's 0.10% threshold, but the original number was 16× too low).
- **Open tracking window**: ~2 months → **23 days** (since 2026-05-30 per `OPEN_TRACKING_START_ISO`).
- **Open rates**: range 47-49% / 64-67% (hand-waved) → 46.4-49.0% league avg 48.1%, 62.3-66.6% team avg 64.9% (verified from `daily_metrics` last 10 rows).
- **Monthly growth rate**: ~21% (wrong denominator) → **26.1%** (1,272 / 4,870 prior base).
- **% opted into team**: 35% (wrong denominator — subscription-count) → **23.1%** (1,420 distinct people / 6,142 active, per `diag-subscription-overlap.ts`).
- **Competitive numbers**: added sourced citations for The Athletic (6M+ newsletter subs, 3.5M Pulse per The Drum May 2025; NYT acquisition $550M Jan 2022 per Wikipedia), Front Office Sports (800K+ subs per their Sept 2024 Subscribe page), Huddle Up (~136K per Substack). Removed the unsourced "~3M The Athletic" / "~600K FOS" / "~250K Huddle Up" guesses from v2.
- **List-growth narrative added to §1**: 1,000 → 6,142 in 38 days = 6.1× growth. This was buried in earlier drafts; it's a stronger story than the "5 months" frame was trying to be.
- **Source column added** to every Section 3 question table. Every cell with a number now cites the SQL query, the table, or the URL.

### Round 1 (2026-06-22, first pass — moat correction)

Jeff pushed back on the v1 of this doc: the §1 "moat" paragraph asserted that ESPN, Yahoo, The Athletic, and Bleacher Report don't have team-affinity behavioral data at boxscore's resolution. That's demonstrably false. The claim was sells-y narrative, not evidence-backed.

That pass corrected:

- §1 moat paragraph: rewrote as "we don't have one yet, here's what we honestly have." Removed false ESPN/Yahoo/Athletic comparison.
- §2 team-digest open-rate framing.
- §2 complaint rate framing.
- §2 corpus framing (not proprietary).
- §3.3 Data asset table.
- §3.4 Vision + Moat.
- §3.2 audience uniqueness claim.
- §3.4 Market block — initially marked B-status; round 2 sourced the numbers.
- §5 retention dashboard framing.
- §6 open questions expanded from 5 to 14.

**What didn't change in either round**: every dashboard recommendation and GH issue (§4, §9). The audit was on framing and unverified numbers; not on the workplan.

Memory note `feedback_back_claims_with_data.md` saved: every comparative or strategic claim must be backed by data or a concrete example. No exceptions.
