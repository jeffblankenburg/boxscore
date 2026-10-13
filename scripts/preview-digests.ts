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
  let flagged = 0;
  for (const { file, html } of built) {
    const p = await b.newPage();
    await p.setContent(html, { waitUntil: "load" });
    await p.evaluate(() => (document as any).fonts.ready);
    const full = await p.evaluate(() => document.body.scrollHeight);
    await p.screenshot({ path: `${OUT}/${file}.png`, clip: { x: 0, y: 0, width: 400, height: Math.min(full, 4000) } });

    const findings = [...(await rendererLint(p)), ...staticLint(html)];
    if (findings.length) {
      flagged++;
      console.log(`\n⚠ ${file}.png (${full}px) — ${findings.length} issue(s):`);
      for (const f of findings.slice(0, 12)) console.log(`    ${f}`);
    } else {
      console.log(`✓ ${file}.png (${full}px) — clean`);
    }
    await p.close();
  }
  await b.close();
  console.log(`\n${built.length} digest(s), ${flagged} flagged. Review PNGs in ${OUT}.`);
}

// Rendered checks (reliable in Chrome): horizontal overflow past the phone
// width, and inline elements that visually touch with no space between words.
// Passed as a STRING to page.evaluate — tsx/esbuild instruments named functions
// with a __name helper that doesn't exist in the browser, which breaks a normal
// function callback here.
const RENDERER_LINT = `(() => {
  const VW = 400, out = [];
  const sel = (el) => el.tagName.toLowerCase() + (typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\\s+/).join(".") : "");
  const alnum = (c) => /[a-zA-Z0-9]/.test(c);
  const inline = (el) => ["inline", "inline-block"].includes(getComputedStyle(el).display);
  for (const el of Array.from(document.querySelectorAll("body *"))) {
    const r = el.getBoundingClientRect();
    if (r.width > 1 && r.right > VW + 2) out.push("overflow: <" + sel(el) + "> extends to " + Math.round(r.right) + "px (> " + VW + ")");
  }
  for (const el of Array.from(document.querySelectorAll("body *"))) {
    // Only text-run elements (span/a) — table cells and block divs have their
    // own spacing and abut legitimately.
    const kids = Array.from(el.children).filter((c) => /^(SPAN|A)$/.test(c.tagName) && c.textContent && c.textContent.trim() && inline(c));
    for (let i = 0; i + 1 < kids.length; i++) {
      const a = kids[i], bEl = kids[i + 1];
      // A whitespace text node between them means they're separated by a space
      // in normal flow (italic bounding boxes overlap and fool a pixel-gap test).
      let n = a.nextSibling, spaced = false;
      while (n && n !== bEl) { if (n.nodeType === 3 && /\\s/.test(n.textContent || "")) { spaced = true; break; } n = n.nextSibling; }
      if (spaced) continue;
      const ra = a.getBoundingClientRect(), rb = bEl.getBoundingClientRect();
      if (Math.abs(ra.top - rb.top) > 2 || rb.left - ra.right > 1) continue;
      const ta = a.textContent, tb = bEl.textContent;
      if (/\\s$/.test(ta) || /^\\s/.test(tb)) continue;
      if (alnum(ta.trim().slice(-1)) && alnum(tb.trim().slice(0, 1)))
        out.push('run-together: "…' + ta.trim().slice(-10) + '" + "' + tb.trim().slice(0, 10) + '…"');
    }
  }
  return Array.from(new Set(out)).slice(0, 20);
})()`;

async function rendererLint(page: any): Promise<string[]> {
  return page.evaluate(RENDERER_LINT);
}

// Static check: email bodies that lean on flex/grid/multi-column layout for
// content. These render in Chrome but are unreliable across mail clients
// (shrink-wrapped flex rows, stripped <style>) — the root cause of the
// run-together + stacked-bracket bugs. A heads-up to verify, not a hard fail.
function staticLint(html: string): string[] {
  const style = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
  const body = html.replace(/<style>[\s\S]*?<\/style>/g, "");
  const out: string[] = [];
  const re = /([.#][\w-]+(?:[^{};]*)?)\{[^}]*?(display\s*:\s*(?:flex|grid)|column-count\s*:\s*[2-9])[^}]*\}/g;
  let m: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((m = re.exec(style))) {
    const selector = m[1]!.trim().split(",")[0]!.trim();
    // Only flag if the class is actually USED in the body markup — a rule left
    // in the stylesheet for a since-migrated element is a false alarm.
    const cls = selector.startsWith(".") ? selector.slice(1).split(/[ >:]/)[0]! : "";
    if (cls && !new RegExp(`class="[^"]*\\b${cls}\\b`).test(body)) continue;
    if (!seen.has(selector)) { seen.add(selector); out.push(`email uses ${m[2]!.split(":")[0]!.trim()} layout — verify in a real client: ${selector}`); }
  }
  return out.slice(0, 10);
}

main().then(() => process.exit(0));
