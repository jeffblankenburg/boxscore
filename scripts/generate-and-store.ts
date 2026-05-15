import { loadDailyData } from "../lib/daily";
import { renderContent } from "../lib/render";
import { renderEmailContent } from "../lib/render-email";
import { upsertDigest } from "../lib/digests";
import { isValidIsoDate, yesterdayInET } from "../lib/dates";

async function main() {
  const date = process.argv[2] ?? yesterdayInET();
  if (!isValidIsoDate(date)) {
    console.error(`Bad date: ${date}. Use YYYY-MM-DD.`);
    process.exit(1);
  }
  console.log(`Generating + storing mlb/${date}...`);

  const data = await loadDailyData(date);
  const html = renderContent(data);
  const email_html = renderEmailContent(data);
  await upsertDigest({
    sport: "mlb", date, html, email_html, game_count: data.games.length,
  });

  console.log(`  ${data.games.length} games · web ${(html.length / 1024).toFixed(1)} KB · email ${(email_html.length / 1024).toFixed(1)} KB`);
  console.log(`Stored daily_digests row for (mlb, ${date}).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
