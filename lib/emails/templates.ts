// Email templates.
//
// Two flavors:
//   - Short transactional emails (confirmation, simple notifications): inline
//     styles only, matched cream/italic aesthetic, ~5KB.
//   - Digest-embedded emails (welcome, daily send): include EMAIL_STYLES in
//     <head> (class-based CSS) plus the renderEmailContent() body. Sized for
//     Gmail's ~102KB cap.

import { EMAIL_STYLES } from "../render-email";
import { nextDay, prettyDate, shortPrettyDate } from "../dates";
import { EMAIL_LINK_BASE } from "../site";

// Self-hosted open-tracking pixel. The Resend pixel sits at end-of-body
// and is clipped by Gmail on the MLB league digest (~300 KB; clip at
// ~102 KB). This sits at the very top of <body>, well above the clip
// line, so opens fire for Gmail recipients too.
//
// Token is sends.open_token (UUID generated per send by the cron). The
// pixel endpoint resolves token → resend_id and writes a boxscore.opened
// event into email_events. See app/api/o/[token]/route.ts.
function openPixelTag(openToken: string | null | undefined): string {
  if (!openToken) return "";
  const url = `${EMAIL_LINK_BASE}/api/o/${openToken}`;
  // display:block is important — some clients skip display:none images.
  // border:0 and the inline dimensions cover clients that ignore the
  // <img>-attribute width/height in favor of style.
  return `<img src="${url}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;outline:none;text-decoration:none;" />`;
}

const PAPER = "#f9f7f1";
const INK = "#161410";
const MUTED = "#666";
const RULE = "#c4baa5";

const BASE_STYLES = `font-family: 'Source Sans 3', Helvetica, Arial, sans-serif; color: ${INK};`;

function wrap(inner: string, options: { previewText?: string } = {}): string {
  const preview = options.previewText
    ? `<div style="display:none; max-height:0; overflow:hidden; mso-hide:all;">${options.previewText}</div>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="margin:0; padding:0; background:${PAPER}; ${BASE_STYLES} -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; text-size-adjust:100%;">
${preview}
<div style="max-width:560px; margin:0 auto; padding:32px 24px; background:#fff; box-shadow:0 0 10px rgba(0,0,0,0.08);">
  <div style="text-align:center; padding-bottom:14px; border-bottom:1px solid ${INK};">
    <a href="https://boxscore.email/" style="text-decoration:none; color:${INK}; font-weight:800; font-size:22px; letter-spacing:-0.01em;">
      boxscore
    </a>
  </div>
  ${inner}
</div>
</body>
</html>`;
}

// Magic-link sign-in email. Same plain-prose / single-link style as the
// confirmation email — avoids the "click this big button" template that
// Apple's CS01 classifier flags. The link goes to /auth/[token] which
// shows a "Sign in" button (POST verifies); we never grant a session on
// GET, so a link-prefetcher can't claim the token.
export function magicLinkEmail(opts: { signInUrl: string }): { subject: string; html: string; text: string } {
  const subject = "Your boxscore sign-in link";
  const html = wrap(
    `
    <p style="font-size:16px; line-height:1.6; margin-top:24px;">
      Hey —
    </p>
    <p style="font-size:16px; line-height:1.6;">
      Use this link to sign in to your boxscore settings. It's good for 15 minutes and only works once.
    </p>
    <p style="font-size:16px; line-height:1.6; margin: 20px 0;">
      <a href="${opts.signInUrl}" style="color:${INK}; font-weight:700;">${opts.signInUrl}</a>
    </p>
    <p style="font-size:16px; line-height:1.6;">
      If you didn't ask for this, you can ignore it. Nothing changes until you click the link.
    </p>
    <p style="font-size:16px; line-height:1.6; margin-top:24px;">
      — Jeff<br>
      <span style="color:${MUTED};">boxscore</span>
    </p>
    `,
    { previewText: "Tap to sign in. Good for 15 minutes." },
  );
  const text =
    `Hey —\n\n` +
    `Use this link to sign in to your boxscore settings. It's good for 15 minutes and only works once.\n\n` +
    `${opts.signInUrl}\n\n` +
    `If you didn't ask for this, you can ignore it. Nothing changes until you click the link.\n\n` +
    `— Jeff\n` +
    `boxscore\n`;
  return { subject, html, text };
}

// Plain-feeling confirmation email — written to dodge Apple's CS01 content
// classifier, which flags transactional templates that look phishing-like
// (big CTA button + duplicate paste-link, "Confirm your X" subject, etc).
// We use a single hyperlink, a personal signature, and prose that reads like
// a human note instead of a marketing template.
export function confirmationEmail(opts: { confirmUrl: string }): { subject: string; html: string; text: string } {
  const subject = "Welcome to boxscore — one quick step";
  const html = wrap(
    `
    <p style="font-size:16px; line-height:1.6; margin-top:24px;">
      Hey —
    </p>
    <p style="font-size:16px; line-height:1.6;">
      You just signed up for boxscore. One last step before I start sending you the morning paper:
    </p>
    <p style="font-size:16px; line-height:1.6; margin: 20px 0;">
      <a href="${opts.confirmUrl}" style="color:${INK}; font-weight:700;">${opts.confirmUrl}</a>
    </p>
    <p style="font-size:16px; line-height:1.6;">
      That's it. Tomorrow morning at 5am ET you'll get yesterday's MLB games in your inbox — standings, leaders, full box scores, just like the old sports page.
    </p>
    <p style="font-size:16px; line-height:1.6;">
      If this wasn't you, no worries. Just ignore it and your address won't end up on anything.
    </p>
    <p style="font-size:16px; line-height:1.6; margin-top:24px;">
      — Jeff<br>
      <span style="color:${MUTED};">boxscore</span>
    </p>
    `,
    { previewText: "One quick step to start your morning paper." },
  );
  const text =
    `Hey —\n\n` +
    `You just signed up for boxscore. One last step before I start sending you the morning paper:\n\n` +
    `${opts.confirmUrl}\n\n` +
    `That's it. Tomorrow morning at 5am ET you'll get yesterday's MLB games in your inbox — standings, leaders, full box scores, just like the old sports page.\n\n` +
    `If this wasn't you, no worries. Just ignore it and your address won't end up on anything.\n\n` +
    `— Jeff\n` +
    `boxscore\n`;
  return { subject, html, text };
}

/**
 * Welcome email = brief greeting + the embedded digest body. The digest HTML
 * is the email-safe version produced by lib/render-email.ts (table-based,
 * inline-styled). We pad it with a slim welcome banner above and a footer
 * with unsubscribe + view-in-browser below.
 */
export function welcomeEmail(opts: {
  digestPrettyDate: string;
  digestUrl: string;
  unsubscribeUrl: string;
  manageUrl: string;
  gamesUrl: string;
  tipJarUrl: string;
  digestEmailHtml: string;
  openToken?: string | null;
}): { subject: string; html: string; text: string } {
  const subject = `Welcome — boxscore · ${opts.digestPrettyDate}`;
  const html = wrapWithDigest({
    welcomeBanner: `<p style="font-family:'Source Sans 3', Helvetica, Arial, sans-serif; font-size:15px; line-height:1.5; color:${INK}; margin:0;">
      You're in. The full digest below is for <i>${opts.digestPrettyDate}</i>. Another one will hit your inbox tomorrow morning at <b>5am&nbsp;ET</b>.
    </p>`,
    digestEmailHtml: opts.digestEmailHtml,
    unsubscribeUrl: opts.unsubscribeUrl,
    digestUrl: opts.digestUrl,
    manageUrl: opts.manageUrl,
    gamesUrl: opts.gamesUrl,
    tipJarUrl: opts.tipJarUrl,
    openToken: opts.openToken,
    previewText: `Welcome — your boxscore digest for ${opts.digestPrettyDate} is below.`,
  });
  const text = `Welcome to boxscore!\n\nThe full digest for ${opts.digestPrettyDate} is in this email. You'll get one every morning at 5am ET.\n\nRead online: ${opts.digestUrl}\nManage subscriptions: ${opts.manageUrl}\nUnsubscribe: ${opts.unsubscribeUrl}`;
  return { subject, html, text };
}

/**
 * Daily email — same shell as the welcome but no welcome banner. Used by the
 * 5:15am ET send cron for every active subscriber.
 *
 * `sport` becomes the league/sport tag in the subject line (e.g. "MLB"). Once
 * we add more sports/leagues the caller will pass the right value per send.
 */
export function dailyEmail(opts: {
  sport: string;
  digestDate: string;          // ISO "YYYY-MM-DD" of the digest
  digestPrettyDate: string;    // long form, used in preview text + plain-text body
  digestUrl: string;
  unsubscribeUrl: string;
  manageUrl: string;
  gamesUrl: string;
  tipJarUrl: string;
  digestEmailHtml: string;
  announcementBanner?: string; // optional product/feature note prepended
                                // above the digest body
  openToken?: string | null;   // injected as a 1x1 pixel at the top of <body>
}): { subject: string; html: string; text: string } {
  const sportTag = opts.sport.toUpperCase();
  // Subject + preview text use the EDITION date (the day the email arrives)
  // so the inbox header matches the masthead inside the body. digestDate
  // is games_date; nextDay() shifts to edition date.
  const editionDateIso = nextDay(opts.digestDate);
  const subject = `${sportTag} - ${shortPrettyDate(editionDateIso)}`;
  const html = wrapWithDigest({
    digestEmailHtml: opts.digestEmailHtml,
    unsubscribeUrl: opts.unsubscribeUrl,
    digestUrl: opts.digestUrl,
    manageUrl: opts.manageUrl,
    gamesUrl: opts.gamesUrl,
    tipJarUrl: opts.tipJarUrl,
    announcementBanner: opts.announcementBanner,
    openToken: opts.openToken,
    previewText: `${prettyDate(editionDateIso)} · ${sportTag} digest from boxscore.`,
  });
  const text = `${subject}\n\nRead online: ${opts.digestUrl}\nManage subscriptions: ${opts.manageUrl}\nUnsubscribe: ${opts.unsubscribeUrl}`;
  return { subject, html, text };
}

/**
 * Team-scoped daily email — same chrome as dailyEmail, but the subject and
 * preview text identify the team. Used for paid subscribers who've added a
 * specific team. Body comes from renderTeamEmailContent().
 */
export function teamDailyEmail(opts: {
  teamName: string;
  digestDate: string;          // ISO "YYYY-MM-DD" of the digest
  digestPrettyDate: string;    // long form, used in preview text
  digestUrl: string;
  unsubscribeUrl: string;
  manageUrl: string;
  gamesUrl: string;
  tipJarUrl: string;
  digestEmailHtml: string;
  announcementBanner?: string;
  openToken?: string | null;
}): { subject: string; html: string; text: string } {
  // Sender name already shows "boxscore", so the subject leads with the
  // distinguishing label ({team name} or {sport}) — keeps the inbox preview
  // free of redundant brand text. Subject + preview text use the EDITION
  // date (digestDate + 1) so they match the masthead inside the body.
  const editionDateIso = nextDay(opts.digestDate);
  const subject = `${opts.teamName} - ${shortPrettyDate(editionDateIso)}`;
  const html = wrapWithDigest({
    digestEmailHtml: opts.digestEmailHtml,
    unsubscribeUrl: opts.unsubscribeUrl,
    digestUrl: opts.digestUrl,
    manageUrl: opts.manageUrl,
    gamesUrl: opts.gamesUrl,
    tipJarUrl: opts.tipJarUrl,
    announcementBanner: opts.announcementBanner,
    openToken: opts.openToken,
    previewText: `${prettyDate(editionDateIso)} · ${opts.teamName} digest from boxscore.`,
  });
  const text = `${subject}\n\nRead online: ${opts.digestUrl}\nManage subscriptions: ${opts.manageUrl}\nUnsubscribe: ${opts.unsubscribeUrl}`;
  return { subject, html, text };
}

/**
 * Used for any email that embeds a daily digest. 600px wide outer table to
 * fit the digest's content, with a thin chrome on top and bottom.
 *
 * manageUrl points at /settings — surfaced in the TOP utility row alongside
 * "View in browser" because Gmail clips messages above ~102KB; anything
 * subscribers might actually click (preferences, sign-in) has to live above
 * the digest body so it survives the clip threshold.
 */
function wrapWithDigest(opts: {
  welcomeBanner?: string;
  announcementBanner?: string;
  digestEmailHtml: string;
  unsubscribeUrl: string;
  digestUrl: string;
  manageUrl: string;
  gamesUrl: string;
  tipJarUrl: string;
  previewText?: string;
  // UUID written to sends.open_token at send time. When present, a 1x1
  // tracking pixel pointing at /api/o/<openToken> is injected at the
  // very top of <body> — above the Gmail clip line.
  openToken?: string | null;
}): string {
  const preview = opts.previewText
    ? `<div style="display:none; max-height:0; overflow:hidden; mso-hide:all;">${opts.previewText}</div>`
    : "";
  const pixel = openPixelTag(opts.openToken);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Source+Sans+3:ital,wght@0,200..900;1,200..900&display=swap">
<style>${EMAIL_STYLES}</style>
</head>
<body style="margin:0; padding:0; background:${PAPER}; font-family:'Source Sans 3', Helvetica, Arial, sans-serif; color:${INK}; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; text-size-adjust:100%;">
${pixel}${preview}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#fff;">
  <tr><td style="padding:8px 8px 24px;">

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
      <tr><td style="padding-bottom:4px; border-bottom:2px solid ${INK};">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td align="left" style="vertical-align:bottom; line-height:1;">
              <a href="${opts.digestUrl}" style="text-decoration:none; color:${INK}; font-weight:800; font-size:20px; letter-spacing:-0.01em; font-family:'Source Sans 3', Helvetica, Arial, sans-serif;">
                <img src="https://boxscore.email/icon.png" alt="" width="24" height="24" style="vertical-align:bottom; margin-right:6px; border-radius:4px;">boxscore
              </a>
            </td>
            <td align="right" style="vertical-align:bottom; white-space:nowrap;">
              <a href="${opts.gamesUrl}" style="display:inline-block; font-family:'Source Sans 3', Helvetica, Arial, sans-serif; font-size:11px; font-weight:700; background:#fff; color:${INK}; padding:3px 10px; border:1px solid ${INK}; border-radius:999px; text-decoration:none; letter-spacing:0.02em; margin-right:4px;">Games</a><a href="${opts.tipJarUrl}" style="display:inline-block; font-family:'Source Sans 3', Helvetica, Arial, sans-serif; font-size:11px; font-weight:700; background:#fff; color:${INK}; padding:3px 10px; border:1px solid ${INK}; border-radius:999px; text-decoration:none; letter-spacing:0.02em; margin-right:4px;">Tip Jar</a><a href="${opts.manageUrl}" style="display:inline-block; font-family:'Source Sans 3', Helvetica, Arial, sans-serif; font-size:11px; font-weight:700; background:#fff; color:${INK}; padding:3px 10px; border:1px solid ${INK}; border-radius:999px; text-decoration:none; letter-spacing:0.02em;">Settings</a>
            </td>
          </tr>
        </table>
      </td></tr>

      ${opts.welcomeBanner ? `<tr><td style="padding:14px 0 8px;">${opts.welcomeBanner}</td></tr>` : ""}

      ${opts.announcementBanner ? `<tr><td style="padding:14px 0 8px; border-bottom:1px solid ${RULE};">
        ${opts.announcementBanner}
      </td></tr>` : ""}

      <tr><td style="padding-top:6px;">
        ${opts.digestEmailHtml}
      </td></tr>

      <tr><td style="padding-top:18px; border-top:1px solid ${RULE}; text-align:center; font-family:'Source Sans 3', Helvetica, Arial, sans-serif; font-size:12px; color:${MUTED}; font-style:italic;">
        <a href="${opts.unsubscribeUrl}" style="color:${MUTED};">Unsubscribe in one click</a>
      </td></tr>

      <tr><td style="padding-top:8px; text-align:center; font-family:'Source Sans 3', Helvetica, Arial, sans-serif; font-size:12px; color:${MUTED}; font-style:italic;">
        Like boxscore? <a href="https://boxscore.email/r/support?src=email-footer" style="color:${MUTED};">Leave a tip →</a>
      </td></tr>

      <tr><td style="padding-top:4px; text-align:center; font-family:'Source Sans 3', Helvetica, Arial, sans-serif; font-size:12px; color:${MUTED}; font-style:italic;">
        Want to reach this audience? <a href="https://boxscore.email/advertise" style="color:${MUTED};">Advertise with us →</a>
      </td></tr>
    </table>

  </td></tr>
</table>
</body>
</html>`;
}
