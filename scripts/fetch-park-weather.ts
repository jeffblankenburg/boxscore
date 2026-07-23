// Exports an hourly park-temperature fixture for the weather iteration of
// the model-improvement loop (scripts/fit-weather-nrfi.ts).
//
// Source: open-meteo's free archive API (no key). One request per park
// covers the whole season of hourly 2m temperatures in UTC; ~30 requests
// total. The archive lags realtime by a few days — games newer than the
// lag simply have no reading and the fit treats them as no-adjustment.
//
// Output: docs/predictions-v7/fixtures/park_weather_<year>.csv with
// teamId,date,hourUtc,tempC. Rerun to refresh; fully overwrites.
//
//   npx tsx scripts/fetch-park-weather.ts [YEAR]

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { PARKS } from "./_park-locations";

const YEAR = process.argv[2] ?? "2026";

async function main() {
  const start = `${YEAR}-03-01`;
  const today = new Date();
  const endDate = new Date(Math.min(today.getTime() - 86400000, Date.parse(`${YEAR}-11-30`)));
  const end = endDate.toISOString().slice(0, 10);

  const rows: string[] = ["teamId,date,hourUtc,tempC"];
  for (const [teamIdStr, park] of Object.entries(PARKS)) {
    const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${park.lat}&longitude=${park.lon}` +
      `&start_date=${start}&end_date=${end}&hourly=temperature_2m&timezone=UTC`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${park.name}: HTTP ${res.status}`);
    const body = (await res.json()) as { hourly?: { time?: string[]; temperature_2m?: Array<number | null> } };
    const times = body.hourly?.time ?? [];
    const temps = body.hourly?.temperature_2m ?? [];
    let kept = 0;
    for (let i = 0; i < times.length; i++) {
      const t = temps[i];
      if (t === null || t === undefined) continue;
      // time format: 2026-03-01T00:00
      const date = times[i]!.slice(0, 10);
      const hour = Number(times[i]!.slice(11, 13));
      rows.push(`${teamIdStr},${date},${hour},${t}`);
      kept++;
    }
    console.log(`  ${park.name.padEnd(22)} ${kept} hourly readings`);
    await new Promise((r) => setTimeout(r, 300)); // stay friendly to the free API
  }

  const out = join(process.cwd(), "docs/predictions-v7/fixtures", `park_weather_${YEAR}.csv`);
  writeFileSync(out, rows.join("\n") + "\n");
  console.log(`\nWrote ${rows.length - 1} rows → ${out}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
