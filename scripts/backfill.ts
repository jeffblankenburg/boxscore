import { loadDailyData } from "../lib/daily";
import { renderContent } from "../lib/render";
import { renderEmailContent } from "../lib/render-email";
import { upsertDigest } from "../lib/digests";
import { supabaseAdmin } from "../lib/supabase";
import { yesterdayInET } from "../lib/dates";

const BASE = "https://statsapi.mlb.com/api";

type SeasonInfo = {
  regularSeasonStartDate: string;
  postSeasonEndDate: string;
};

async function getSeasonInfo(season: number): Promise<SeasonInfo> {
  const res = await fetch(`${BASE}/v1/seasons/${season}?sportId=1`);
  if (!res.ok) throw new Error(`seasons api ${res.status}`);
  type Res = { seasons: SeasonInfo[] };
  const data = (await res.json()) as Res;
  const s = data.seasons?.[0];
  if (!s) throw new Error("no season data");
  return s;
}

async function digestExists(sport: string, date: string): Promise<boolean> {
  const { count, error } = await supabaseAdmin()
    .from("daily_digests")
    .select("sport", { count: "exact", head: true })
    .eq("sport", sport)
    .eq("date", date);
  if (error) throw new Error(`digestExists: ${error.message}`);
  return (count ?? 0) > 0;
}

function eachDate(startIso: string, endIso: string): string[] {
  const out: string[] = [];
  const [sy, sm, sd] = startIso.split("-").map(Number) as [number, number, number];
  const [ey, em, ed] = endIso.split("-").map(Number) as [number, number, number];
  let d = new Date(Date.UTC(sy, sm - 1, sd));
  const end = new Date(Date.UTC(ey, em - 1, ed));
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() + 24 * 60 * 60 * 1000);
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const positional = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const season = Number(positional[0] ?? "2026");
  const force = process.argv.includes("--force");
  const delayMs = Number(process.env.BACKFILL_DELAY_MS ?? "1500");

  const info = await getSeasonInfo(season);
  const yesterday = yesterdayInET();
  const end = info.postSeasonEndDate < yesterday ? info.postSeasonEndDate : yesterday;
  const dates = eachDate(info.regularSeasonStartDate, end);

  console.log(
    `Backfilling ${season} mlb from ${info.regularSeasonStartDate} through ${end} ` +
    `(${dates.length} dates, ${delayMs}ms between, force=${force}).`
  );

  let stored = 0, skipped = 0, failed = 0;
  for (let i = 0; i < dates.length; i++) {
    const date = dates[i]!;
    const prefix = `[${String(i + 1).padStart(3)}/${dates.length}] ${date}`;
    if (!force && (await digestExists("mlb", date))) {
      console.log(`${prefix}  skip   (already in DB)`);
      skipped++;
      continue;
    }
    try {
      const data = await loadDailyData(date);
      const html = renderContent(data);
      const email_html = renderEmailContent(data);
      await upsertDigest({
        sport: "mlb", date, html, email_html, game_count: data.games.length,
      });
      console.log(
        `${prefix}  store  ${data.games.length} games, web ${(html.length / 1024).toFixed(0)} KB, email ${(email_html.length / 1024).toFixed(0)} KB`,
      );
      stored++;
    } catch (err) {
      console.error(`${prefix}  FAIL   ${(err as Error).message}`);
      failed++;
    }
    if (i < dates.length - 1) await sleep(delayMs);
  }

  console.log(`Done. stored=${stored} skipped=${skipped} failed=${failed}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
