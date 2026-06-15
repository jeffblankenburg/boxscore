import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { notFound } from "next/navigation";
import { requireAdmin } from "../../../../require-admin";
import { supabaseAdmin } from "@/lib/supabase";
import { renderCreative, type AdFormat, type Payload } from "@/lib/ads-render";
import { loadDailyData } from "@/lib/daily";
import { renderContent } from "@/lib/render";
import { renderEmailContent } from "@/lib/render-email";
import { dailyEmail } from "@/lib/emails/templates";
import { MLB_PREVIEW_FIXTURES } from "@/lib/mlb-preview-fixtures";
import { nextDay, prettyDate } from "@/lib/dates";
import { EMAIL_LINK_BASE } from "@/lib/site";
import { BRAND } from "@/lib/brand";
import { PageHeader } from "../../../../_components/primitives";
import { PreviewSwitcher } from "../../../_components/PreviewSwitcher";

// /admin/ads/creatives/[id]/preview — single iframe + toggles for surface
// (Web / Email) and viewport size (Mobile 400 / Widescreen 1024).
//
// Critical for fidelity:
//
//   - Web doc:   renderContent() from lib/render.ts (same call /mlb/[date]
//                makes), wrapped in a full <html> with globals.css inlined
//                + an explicit Source Sans 3 <link> so the iframe loads
//                the same fonts the production page does.
//
//   - Email doc: renderEmailContent() from lib/render-email.ts (same call
//                the daily send cron makes), then dailyEmail() to wrap it
//                in the full template including EMAIL_STYLES — that's
//                what Resend actually delivers.

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Creative preview · boxscore admin",
  robots: { index: false },
};

type Creative = {
  id: string;
  format: AdFormat;
  payload: Payload;
  image_blob_url: string | null;
  alt_text: string | null;
  campaign_id: string;
};

async function loadCreative(id: string): Promise<Creative | null> {
  const { data, error } = await supabaseAdmin()
    .from("ad_creatives")
    .select("id, format, payload, image_blob_url, alt_text, campaign_id")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`load creative: ${error.message}`);
  return data as Creative | null;
}

async function loadGlobalsCss(): Promise<string> {
  // Read at request time so dev edits show up without a rebuild. The file
  // is in the deployment bundle on Vercel too.
  return readFile(join(process.cwd(), "app", "globals.css"), "utf-8");
}

function wrapWebDoc(spliced: string, globalsCss: string): string {
  // Explicit Source Sans 3 link — globals.css does `@import` it at the
  // top, but inline <style> doesn't always trigger `@import` reliably in
  // sandboxed iframe contexts. Adding the <link> belt-and-suspenders so
  // the font actually loads.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Preview</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Source+Sans+3:ital,wght@0,200..900;1,200..900&display=swap" rel="stylesheet">
<style>${globalsCss}</style>
</head>
<body>
<div class="newspaper">${spliced}</div>
</body>
</html>`;
}

export default async function CreativePreviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;

  const creative = await loadCreative(id);
  if (!creative) notFound();

  const gamesDate = MLB_PREVIEW_FIXTURES.regular;
  const [data, globalsCss] = await Promise.all([
    loadDailyData(gamesDate),
    loadGlobalsCss(),
  ]);

  const ctaUrl =
    typeof creative.payload.cta_url === "string"
      ? creative.payload.cta_url
      : "#";

  // Render the creative twice — once for each surface — because the email
  // variant uses inline styles (email clients can't load globals.css), and
  // the web variant uses the `.ad-*` class hooks from globals.css. Both
  // get shipped to the PreviewSwitcher; the client picks the right one
  // based on the active Surface toggle.
  const webCreativeHtml = renderCreative({
    format: creative.format,
    payload: creative.payload,
    imageUrl: creative.image_blob_url,
    altText: creative.alt_text,
    ctaUrl,
    target: "web",
  });
  const emailCreativeHtml = renderCreative({
    format: creative.format,
    payload: creative.payload,
    imageUrl: creative.image_blob_url,
    altText: creative.alt_text,
    ctaUrl,
    target: "email",
  });

  // Build the un-spliced base documents. The PreviewSwitcher client
  // component does the splice in the browser based on the selected slot,
  // so changing slots doesn't require a server round-trip. The splice
  // function is pure string manipulation — fast on the client.
  //
  // Anchors live inside the wrapped HTML, so wrapping first / splicing
  // second works the same as the original splice-then-wrap order.
  const webDoc = wrapWebDoc(renderContent(data), globalsCss);
  const { html: emailDoc } = dailyEmail({
    sport: "mlb",
    digestDate: gamesDate,
    digestPrettyDate: prettyDate(gamesDate),
    digestUrl: `${EMAIL_LINK_BASE}/mlb/${nextDay(gamesDate)}`,
    unsubscribeUrl: `${EMAIL_LINK_BASE}/u/preview`,
    manageUrl: `${EMAIL_LINK_BASE}/settings`,
    gamesUrl: `${EMAIL_LINK_BASE}/games`,
    tipJarUrl: BRAND.tipJarUrl,
    digestEmailHtml: renderEmailContent(data),
  });

  return (
    <>
      <PageHeader
        title="Preview"
        subtitle={`Same renderers the production digests use: lib/render.ts (web) and lib/render-email.ts (email). Spliced into the ${gamesDate} MLB preview fixture at slot 1 (${creative.format}).`}
        breadcrumbs={[
          { label: "Ads", href: "/admin/ads" },
          { label: "Campaigns", href: "/admin/ads" },
          {
            label: "Campaign",
            href: `/admin/ads/campaigns/${creative.campaign_id}`,
          },
          { label: "Preview" },
        ]}
        actions={
          <a
            href={`/admin/ads/campaigns/${creative.campaign_id}`}
            className="a-btn"
          >
            Back to campaign
          </a>
        }
      />

      <PreviewSwitcher
        webDoc={webDoc}
        emailDoc={emailDoc}
        webCreativeHtml={webCreativeHtml}
        emailCreativeHtml={emailCreativeHtml}
        format={creative.format}
      />
    </>
  );
}
