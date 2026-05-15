import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getDigest } from "../lib/digests";

async function main() {
  const date = process.argv[2] ?? "2026-05-13";
  const digest = await getDigest("mlb", date);
  if (!digest || !digest.email_html) {
    console.error(`No digest or email_html for ${date}`);
    process.exit(1);
  }
  const out = resolve(`out/${date}-email.html`);
  await writeFile(out, digest.email_html);
  console.log(`Wrote ${out} (${(digest.email_html.length / 1024).toFixed(1)} KB)`);

  // Grep-like inspection
  const al = digest.email_html.includes("American League");
  const alHasContent = digest.email_html.match(/American League[\s\S]{0,2000}/);
  console.log(`Contains "American League": ${al}`);
  if (alHasContent) {
    console.log("First 500 chars after 'American League':");
    console.log(alHasContent[0]?.slice(0, 500));
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
