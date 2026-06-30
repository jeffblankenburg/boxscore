// Server-side render templates for ad creatives. Same function powers:
//   - Admin creative previews on /admin/ads/campaigns/[id]
//   - /admin/ads/creatives/[id]/preview (in-digest splice)
//   - The real digest render path once #45 wires it into lib/render.ts
//     and lib/render-email.ts.
//
// Each format produces HTML that matches the legacy `.ad ad-<format>`
// CSS rules in globals.css and lib/ads-samples.ts — so the visual
// matches what subscribers will see in the real digest immediately,
// without a separate theming pass.

export type AdFormat =
  | "sponsor_line"
  | "standings_strip"
  | "display_box"
  | "classified";

export type Payload = Record<string, unknown>;

// ─── Slot inventory ───────────────────────────────────────────────────────
//
// Each format has a fixed set of insertion points in the digest. The admin
// stores `slot_index` as an integer (1-based) into this array per format,
// and the splice function uses the slot's `id` to know which anchor in the
// digest HTML to splice against.
//
// `emailOnly` slots are skipped when target='web' — used for spots that
// only make sense in the flat single-column email layout (between the
// AL/NL standings columns, which are two-column on the web digest).

export type Slot = {
  id: string;
  label: string;
  emailOnly?: boolean;
};

export const SLOTS: Record<AdFormat, Slot[]> = {
  sponsor_line: [
    { id: "top", label: "Top — under dateline" },
  ],
  standings_strip: [
    { id: "after_al_standings", label: "After AL standings (email only)", emailOnly: true },
    { id: "after_al_leaders", label: "After AL leaders" },
    { id: "after_nl_standings", label: "After NL standings (email only)", emailOnly: true },
    { id: "after_nl_leaders", label: "After NL leaders" },
    { id: "after_yesterdays_results", label: "After yesterday's results" },
    { id: "after_todays_games", label: "After today's games" },
  ],
  display_box: [
    // Capped at 3 because Gmail clips emails over ~102 KB; anything below
    // the third box score may not even be visible to recipients.
    { id: "after_boxscore_1", label: "After 1st box score" },
    { id: "after_boxscore_2", label: "After 2nd box score" },
    { id: "after_boxscore_3", label: "After 3rd box score" },
  ],
  classified: [
    { id: "above_transactions", label: "Above transactions block" },
  ],
};

export function slotByIndex(format: AdFormat, slotIndex: number): Slot | null {
  const slots = SLOTS[format];
  return slots[slotIndex - 1] ?? null;
}

// Strict whitelist sanitizer. The admin form's `payload` is hand-typed JSON;
// we trust it not to contain malicious content, but we still strip everything
// outside this set so a typo can't break the digest layout or leak <script>
// into the rendered email. When self-serve booking ships (#47) this same
// sanitizer protects untrusted advertiser input by construction.
const ALLOWED_TAGS = new Set(["b", "strong", "i", "em", "u", "br"]);

export function sanitizeInlineHtml(input: unknown): string {
  const s = typeof input === "string" ? input : "";
  // Replace any tag that ISN'T in ALLOWED_TAGS with escaped form. Anything
  // that doesn't parse as a tag at all (e.g. lone `<` from sloppy copy)
  // also gets escaped.
  return s.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)(\s[^>]*)?>|<|>/g, (match, tagName) => {
    if (tagName && ALLOWED_TAGS.has(String(tagName).toLowerCase())) {
      // Allowed tag — keep it but strip any attributes so `<b style="...">`
      // can't sneak styling through. `<br>` and `<br/>` both pass.
      const tag = String(tagName).toLowerCase();
      if (match.startsWith("</")) return `</${tag}>`;
      if (tag === "br") return `<br>`;
      return `<${tag}>`;
    }
    // Anything else — escape brackets to text. Allows `1 < 2` style copy
    // to render rather than being eaten as a broken tag.
    return match === "<" ? "&lt;" : match === ">" ? "&gt;" : match.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  });
}

// URL escaping for href attribute values. Allows http(s) and relative URLs;
// anything else (javascript:, data:, etc.) gets replaced with "#" so a bad
// URL can't execute. Final fallback: empty href.
export function safeHref(url: unknown): string {
  if (typeof url !== "string") return "#";
  const trimmed = url.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("/")) {
    // Escape quotes for attribute context.
    return trimmed.replace(/"/g, "&quot;");
  }
  return "#";
}

// ─── Per-format templates ─────────────────────────────────────────────────

export type RenderCreativeArgs = {
  format: AdFormat;
  payload: Payload;
  imageUrl?: string | null;
  altText?: string | null;
  // The destination URL. Callers can either pass the raw cta_url from the
  // payload, or a wrapped click-tracker URL when the click-tracking stub
  // (issue #51 follow-up) lands. The render template is agnostic.
  ctaUrl: string;
  // Defaults to "web" — uses the `.ad-*` classes from globals.css. The
  // "email" variant produces fully-inline styles matching the `.es-*`
  // visual language (no external CSS, no <style> dependency) because
  // email clients can't reliably load stylesheets and many strip class
  // attributes outright.
  target?: "web" | "email";
};

export function renderCreative(args: RenderCreativeArgs): string {
  const cta = safeHref(args.ctaUrl);
  const target = args.target ?? "web";
  if (target === "email") {
    switch (args.format) {
      case "sponsor_line":
        return renderEmailSponsorLine(args.payload, cta);
      case "standings_strip":
        return renderEmailStandingsStrip(args.payload, cta);
      case "classified":
        return renderEmailClassified(args.payload, cta);
      case "display_box":
        return renderEmailDisplayBox(args.payload, cta, args.imageUrl, args.altText);
    }
  }
  switch (args.format) {
    case "sponsor_line":
      return renderWebSponsorLine(args.payload, cta);
    case "standings_strip":
      return renderWebStandingsStrip(args.payload, cta);
    case "display_box":
      return renderWebDisplayBox(args.payload, cta, args.imageUrl, args.altText);
    case "classified":
      return renderWebClassified(args.payload, cta);
  }
}

// ─── Web variants (use .ad-* classes from globals.css) ──────────────────

function renderWebSponsorLine(payload: Payload, cta: string): string {
  const copy = sanitizeInlineHtml(payload.copy);
  return `<a class="ad ad-sponsor-line" href="${cta}" target="_blank" rel="noopener noreferrer">— ${copy} —</a>`;
}

function renderWebStandingsStrip(payload: Payload, cta: string): string {
  const headline = sanitizeInlineHtml(payload.headline).trim();
  const body = sanitizeInlineHtml(payload.body);
  // Headline (when present) gets its own centered line above the body —
  // matches the eyebrow's stacked layout. Body-only is a valid shape for
  // a quieter ad; no middot separator anywhere now.
  const headlineHtml = headline
    ? `<b class="ad-strip-headline">${headline}</b>`
    : "";
  return `<a class="ad ad-standings-strip" href="${cta}" target="_blank" rel="noopener noreferrer">
    <span class="ad-strip-eyebrow">Advertisement</span>
    <span class="ad-strip-body">${headlineHtml}${body}</span>
  </a>`;
}

function renderWebDisplayBox(
  payload: Payload,
  cta: string,
  imageUrl?: string | null,
  altText?: string | null,
): string {
  // Markup matches the hand-written samples in lib/ads-samples.ts so the
  // /admin live preview, /advertise sample tiles, and real digest
  // placements all render identically. Children are <div>s (block) with
  // an explicit .ad-display-rule between headline and body; the footer
  // class is .ad-display-foot so .ad-display-foot CSS (border-top, small
  // uppercase) actually attaches.
  const headline = sanitizeInlineHtml(payload.headline);
  const body = sanitizeInlineHtml(payload.body);
  const ctaText = sanitizeInlineHtml(payload.cta_text);
  const imageHtml =
    imageUrl && altText
      ? `<img src="${safeHref(imageUrl)}" alt="${String(altText).replace(/"/g, "&quot;")}" class="ad-display-image">`
      : "";
  return `<a class="ad ad-display-box" href="${cta}" target="_blank" rel="noopener noreferrer">
    ${imageHtml}
    <div class="ad-display-eyebrow">— Advertisement —</div>
    <div class="ad-display-headline">${headline}</div>
    <div class="ad-display-rule"></div>
    <div class="ad-display-body">${body}</div>
    ${ctaText ? `<div class="ad-display-foot">${ctaText}</div>` : ""}
  </a>`;
}

function renderWebClassified(payload: Payload, cta: string): string {
  const lead = sanitizeInlineHtml(payload.lead);
  const body = sanitizeInlineHtml(payload.body);
  return `<a class="ad ad-classified" href="${cta}" target="_blank" rel="noopener noreferrer">
    <span class="ad-classified-lead">${lead}</span>
    ${body}
  </a>`;
}

// ─── Email variants (fully inline styles for cross-client compat) ────────
//
// Borders use #c4baa5 (matches the EMAIL_STYLES hairline color); muted
// text is #6a6354 (matches `.es-mut`). Link reset on every anchor:
//   color:inherit; text-decoration:none
// — without this, Gmail/Outlook would render the ad with blue underlined
// link text regardless of any other inline color we set.

const EMAIL_AD_LINK_RESET = "color:inherit;text-decoration:none;";
const EMAIL_BORDER = "#c4baa5";
const EMAIL_MUT = "#6a6354";

function renderEmailSponsorLine(payload: Payload, cta: string): string {
  const copy = sanitizeInlineHtml(payload.copy);
  return `<a href="${cta}" target="_blank" rel="noopener noreferrer" style="display:block;${EMAIL_AD_LINK_RESET}text-align:center;font-style:italic;font-size:14px;line-height:1.5;padding:8px 12px;margin:16px 0 20px;border-top:1px solid ${EMAIL_BORDER};border-bottom:1px solid ${EMAIL_BORDER};">— ${copy} —</a>`;
}

function renderEmailStandingsStrip(payload: Payload, cta: string): string {
  const headline = sanitizeInlineHtml(payload.headline).trim();
  const body = sanitizeInlineHtml(payload.body);
  const headlineHtml = headline
    ? `<span style="display:block;font-weight:bold;letter-spacing:0.02em;margin-bottom:2px;">${headline}</span>`
    : "";
  return `<a href="${cta}" target="_blank" rel="noopener noreferrer" style="display:block;${EMAIL_AD_LINK_RESET}padding:8px 4px;margin:18px 0;border-top:1px solid ${EMAIL_BORDER};border-bottom:1px solid ${EMAIL_BORDER};font-size:13px;line-height:1.4;text-align:center;">
    <span style="display:block;font-size:9px;text-transform:uppercase;letter-spacing:0.14em;font-style:italic;color:${EMAIL_MUT};margin-bottom:4px;">Advertisement</span>
    <span style="display:block;">${headlineHtml}${body}</span>
  </a>`;
}

function renderEmailDisplayBox(
  payload: Payload,
  cta: string,
  imageUrl?: string | null,
  altText?: string | null,
): string {
  // Email twin of renderWebDisplayBox. Same content order, same hairline-
  // rule between headline and body, same border. Fully inline styles so
  // Outlook/Gmail/etc. render it identically — no class hooks survive the
  // mail client's CSS stripping. Width is fixed at 300px so the card
  // doesn't blow out narrow mobile widths; centered in-flow via auto
  // margins. Optional image sits on top.
  const headline = sanitizeInlineHtml(payload.headline);
  const body = sanitizeInlineHtml(payload.body);
  const ctaText = sanitizeInlineHtml(payload.cta_text);
  const imageHtml = imageUrl && altText
    ? `<img src="${safeHref(imageUrl)}" alt="${String(altText).replace(/"/g, "&quot;")}" style="display:block;max-width:100%;height:auto;margin:0 auto 10px;">`
    : "";
  const ctaHtml = ctaText
    ? `<div style="font-size:10.5px;text-transform:uppercase;letter-spacing:0.06em;color:${EMAIL_MUT};border-top:1px solid ${EMAIL_BORDER};padding-top:7px;margin-top:4px;">${ctaText}</div>`
    : "";
  return `<a href="${cta}" target="_blank" rel="noopener noreferrer" style="display:block;${EMAIL_AD_LINK_RESET}box-sizing:border-box;width:100%;margin:18px 0;padding:18px 22px 14px;border:1px solid ${EMAIL_BORDER};background:#ffffff;text-align:center;">
    ${imageHtml}
    <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.16em;font-style:italic;color:${EMAIL_MUT};margin-bottom:8px;">— Advertisement —</div>
    <div style="font-weight:700;font-size:22px;line-height:1.15;letter-spacing:-0.005em;margin:0 0 8px;">${headline}</div>
    <div style="width:56px;height:0;border-top:1px solid ${EMAIL_BORDER};margin:6px auto 12px;"></div>
    <div style="font-size:13.5px;line-height:1.5;text-align:center;margin-bottom:${ctaText ? "12" : "0"}px;">${body}</div>
    ${ctaHtml}
  </a>`;
}

function renderEmailClassified(payload: Payload, cta: string): string {
  const lead = sanitizeInlineHtml(payload.lead);
  const body = sanitizeInlineHtml(payload.body);
  return `<a href="${cta}" target="_blank" rel="noopener noreferrer" style="display:block;${EMAIL_AD_LINK_RESET}font-size:13px;line-height:1.4;padding:6px 0 10px;">
    <span style="font-weight:700;text-transform:uppercase;letter-spacing:0.04em;">${lead}</span> ${body}
  </a>`;
}

// ─── In-digest splice ────────────────────────────────────────────────────

// Inject a single rendered creative into the digest HTML at the chosen slot.
// The slot is looked up from SLOTS[format][slotIndex-1] and its `id` decides
// which anchor we splice against. Email-only slots are silently skipped when
// target='web' — caller can still ask for them, but they no-op on the web
// surface.
//
// Anchors documented inline next to each case. If renderContent() changes
// its DOM structure, update the corresponding regex here.

export function spliceIntoDigest(args: {
  digestHtml: string;
  format: AdFormat;
  slotIndex: number;
  creativeHtml: string;
  target: "web" | "email";
}): string {
  const slot = slotByIndex(args.format, args.slotIndex);
  if (!slot) return args.digestHtml;
  if (slot.emailOnly && args.target === "web") return args.digestHtml;

  const html = args.digestHtml;
  const c = args.creativeHtml;
  const isEmail = args.target === "email";

  // Anchor strategy: insert BEFORE the next known opening tag, rather than
  // try to match a closing tag of a variable-nesting block. Web anchors
  // use `.section` / `.games-section` / `.boxscores-title` / `.game-container`
  // / `.transactions-section`; email anchors use the `<h2 class="es-section-h">`
  // section headers from sectionH() in lib/render-email.ts.

  switch (slot.id) {
    // ─── sponsor_line ─────────────────────────────────────────────────────
    case "top":
      // Just after dateline = just before the first major content block.
      return isEmail
        ? spliceBeforeNth(html, /<h2 class="es-section-h">/g, 1, c)
        : spliceBeforeNth(
            html,
            /<div class="section">|<div class="games-section">|<p class="no-games-note">/g,
            1,
            c,
          );

    // ─── standings_strip ──────────────────────────────────────────────────
    case "after_al_standings":
      // Email-only (web no-op via emailOnly flag). Insert before AL Leaders H2.
      return spliceBeforeFirst(html, /<h2 class="es-section-h">American League Leaders<\/h2>/, c);

    case "after_al_leaders":
      // Between AL block and NL block.
      return isEmail
        ? spliceBeforeFirst(html, /<h2 class="es-section-h">National League Standings<\/h2>/, c)
        : spliceBeforeNth(html, /<div class="section">/g, 2, c);

    case "after_nl_standings":
      // Email-only. Insert before NL Leaders H2.
      return spliceBeforeFirst(html, /<h2 class="es-section-h">National League Leaders<\/h2>/, c);

    case "after_nl_leaders":
      // After both leagues, before games section.
      return isEmail
        ? spliceBeforeFirst(html, /<h2 class="es-section-h">Today's Games<\/h2>/, c)
        : spliceBeforeNth(html, /<div class="games-section">/g, 1, c);

    case "after_yesterdays_results":
      // Web only meaningful slot — email doesn't have a yesterday's-results
      // section. For email, fall back to "before Today's Games" so the ad
      // still appears reasonably close to its intended position.
      return isEmail
        ? spliceBeforeFirst(html, /<h2 class="es-section-h">Today's Games<\/h2>/, c)
        : spliceBeforeNth(html, /<div class="games-section">/g, 2, c);

    case "after_todays_games":
      // Before the box-scores header.
      return isEmail
        ? spliceBeforeFirst(html, /<h2 class="es-section-h">Yesterday's Box Scores<\/h2>/, c)
        : spliceBeforeFirst(html, /<div class="boxscores-title">Yesterday's Box Scores<\/div>/, c);

    // ─── display_box (after Nth box score) ───────────────────────────────
    // Email box scores are full batting/pitching tables — each game is
    // wrapped in <div class="es-game">. We splice the display box right
    // before the (N+1)th game wrapper so it lands between two complete
    // box scores; on web, anchor stays <div class="game-container">.
    case "after_boxscore_1":
      return isEmail
        ? spliceBeforeNth(html, /<div class="es-game">/g, 2, c)
        : spliceBeforeNth(html, /<div class="game-container">/g, 2, c);
    case "after_boxscore_2":
      return isEmail
        ? spliceBeforeNth(html, /<div class="es-game">/g, 3, c)
        : spliceBeforeNth(html, /<div class="game-container">/g, 3, c);
    case "after_boxscore_3":
      return isEmail
        ? spliceBeforeNth(html, /<div class="es-game">/g, 4, c)
        : spliceBeforeNth(html, /<div class="game-container">/g, 4, c);

    // ─── classified ───────────────────────────────────────────────────────
    case "above_transactions": {
      // Web wrapper uses .ad-classifieds-* classes (column layout, eyebrow
      // styling) defined in globals.css. Email clients don't see globals.css,
      // so the email wrapper inlines the same visual: section-header
      // matching .es-section-h, then the classified body stacked.
      const webWrapped = `<div class="ad-classifieds-block"><div class="ad-classifieds-header">Classifieds</div><div class="ad-classifieds-body">${c}</div></div>`;
      const emailWrapped =
        `<div style="margin:22px 0 6px;">
           <h2 style="font-size:20px;font-weight:800;letter-spacing:0.01em;margin:0 0 6px;padding-bottom:4px;border-bottom:2px solid #161410;">Classifieds</h2>
           <div style="font-size:13px;line-height:1.45;">${c}</div>
         </div>`;
      return isEmail
        ? spliceBeforeFirst(html, /<h2 class="es-section-h">Transactions<\/h2>/, emailWrapped)
        : spliceBeforeFirst(html, /<div class="transactions-section">/, webWrapped);
    }

    default:
      return html;
  }
}

// Insert `inject` before the first match of `pattern`. If the pattern
// doesn't match, return html unchanged (and the ad silently no-ops).
function spliceBeforeFirst(html: string, pattern: RegExp, inject: string): string {
  return html.replace(pattern, (match) => `${inject}\n${match}`);
}

// Insert `inject` before the Nth global match of `pattern`. Pattern MUST
// have the /g flag.
function spliceBeforeNth(html: string, pattern: RegExp, n: number, inject: string): string {
  let count = 0;
  return html.replace(pattern, (match) => {
    count++;
    return count === n ? `${inject}\n${match}` : match;
  });
}
