// Visual QA harness for the email digests. Renders the ACTUAL shipped email
// (digest body wrapped in the real email template, with the sport's styles) and
// screenshots it at phone width — the thing a subscriber sees — so digest/render
// changes can be eyeballed across the fleet before they go out.
//
//   npx tsx --env-file=.env.local scripts/preview-digests.ts <date> [targets...]
//
// Targets: "wnba" (league), "mlb:team:cle" (team), "ncaam:conf:big-ten".
// Default targets render the cases most prone to layout regressions.
// Output: /tmp/digest-qa/<file>.png  (+ a .dark.png simulating a dark client).

import { writeFileSync, mkdirSync } from "fs";
import puppeteer from "puppeteer-core";
import { dailyEmail, teamDailyEmail } from "@/lib/emails/templates";
import { prettyDate } from "@/lib/dates";
import { findTeam } from "@/lib/teams";
import { loadNbaData } from "@/lib/nba";
import { loadWnbaData } from "@/lib/wnba";
import { loadNcaamData } from "@/lib/ncaam";
import { loadNcaawData } from "@/lib/ncaaw";
import { renderBasketballEmailContent, renderBasketballConferenceEmailContent } from "@/lib/render-basketball";
import { renderBasketballTeamEmailContent } from "@/lib/render-basketball-team";
import { loadBasketballTeamData } from "@/lib/basketball-team";
import { findBasketballConferenceBySlug, scopeBasketballToConference } from "@/lib/basketball-conferences";
import { loadTeamEmailData, renderTeamEmailContent } from "@/lib/render-team-email";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = "/tmp/digest-qa";

const BB_LOADERS = { nba: loadNbaData, wnba: loadWnbaData, ncaam: loadNcaamData, ncaaw: loadNcaawData } as const;

// Build the shipped email HTML for a target. Returns { file, html } or null.
async function buildEmail(date: string, target: string): Promise<{ file: string; html: string } | null> {
  const [sport, kind, slug] = target.split(":");
  const common = (sport: string, body: string, teamName?: string) => {
    const base = {
      sport, digestDate: date, digestPrettyDate: prettyDate(date), digestEmailHtml: body,
      digestUrl: "#", unsubscribeUrl: "#", manageUrl: "#", gamesUrl: "#", tipJarUrl: "#",
    };
    return teamName
      ? teamDailyEmail({ ...base, teamName }).html
      : dailyEmail(base).html;
  };

  // Basketball league
  if (!kind && sport! in BB_LOADERS) {
    const d = await BB_LOADERS[sport as keyof typeof BB_LOADERS](date);
    return { file: `${date}_${sport}_league`, html: common(sport!, renderBasketballEmailContent(d)) };
  }
  // Basketball team
  if (kind === "team" && sport! in BB_LOADERS) {
    const d = await loadBasketballTeamData(sport as any, slug!, date);
    return { file: `${date}_${sport}_team_${slug}`, html: common(sport!, renderBasketballTeamEmailContent(d), d.team.name) };
  }
  // Basketball conference
  if (kind === "conf" && (sport === "ncaam" || sport === "ncaaw")) {
    const d = await BB_LOADERS[sport](date);
    const conf = findBasketballConferenceBySlug(sport, slug!);
    if (!conf) return null;
    const body = renderBasketballConferenceEmailContent(scopeBasketballToConference(d, conf), conf);
    return { file: `${date}_${sport}_conf_${slug}`, html: common(sport, body, `${conf.short} Conference`) };
  }
  // MLB team
  if (sport === "mlb" && kind === "team") {
    const team = findTeam("mlb", slug!);
    if (!team) return null;
    const d = await loadTeamEmailData(team, date);
    return { file: `${date}_mlb_team_${slug}`, html: common("mlb", renderTeamEmailContent(d), team.name) };
  }
  console.warn(`skip unsupported target: ${target}`);
  return null;
}

async function main() {
  const [date, ...rest] = process.argv.slice(2);
  if (!date) { console.error("usage: preview-digests <date> [targets...]"); process.exit(1); }
  const targets = rest.length ? rest : ["wnba", "mlb:team:cle"];
  mkdirSync(OUT, { recursive: true });

  const built = (await Promise.all(targets.map((t) => buildEmail(date, t).catch((e) => {
    console.error(`  ${t}: ${(e as Error).message}`); return null;
  })))).filter(Boolean) as Array<{ file: string; html: string }>;

  const b = await puppeteer.launch({ executablePath: CHROME, headless: true, defaultViewport: { width: 400, height: 1200, deviceScaleFactor: 2 } });
  for (const { file, html } of built) {
    const p = await b.newPage();
    await p.setContent(html, { waitUntil: "load" });
    await p.evaluate(() => (document as any).fonts.ready);
    const full = await p.evaluate(() => document.body.scrollHeight);
    await p.screenshot({ path: `${OUT}/${file}.png`, clip: { x: 0, y: 0, width: 400, height: Math.min(full, 4000) } });
    console.log(`wrote ${OUT}/${file}.png (${full}px)`);
    await p.close();
  }
  await b.close();
}

main().then(() => process.exit(0));
