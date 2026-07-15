// Generate a standalone QR code (PNG + SVG) for a tracked /r/qr link.
//
//   npx tsx scripts/make-qr.ts [src] [destPath]
//
//   src      — campaign label, lowercase/digits/hyphens (default: sabr-2026).
//              Must match the SRC_RE in app/r/qr/route.ts or the route coerces
//              it to "unknown" and the scan won't attribute to your campaign.
//   destPath — optional path prefix (default: ./qr-<src>). Writes .png + .svg.
//
// PNG is 1200px (plenty for a business card at 600dpi); SVG is vector for
// large-format print. Error correction H so it still scans if the print
// smudges or something overlaps a corner.
import QRCode from "qrcode";

const SRC_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

async function main() {
  const src = process.argv[2] ?? "sabr-2026";
  if (!SRC_RE.test(src)) {
    console.error(`Invalid src "${src}" — lowercase letters, digits, hyphens only (max 64).`);
    process.exit(1);
  }
  const dest = process.argv[3] ?? `qr-${src}`;
  const url = `https://boxscore.email/r/qr?src=${src}`;

  const opts = { errorCorrectionLevel: "H" as const, margin: 2, color: { dark: "#000000", light: "#ffffff" } };
  await QRCode.toFile(`${dest}.png`, url, { ...opts, width: 1200, type: "png" });
  const svg = await QRCode.toString(url, { ...opts, type: "svg" });
  const { writeFile } = await import("node:fs/promises");
  await writeFile(`${dest}.svg`, svg, "utf8");

  console.log(`Wrote ${dest}.png (1200x1200) and ${dest}.svg`);
  console.log(`  encodes: ${url}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
