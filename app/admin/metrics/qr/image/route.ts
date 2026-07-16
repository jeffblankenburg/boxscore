// GET /admin/metrics/qr/image?src=<label>&size=<px>&format=png|svg[&download=1]
//
// Server-side QR generator behind the admin gate. Powers both the live
// preview and the download buttons on /admin/metrics/qr. Always encodes the
// PRODUCTION /r/qr URL (via EMAIL_LINK_BASE) so a code generated from a
// preview/localhost admin still points at boxscore.email — never at the host
// the admin happened to be on.
//
// PNG for anything you drop into a layout; SVG (vector) for large-format
// print where you want infinite resolution. Error correction H so the code
// still scans with a logo overlaid or a smudged print.

import QRCode from "qrcode";
import { requireAdmin } from "../../../require-admin";
import { EMAIL_LINK_BASE } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SRC_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MIN_SIZE = 128;
const MAX_SIZE = 4096;

export async function GET(req: Request) {
  await requireAdmin();

  const url = new URL(req.url);
  const src = url.searchParams.get("src") ?? "";
  const format = url.searchParams.get("format") === "svg" ? "svg" : "png";
  const download = url.searchParams.get("download") === "1";
  const sizeRaw = Number(url.searchParams.get("size") ?? "512");
  const size = Number.isFinite(sizeRaw)
    ? Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(sizeRaw)))
    : 512;

  if (!SRC_RE.test(src)) {
    return new Response("Invalid src: lowercase letters, digits, hyphens only (max 64).", {
      status: 400,
    });
  }

  const target = `${EMAIL_LINK_BASE}/r/qr?src=${src}`;
  const opts = {
    errorCorrectionLevel: "H" as const,
    margin: 2,
    color: { dark: "#000000", light: "#ffffff" },
  };

  const headers = new Headers({ "Cache-Control": "no-store" });
  const stem = `qr-${src}${format === "png" ? `-${size}` : ""}`;
  if (download) {
    headers.set("Content-Disposition", `attachment; filename="${stem}.${format}"`);
  }

  if (format === "svg") {
    const svg = await QRCode.toString(target, { ...opts, type: "svg" });
    headers.set("Content-Type", "image/svg+xml");
    return new Response(svg, { headers });
  }

  const png = await QRCode.toBuffer(target, { ...opts, type: "png", width: size });
  headers.set("Content-Type", "image/png");
  // Uint8Array view keeps the Response body typing happy across runtimes.
  return new Response(new Uint8Array(png), { headers });
}
