// Predictions email digest — the daily picks email (admins first, ~11:15
// AM ET, after the morning lines lock). Mirrors the flat/newspaper style
// of /mlb/predictions but as email-safe HTML (table layout + inline
// styles). Content is deliberately concise: today's card, a 7-day results
// table, and the season record.
//
// The render is pure (takes assembled data, returns an HTML body string).
// loadPredictionsDigestData() does the I/O. The body is meant to be
// dropped into the shared email shell (masthead + footer) by the cron.

import { prevDay } from "@/lib/dates";
import { loadPredictionsForDate } from "./predictions-data";
import { loadOddsForDate, loadPredictionOutcomesForDate, loadPredictionAccuracy, loadPlayRoi, loadSeasonHistory, type SeasonHistoryDay } from "./predictions-history";
import { selectDailyCard, cardCandidateFor, cardSize } from "./predictions";

const INK = "#161410";
const MUTED = "#666";
const RULE = "#000";
const HAIR = "#ddd";
const GREEN = "#1f5a1f";
const RED = "#a83232";
const GREEN_TINT = "rgba(31,90,31,0.07)";
const RED_TINT = "rgba(168,50,50,0.07)";
const SANS = "'Source Sans 3', Helvetica, Arial, sans-serif";
const MONO = "'JetBrains Mono', ui-monospace, Menlo, monospace";

export type DigestPick = { matchup: string; label: string; dog: boolean };
export type DigestDayGame = { finalScore: string | null; label: string; hit: boolean | null; dog: boolean };
export type DigestDay = { date: string; profit: number | null; profitPartial: boolean; games: DigestDayGame[] };
export type PredictionsDigestData = {
  date: string;
  picksPending: boolean;
  today: DigestPick[];
  last7: DigestDay[];
  season: { hitRate: number | null; hits: number; plays: number; profit: number; roi: number | null; hasProfit: boolean };
};

function iso(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { y: y ?? 0, m: m ?? 0, d: d ?? 0 };
}
function shiftDays(s: string, n: number): string {
  const { y, m, d } = iso(s);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function weekdayMonthDay(s: string): string {
  const { y, m, d } = iso(s);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
}
function money(v: number): string {
  return `${v >= 0 ? "+" : "−"}$${Math.abs(v).toFixed(2)}`;
}
function moneyWhole(v: number): string {
  return `${v >= 0 ? "+" : "−"}$${Math.round(Math.abs(v))}`;
}
function pct(v: number | null): string {
  return v == null ? "—" : `${(v * 100).toFixed(1)}%`;
}
function pctSigned(v: number | null): string {
  return v == null ? "—" : `${v >= 0 ? "+" : "−"}${(Math.abs(v) * 100).toFixed(1)}%`;
}

/** Assemble the digest data for `date` from the same loaders the page uses. */
export async function loadPredictionsDigestData(date: string): Promise<PredictionsDigestData> {
  const yesterday = prevDay(date);
  const seasonStart = `${date.slice(0, 4)}-03-01`;
  const seasonDays = Math.max(1, Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${seasonStart}T00:00:00Z`)) / 86_400_000));

  const [slate, todayOdds, last7Raw, acc, roi] = await Promise.all([
    loadPredictionsForDate(date),
    loadOddsForDate(date),
    loadSeasonHistory(shiftDays(yesterday, -6), yesterday),
    loadPredictionAccuracy(seasonDays, yesterday),
    loadPlayRoi(seasonDays, yesterday),
  ]);

  // Today's card (empty before the morning lines are captured).
  const picksPending = slate.gameCount > 0 && todayOdds.mlByGamePk.size === 0;
  const card = picksPending ? [] : selectDailyCard(
    slate.games.map((g) => cardCandidateFor(g.gamePk, g.away.winProbability, g.home.winProbability, todayOdds.mlByGamePk.get(g.gamePk))),
    cardSize(slate.gameCount),
  );
  const gameByPk = new Map(slate.games.map((g) => [g.gamePk, g]));
  const today: DigestPick[] = card
    .map((p) => {
      const g = gameByPk.get(p.gamePk);
      if (!g) return null;
      return { matchup: `${g.away.abbr} @ ${g.home.abbr}`, label: `${p.side === "home" ? g.home.abbr : g.away.abbr} ML`, dog: p.dog };
    })
    .filter((x): x is DigestPick => x !== null);

  const last7: DigestDay[] = last7Raw.map((d: SeasonHistoryDay) => ({
    date: d.date,
    profit: d.profit,
    profitPartial: d.profitPartial,
    games: d.games.map((g) => ({
      finalScore: g.linescore ? `${g.awayAbbr} ${g.linescore.away.r ?? 0}, ${g.homeAbbr} ${g.linescore.home.r ?? 0}` : null,
      label: g.mlPick ? `${g.mlPick.label} ML` : "—",
      hit: g.mlPick ? g.mlPick.hit : null,
      dog: g.mlPick ? g.mlPick.dog : false,
    })),
  }));

  return {
    date,
    picksPending,
    today,
    last7,
    season: {
      hitRate: acc.mlHitRate, hits: acc.mlPlayHits, plays: acc.mlPlays,
      profit: roi.mlProfit, roi: roi.mlRoi, hasProfit: roi.mlPlaysWithOdds > 0,
    },
  };
}

function sectionHead(text: string): string {
  return `<div style="font-family:${SANS};font-weight:800;font-size:17px;color:${INK};border-bottom:2px solid ${RULE};padding-bottom:3px;margin:22px 0 8px;">${text}</div>`;
}

/** Today's card as a compact list. */
function renderToday(d: PredictionsDigestData): string {
  if (d.picksPending) {
    return `${sectionHead("Today's Picks")}<p style="font-family:${SANS};font-size:14px;color:${MUTED};margin:0;">Today's picks lock at 10:30 AM ET, once the morning lines are set.</p>`;
  }
  if (d.today.length === 0) {
    return `${sectionHead("Today's Picks")}<p style="font-family:${SANS};font-size:14px;color:${MUTED};margin:0;">No games today.</p>`;
  }
  const rows = d.today.map((p) => `
    <tr>
      <td style="font-family:${SANS};font-size:14px;font-weight:700;color:${INK};padding:5px 0;border-bottom:1px solid ${HAIR};">${p.matchup}</td>
      <td style="font-family:${MONO};font-size:13px;font-weight:700;color:${GREEN};text-align:right;padding:5px 0;border-bottom:1px solid ${HAIR};">${p.label}${p.dog ? " 🐕" : ""}</td>
    </tr>`).join("");
  return `${sectionHead("Today's Picks")}<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${rows}</table>`;
}

/** The 7-day results table — day dividers + tinted pick rows. */
function render7Day(d: PredictionsDigestData): string {
  const dayBlocks = d.last7.map((day) => {
    const total = day.profit !== null
      ? `<span style="font-family:${MONO};font-weight:700;font-size:13px;color:${day.profit >= 0 ? GREEN : RED};">${money(day.profit)}${day.profitPartial ? "*" : ""}</span>`
      : "";
    const header = `
      <tr><td colspan="2" style="padding:9px 0 3px;border-bottom:1.5px solid ${RULE};">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
          <td style="font-family:${SANS};font-weight:800;font-size:14px;color:${INK};">${weekdayMonthDay(day.date)}</td>
          <td style="text-align:right;">${total}</td>
        </tr></table>
      </td></tr>`;
    const picks = day.games.map((g) => {
      const tint = g.hit === true ? GREEN_TINT : g.hit === false ? RED_TINT : "transparent";
      const strike = g.hit === false ? "text-decoration:line-through;" : "";
      const color = g.hit === true ? GREEN : g.hit === false ? RED : INK;
      return `
        <tr style="background:${tint};">
          <td style="font-family:${SANS};font-size:13px;color:${INK};padding:5px 6px;">${g.finalScore ?? "—"}</td>
          <td style="font-family:${MONO};font-size:13px;font-weight:700;color:${color};${strike}text-align:right;padding:5px 6px;">${g.label}${g.dog ? " 🐕" : ""}</td>
        </tr>`;
    }).join("");
    return header + picks;
  }).join(`<tr><td colspan="2" style="height:10px;line-height:10px;">&nbsp;</td></tr>`);

  return `${sectionHead("Last 7 Days")}<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${dayBlocks}</table>`;
}

/** Season record line. */
function renderSeason(d: PredictionsDigestData): string {
  const s = d.season;
  const profit = s.hasProfit
    ? ` &nbsp;·&nbsp; <span style="color:${s.profit >= 0 ? GREEN : RED};font-weight:700;">${moneyWhole(s.profit)}</span> &nbsp;·&nbsp; <span style="color:${s.profit >= 0 ? GREEN : RED};font-weight:700;">${pctSigned(s.roi)} ROI</span>`
    : "";
  return `${sectionHead("Season")}<p style="font-family:${SANS};font-size:15px;color:${INK};margin:0;"><strong>${pct(s.hitRate)}</strong> (${s.hits} of ${s.plays})${profit}</p>
    <p style="font-family:${SANS};font-size:11px;color:${MUTED};margin:6px 0 0;">Profit and ROI assume a flat $10 wager per pick.</p>`;
}

/** The digest body (no masthead/footer — the email shell wraps this). */
export function renderPredictionsDigestBody(d: PredictionsDigestData): string {
  return `<div style="font-family:${SANS};color:${INK};">${renderToday(d)}${render7Day(d)}${renderSeason(d)}</div>`;
}
