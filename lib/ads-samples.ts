// Sample advertisement inventory for the /admin/ads exploration page.
//
// These are NOT real advertisers. Nothing here is wired to a real ad system —
// no impression tracking, no click tracking, no DB row. This file is a design
// catalog used to (a) show prospective advertisers what boxscore inventory
// could look like and (b) prototype the visual integration with the digest's
// paper-mode aesthetic.
//
// Four format categories, ordered by invasiveness (least → most):
//   1. SPONSOR_LINE  — one editorial line per send
//   2. CLASSIFIED    — pure typeset text under a CLASSIFIEDS header
//   3. STANDINGS_STRIP — thin horizontal band between sections
//   4. DISPLAY_BOX   — bordered serif box, single column

export type AdFormat =
  | "sponsor-line"
  | "classified"
  | "standings-strip"
  | "display-box";

export type AdSample = {
  id: string;
  format: AdFormat;
  advertiser: string;
  // Renderer-ready HTML fragment. Uses CSS classes defined in globals.css
  // under the "Ads (admin exploration)" section.
  html: string;
};

// ─── Format 1: SPONSOR LINE ──────────────────────────────────────────────
// One italic serif line, em-dash framed. Top or bottom of the digest.
// Lowest visual cost; premium slot because it's the only ad in its position.
export const SPONSOR_LINES: AdSample[] = [
  {
    id: "sponsor-henderson",
    format: "sponsor-line",
    advertiser: "Henderson Sporting Goods",
    html: `<div class="ad ad-sponsor-line">— Today's edition brought to you by <b>Henderson Sporting Goods</b>, outfitting weekend ballplayers since 1962 —</div>`,
  },
  {
    id: "sponsor-mariola",
    format: "sponsor-line",
    advertiser: "Mariola's Italian Kitchen",
    html: `<div class="ad ad-sponsor-line">— This morning's box scores sponsored by <b>Mariola's Italian Kitchen</b>, two blocks from the ballpark —</div>`,
  },
  {
    id: "sponsor-fairview",
    format: "sponsor-line",
    advertiser: "Fairview Cigars & Lounge",
    html: `<div class="ad ad-sponsor-line">— Edition sponsored by <b>Fairview Cigars &amp; Lounge</b>, where the game's still on the radio —</div>`,
  },
  {
    id: "sponsor-kalshi",
    format: "sponsor-line",
    advertiser: "Kalshi",
    html: `<div class="ad ad-sponsor-line">— Today's edition sponsored by <b>Kalshi</b>. Trade event contracts on tonight's matchups at <i>kalshi.com</i> —</div>`,
  },
];

// ─── Format 2: CLASSIFIED LINE ADS ───────────────────────────────────────
// All-caps bold leader, then 2-3 lines of body text. Several stacked under a
// CLASSIFIEDS header. Cheapest format; sold in bulk.
export const CLASSIFIEDS: AdSample[] = [
  {
    id: "classified-batting-cages",
    format: "classified",
    advertiser: "Northgate Batting Cages",
    html: `<div class="ad ad-classified">
      <span class="ad-classified-lead">BATTING CAGES —</span>
      Northgate, open 7 days. League-rate bucket deals Mon–Thu. Bring this newsletter, $5 off any hour. (614) 555-0142.
    </div>`,
  },
  {
    id: "classified-cards",
    format: "classified",
    advertiser: "Crosstown Cards & Memorabilia",
    html: `<div class="ad ad-classified">
      <span class="ad-classified-lead">CARDS WANTED —</span>
      Crosstown Cards buying vintage commons, complete sets, unopened wax. Fair offers, cash same day. Tue–Sat, 10–6. crosstowncards.com.
    </div>`,
  },
  {
    id: "classified-glove-repair",
    format: "classified",
    advertiser: "Murray's Leather Works",
    html: `<div class="ad ad-classified">
      <span class="ad-classified-lead">GLOVE RELACING —</span>
      Murray's Leather Works. Hand-stitched repairs, two-week turnaround. Sized for Little League through adult. murrays-leather.com.
    </div>`,
  },
  {
    id: "classified-bar",
    format: "classified",
    advertiser: "The Dugout Tavern",
    html: `<div class="ad ad-classified">
      <span class="ad-classified-lead">GAMEDAY HQ —</span>
      The Dugout Tavern. Every televised game, every night. $4 drafts through the 7th inning. 1820 Westwood Ave.
    </div>`,
  },
  {
    id: "classified-tickets",
    format: "classified",
    advertiser: "MetroTickets Resale",
    html: `<div class="ad ad-classified">
      <span class="ad-classified-lead">TICKETS —</span>
      Lower-level seats, every home stand, below face. MetroTickets, locally owned since 2007. metro-tickets.com.
    </div>`,
  },
  {
    id: "classified-uniforms",
    format: "classified",
    advertiser: "Capital Custom Uniforms",
    html: `<div class="ad ad-classified">
      <span class="ad-classified-lead">TEAM UNIFORMS —</span>
      Capital Custom. Two-week turn on full sets, sublimated jerseys, embroidered caps. Quotes by email. capitaluniforms.com.
    </div>`,
  },
];

// ─── Format 3: STANDINGS STRIP ───────────────────────────────────────────
// One advertiser per thin horizontal band. Lives between game clusters or
// between AL and NL sections. Reads as a hairline divider with text inside.
export const STANDINGS_STRIPS: AdSample[] = [
  {
    id: "strip-bourbon",
    format: "standings-strip",
    advertiser: "Three Rivers Bourbon Co.",
    html: `<div class="ad ad-standings-strip">
      <span class="ad-strip-eyebrow">Advertisement</span>
      <span class="ad-strip-body"><b>THREE RIVERS BOURBON CO.</b> &nbsp;·&nbsp; Aged six years in charred oak &nbsp;·&nbsp; Find a bottle near you at <i>threeriversbourbon.com</i></span>
    </div>`,
  },
  {
    id: "strip-insurance",
    format: "standings-strip",
    advertiser: "Eastman & Reid Insurance",
    html: `<div class="ad ad-standings-strip">
      <span class="ad-strip-eyebrow">Advertisement</span>
      <span class="ad-strip-body"><b>EASTMAN &amp; REID INSURANCE</b> &nbsp;·&nbsp; Auto, home, and small-business policies since 1948 &nbsp;·&nbsp; <i>eastmanreid.com</i></span>
    </div>`,
  },
  {
    id: "strip-radio",
    format: "standings-strip",
    advertiser: "WKBR 1340 AM",
    html: `<div class="ad ad-standings-strip">
      <span class="ad-strip-eyebrow">Advertisement</span>
      <span class="ad-strip-body"><b>WKBR 1340 AM</b> &nbsp;·&nbsp; Postgame call-in show, weeknights 10 PM–midnight &nbsp;·&nbsp; <i>Tune in or stream at wkbr1340.com</i></span>
    </div>`,
  },
];

// ─── Format 4: DISPLAY BOX AD ────────────────────────────────────────────
// Bordered serif box, single column, ~280px. Slots between major sections
// (after standings, after leaders). The most expensive inventory.
export const DISPLAY_BOXES: AdSample[] = [
  {
    id: "display-greenfield",
    format: "display-box",
    advertiser: "Greenfield Lawn & Garden",
    html: `<aside class="ad ad-display-box">
      <div class="ad-display-eyebrow">— Advertisement —</div>
      <div class="ad-display-headline">Greenfield<br>Lawn &amp; Garden</div>
      <div class="ad-display-rule"></div>
      <div class="ad-display-body">
        Spring opening weekend. Heirloom tomatoes, fruit trees, and the largest selection of starter herbs in the county.
      </div>
      <div class="ad-display-foot">
        EST. 1971 &nbsp;·&nbsp; 4422 Greenfield Pike &nbsp;·&nbsp; Open daily 8–6
      </div>
    </aside>`,
  },
  {
    id: "display-cobblers",
    format: "display-box",
    advertiser: "Bishop's Shoe Repair",
    html: `<aside class="ad ad-display-box">
      <div class="ad-display-eyebrow">— Advertisement —</div>
      <div class="ad-display-headline">Bishop's<br>Shoe Repair</div>
      <div class="ad-display-rule"></div>
      <div class="ad-display-body">
        Resoling, restitching, and cleat regrips. Same-week turnaround on most jobs. Bring in this digest for 10% off your first visit.
      </div>
      <div class="ad-display-foot">
        EST. 1956 &nbsp;·&nbsp; 218 South Main Street
      </div>
    </aside>`,
  },
  {
    id: "display-bookshop",
    format: "display-box",
    advertiser: "The Westbrook Bookshop",
    html: `<aside class="ad ad-display-box">
      <div class="ad-display-eyebrow">— Advertisement —</div>
      <div class="ad-display-headline">The Westbrook<br>Bookshop</div>
      <div class="ad-display-rule"></div>
      <div class="ad-display-body">
        Sports section restocked weekly. New arrivals from Roger Angell, Buster Olney, and the Bill James Historical Abstract.
      </div>
      <div class="ad-display-foot">
        EST. 1983 &nbsp;·&nbsp; 71 Westbrook Ave &nbsp;·&nbsp; westbrookbooks.com
      </div>
    </aside>`,
  },
  {
    id: "display-kalshi",
    format: "display-box",
    advertiser: "Kalshi",
    html: `<aside class="ad ad-display-box">
      <div class="ad-display-eyebrow">— Advertisement —</div>
      <div class="ad-display-headline">Kalshi</div>
      <div class="ad-display-rule"></div>
      <div class="ad-display-body">
        The first regulated event-contract exchange. Trade the outcome of tonight's games, division races, and award votes — settled by the box scores you already read here.
      </div>
      <div class="ad-display-foot">
        Regulated by the CFTC &nbsp;·&nbsp; <i>kalshi.com</i>
      </div>
    </aside>`,
  },
];

export const ALL_AD_SAMPLES: AdSample[] = [
  ...SPONSOR_LINES,
  ...CLASSIFIEDS,
  ...STANDINGS_STRIPS,
  ...DISPLAY_BOXES,
];

export const FORMAT_META: Record<AdFormat, {
  label: string;
  oneLiner: string;
  pitch: string;
}> = {
  "sponsor-line": {
    label: "Sponsor line",
    oneLiner: "One italic serif line, em-dash framed",
    pitch: "Top or bottom of the digest. Lowest visual cost; premium slot because it's the only ad in its position.",
  },
  classified: {
    label: "Classified",
    oneLiner: "All-caps lead, three lines of body text",
    pitch: "Stacked under a CLASSIFIEDS header near the footer. Cheapest format; sold in bulk to local advertisers.",
  },
  "standings-strip": {
    label: "Standings strip",
    oneLiner: "Thin horizontal band between sections",
    pitch: "Slots between game clusters or league bands. Reads as a hairline divider with text inside; one advertiser per strip.",
  },
  "display-box": {
    label: "Display box",
    oneLiner: "Bordered serif box, single column",
    pitch: "Slots between major sections. Most expensive inventory; visual weight comparable to a small box score.",
  },
};
