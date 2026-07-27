import { loadDailyData } from "@/lib/daily";
import { renderContent } from "@/lib/render";
import { MLB_PREVIEW_FIXTURES } from "@/lib/mlb-preview-fixtures";
import { spliceIntoDigest, type AdFormat } from "@/lib/ads-render";
import {
  SPONSOR_LINES,
  STANDINGS_STRIPS,
  DISPLAY_BOXES,
  CLASSIFIEDS,
} from "@/lib/ads-samples";

// /advertise/sample-edition — a full sample MLB edition with the house-ad
// inventory placed in every web slot, so a prospective advertiser can see
// exactly what each format looks like in context (not just as isolated
// swatches like the /advertise catalog).
//
// Renders identically to a real /mlb/[date] page — same renderer, same
// .newspaper shell, no extra chrome — just the edition, with sample ads. It
// runs renderContent() against the canonical regular-season preview fixture,
// then splices the sample creatives through the production splice engine
// (spliceIntoDigest) at the real digest anchors, so this page can't drift from
// where live ads actually land. The advertisers are the fictional house
// samples from lib/ads-samples.ts; nothing is sold or DB-backed.
//
// noindex: it's a fixture digest reachable by direct link from /advertise, not
// something we want competing with real /mlb/[date] pages in search.

export const revalidate = 3600;
export const metadata = {
  title: "Sample edition · advertise · boxscore",
  description: "A full sample boxscore edition showing every ad format in context.",
  robots: { index: false },
};

// One entry per WEB-visible slot. slotIndex is 1-based into SLOTS[format]
// (lib/ads-render.ts). Email-only strip slots (after_al/nl_standings) are
// omitted — spliceIntoDigest no-ops them on web anyway. Each slot gets a
// distinct sample advertiser so the page reads like a real, varied edition;
// the classifieds slot takes the whole bundle stacked under one header.
const PLACEMENTS: { format: AdFormat; slotIndex: number; creativeHtml: string }[] = [
  { format: "sponsor_line", slotIndex: 1, creativeHtml: SPONSOR_LINES[0]!.html }, // top — under dateline
  { format: "standings_strip", slotIndex: 2, creativeHtml: STANDINGS_STRIPS[0]!.html }, // after AL leaders
  { format: "standings_strip", slotIndex: 4, creativeHtml: STANDINGS_STRIPS[1]!.html }, // after NL leaders
  { format: "standings_strip", slotIndex: 5, creativeHtml: STANDINGS_STRIPS[2]!.html }, // after yesterday's results
  { format: "standings_strip", slotIndex: 6, creativeHtml: STANDINGS_STRIPS[0]!.html }, // after today's games (only 3 samples → reuse)
  { format: "display_box", slotIndex: 1, creativeHtml: DISPLAY_BOXES[0]!.html }, // after 1st box score
  { format: "display_box", slotIndex: 2, creativeHtml: DISPLAY_BOXES[1]!.html }, // after 2nd box score
  { format: "display_box", slotIndex: 3, creativeHtml: DISPLAY_BOXES[2]!.html }, // after 3rd box score
  { format: "classified", slotIndex: 1, creativeHtml: CLASSIFIEDS.map((c) => c.html).join("") }, // above transactions
];

export default async function SampleEditionPage() {
  const data = await loadDailyData(MLB_PREVIEW_FIXTURES.regular);

  // Splice each sample through the production engine. Ads don't contain the
  // digest's anchor classes (.section / .game-container / etc.), so ordering
  // never disturbs the Nth-match counts of later splices. A slot whose anchor
  // isn't present in this fixture silently no-ops.
  let html = renderContent(data);
  for (const p of PLACEMENTS) {
    html = spliceIntoDigest({
      digestHtml: html,
      format: p.format,
      slotIndex: p.slotIndex,
      creativeHtml: p.creativeHtml,
      target: "web",
    });
  }

  return <div className="newspaper" dangerouslySetInnerHTML={{ __html: html }} />;
}
