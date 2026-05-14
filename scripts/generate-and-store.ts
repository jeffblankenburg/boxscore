import { loadDailyData } from "../lib/daily";
import { renderContent } from "../lib/render";
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
  await upsertDigest("mlb", date, html, data.games.length);

  console.log(`  ${data.games.length} games · ${(html.length / 1024).toFixed(1)} KB`);
  console.log(`Stored daily_digests row for (mlb, ${date}).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
