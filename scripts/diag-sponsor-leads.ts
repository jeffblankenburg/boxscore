// Mine the subscriber list for corporate domains — potential sponsor leads
// who are ALREADY readers. Strip personal email providers, group by domain,
// sort by employee count, dump.
//
// Run: npx tsx --env-file=.env.local scripts/diag-sponsor-leads.ts

import { supabaseAdmin } from "../lib/supabase";

// Consumer email providers — domains where multiple emails from the same
// domain don't represent "company employees who read boxscore" but just
// "people who happen to use the same free provider." Anything not on this
// list is treated as a potential corporate / institutional domain.
//
// Source: the long tail of common providers. List is conservative — false
// negatives (corporate domain we mistake for personal) only show up as a
// possible-sponsor row, which we eyeball anyway. False positives (personal
// domain we treat as corporate) just inflate the long tail.
const PERSONAL_PROVIDERS = new Set<string>([
  "gmail.com", "googlemail.com",
  "yahoo.com", "yahoo.co.uk", "yahoo.ca", "ymail.com", "rocketmail.com",
  "hotmail.com", "hotmail.co.uk", "hotmail.ca",
  "outlook.com", "outlook.co.uk", "live.com", "live.ca", "msn.com",
  "icloud.com", "me.com", "mac.com",
  "aol.com", "aim.com",
  "protonmail.com", "proton.me", "pm.me",
  "fastmail.com", "fastmail.fm",
  "duck.com", "duckduckgo.com",
  "hey.com",
  "tutanota.com", "tutanota.de",
  "gmx.com", "gmx.us", "gmx.de", "gmx.net",
  "mail.com", "email.com",
  "zoho.com",
  "comcast.net", "verizon.net", "att.net", "sbcglobal.net", "bellsouth.net",
  "earthlink.net", "cox.net", "charter.net", "frontier.com", "frontiernet.net",
  "roadrunner.com", "rr.com", "twc.com", "spectrum.net",
  "optonline.net", "optimum.net", "cableone.net",
  "windstream.net", "centurylink.net", "centurytel.net", "embarqmail.com",
  "juno.com", "netzero.net", "netzero.com",
  "rogers.com", "shaw.ca", "telus.net", "sympatico.ca", "videotron.ca",
  "btinternet.com", "sky.com", "virginmedia.com", "talk21.com", "tiscali.co.uk",
  "orange.fr", "wanadoo.fr", "free.fr", "laposte.net",
  "web.de", "t-online.de", "freenet.de",
  "yandex.com", "yandex.ru", "mail.ru", "list.ru", "bk.ru", "inbox.ru",
  "naver.com", "daum.net", "kakao.com",
  "qq.com", "163.com", "126.com", "sina.com", "sohu.com", "foxmail.com",
  "hanmail.net",
  // Disposable / forwarding (still real subscribers, but not "company employees")
  "passmail.net", "passinbox.com",
  "simplelogin.io", "anonaddy.com", "anonaddy.me",
  "duck.com", "33mail.com", "mozmail.com",
  "icloud.com",
  // Cell-carrier addresses — older-skewing consumer
  "verizonwireless.com", "txt.att.net", "vtext.com", "tmomail.net",
]);

// Heuristic flags for sports-adjacent / advertiser-fit categories. Hits on
// domain substrings (case-insensitive). Imperfect — a single keyword isn't
// proof — but useful for surfacing the actually-interesting rows from a
// list of thousands. The reviewer reads the FULL list; flags just suggest
// "look at this one first."
const FLAGS: Array<{ label: string; needles: string[] }> = [
  { label: "sports/league/team",    needles: ["mlb", "nba", "nhl", "nfl", "espn", "athletic", "fox", "cbs", "sport", "fan", "tickets", "ticket", "stub", "seatgeek", "vivid"] },
  { label: "cards/memorabilia",     needles: ["topps", "panini", "psa", "sgc", "beckett", "cards", "collect", "memorab", "card", "auction"] },
  { label: "betting/dfs/fantasy",   needles: ["draftkings", "fanduel", "betmgm", "caesars", "underdog", "prizepicks", "yahoo", "sleeper", "bet", "wager", "odds", "pick", "fantasy", "sportsbook"] },
  { label: "sports media/podcast",  needles: ["barstool", "ringer", "pat", "meadowlark", "bleacher", "deadspin", "sbnation", "media", "podcast", "studio"] },
  { label: "broadcast/streaming",   needles: ["mlb", "espn", "fox", "tnt", "tbs", "warner", "disney", "youtube", "twitch", "stream"] },
  { label: "consumer-brand / B2C",  needles: ["nike", "adidas", "lululemon", "fanatics", "newera", "hat", "shirt", "apparel", "merch", "brand", "shop", "store", "co"] },
  { label: "tech / analytics",      needles: ["sportradar", "genius", "statmuse", "sportsdata", "data", "analytics", "stats", "labs"] },
  { label: "finance / fintech",     needles: ["bank", "credit", "capital", "invest", "trading", "finance", "fintech", "pay"] },
  { label: "alcohol / beer",        needles: ["beer", "brew", "wine", "spirits", "bourbon", "whisky", "whiskey", "anheuser", "molson", "miller", "coors", "bud", "boston"] },
  { label: "government / gov",      needles: [".gov", "state", "city", "county"] },
  { label: "edu / academic",        needles: [".edu", "univ", "college", "school"] },
  { label: "nonprofit",             needles: [".org"] },
];

async function main(): Promise<void> {
  const db = supabaseAdmin();

  // Pull all active subscribers' emails. Pagination required — Supabase
  // caps un-paginated selects at 1000 rows.
  const emails: string[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("subscribers")
      .select("email")
      .eq("status", "active")
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as Array<{ email: string }>;
    for (const r of page) emails.push(r.email.toLowerCase());
    if (page.length < PAGE) break;
  }

  console.log(`Pulled ${emails.length.toLocaleString()} active subscriber emails.\n`);

  // Group by domain.
  const byDomain = new Map<string, number>();
  let malformed = 0;
  for (const e of emails) {
    const at = e.lastIndexOf("@");
    if (at < 0 || at === e.length - 1) {
      malformed++;
      continue;
    }
    const domain = e.slice(at + 1).trim();
    byDomain.set(domain, (byDomain.get(domain) ?? 0) + 1);
  }
  console.log(`Distinct domains: ${byDomain.size.toLocaleString()}  (malformed: ${malformed})\n`);

  // Personal provider share — sanity check on the cleanup.
  let personalTotal = 0;
  for (const [d, n] of byDomain) {
    if (PERSONAL_PROVIDERS.has(d)) personalTotal += n;
  }
  console.log(`Personal-provider subscribers: ${personalTotal.toLocaleString()} (${((personalTotal / emails.length) * 100).toFixed(1)}% of list)`);
  console.log(`Non-personal subscribers:      ${(emails.length - personalTotal).toLocaleString()} (${(((emails.length - personalTotal) / emails.length) * 100).toFixed(1)}% of list)\n`);

  // Corporate / institutional domains, sorted by count desc.
  const corporate: Array<{ domain: string; count: number; flags: string[] }> = [];
  for (const [domain, count] of byDomain) {
    if (PERSONAL_PROVIDERS.has(domain)) continue;
    if (count < 1) continue;
    const flags: string[] = [];
    const lower = domain.toLowerCase();
    for (const { label, needles } of FLAGS) {
      if (needles.some((n) => lower.includes(n))) flags.push(label);
    }
    corporate.push({ domain, count, flags });
  }
  corporate.sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain));

  // ── Section 1: domains with 3+ subscribers (strongest organic signal) ──
  const multi = corporate.filter((c) => c.count >= 3);
  console.log(`══ DOMAINS WITH 3+ SUBSCRIBERS (${multi.length} domains, strongest signal) ═══`);
  console.log("Multiple readers from the same domain = signal that the company has organic interest.");
  console.log();
  for (const c of multi) {
    const flagStr = c.flags.length > 0 ? `  [${c.flags.join(", ")}]` : "";
    console.log(`  ${String(c.count).padStart(4)}  ${c.domain.padEnd(36)}${flagStr}`);
  }
  console.log();

  // ── Section 2: domains with 2 subscribers, flagged categories only ──
  const flaggedPairs = corporate.filter((c) => c.count === 2 && c.flags.length > 0);
  console.log(`══ FLAGGED CATEGORIES, 2 SUBSCRIBERS (${flaggedPairs.length}) ═══`);
  for (const c of flaggedPairs) {
    console.log(`  ${String(c.count).padStart(4)}  ${c.domain.padEnd(36)}  [${c.flags.join(", ")}]`);
  }
  console.log();

  // ── Section 3: flagged single-subscriber domains, by category ──
  const flaggedSolo = corporate.filter((c) => c.count === 1 && c.flags.length > 0);
  console.log(`══ FLAGGED CATEGORIES, 1 SUBSCRIBER (${flaggedSolo.length}) ═══`);
  console.log("Heuristic — keyword hit on the domain string. Eyeball before trusting.");
  console.log();
  // Group by primary flag for readability.
  const byCategory = new Map<string, typeof flaggedSolo>();
  for (const c of flaggedSolo) {
    const primary = c.flags[0]!;
    if (!byCategory.has(primary)) byCategory.set(primary, []);
    byCategory.get(primary)!.push(c);
  }
  for (const [cat, items] of Array.from(byCategory.entries()).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ── ${cat} (${items.length}) ──`);
    for (const c of items.slice(0, 25)) {
      console.log(`        ${c.domain}`);
    }
    if (items.length > 25) console.log(`        … ${items.length - 25} more`);
    console.log();
  }

  // ── Section 4: top unflagged corporate domains (long tail to eyeball) ──
  const unflagged = corporate.filter((c) => c.flags.length === 0 && c.count >= 2);
  console.log(`══ UNFLAGGED CORPORATE DOMAINS WITH 2+ SUBSCRIBERS (${unflagged.length}) ═══`);
  console.log("Anything sports-adjacent the heuristic missed lives here. Eyeball it.");
  console.log();
  for (const c of unflagged.slice(0, 80)) {
    console.log(`  ${String(c.count).padStart(4)}  ${c.domain}`);
  }
  if (unflagged.length > 80) console.log(`  … ${unflagged.length - 80} more (rerun with --all to dump full list)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
