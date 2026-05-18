// Email templates.
//
// Two flavors:
//   - Short transactional emails (confirmation, simple notifications): inline
//     styles only, matched cream/italic aesthetic, ~5KB.
//   - Digest-embedded emails (welcome, daily send): include EMAIL_STYLES in
//     <head> (class-based CSS) plus the renderEmailContent() body. Sized for
//     Gmail's ~102KB cap.

import { EMAIL_STYLES } from "../render-email";
import { shortPrettyDate } from "../dates";

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
<body style="margin:0; padding:0; background:${PAPER}; ${BASE_STYLES}">
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
  digestEmailHtml: string;
}): { subject: string; html: string; text: string } {
  const subject = `Welcome — boxscore · ${opts.digestPrettyDate}`;
  const html = wrapWithDigest({
    welcomeBanner: `<p style="font-family:'Source Sans 3', Helvetica, Arial, sans-serif; font-size:15px; line-height:1.5; color:${INK}; margin:0;">
      You're in. The full digest below is for <i>${opts.digestPrettyDate}</i>. Another one will hit your inbox tomorrow morning at <b>5am&nbsp;ET</b>.
    </p>`,
    digestEmailHtml: opts.digestEmailHtml,
    unsubscribeUrl: opts.unsubscribeUrl,
    digestUrl: opts.digestUrl,
    previewText: `Welcome — your boxscore digest for ${opts.digestPrettyDate} is below.`,
  });
  const text = `Welcome to boxscore!\n\nThe full digest for ${opts.digestPrettyDate} is in this email. You'll get one every morning at 5am ET.\n\nView in browser: ${opts.digestUrl}\nUnsubscribe: ${opts.unsubscribeUrl}`;
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
  digestEmailHtml: string;
}): { subject: string; html: string; text: string } {
  const sportTag = opts.sport.toUpperCase();
  const subject = `boxscore - ${sportTag} - ${shortPrettyDate(opts.digestDate)}`;
  const html = wrapWithDigest({
    digestEmailHtml: opts.digestEmailHtml,
    unsubscribeUrl: opts.unsubscribeUrl,
    digestUrl: opts.digestUrl,
    previewText: `${opts.digestPrettyDate} · ${sportTag} digest from boxscore.`,
  });
  const text = `${subject}\n\nView in browser: ${opts.digestUrl}\nUnsubscribe: ${opts.unsubscribeUrl}`;
  return { subject, html, text };
}

/**
 * Team-scoped daily email — same chrome as dailyEmail, but the subject and
 * preview text identify the team. Used for paid subscribers who've added a
 * specific team. Body comes from renderTeamEmailContent().
 */
export function teamDailyEmail(opts: {
  teamName: string;
  digestPrettyDate: string;
  digestUrl: string;
  unsubscribeUrl: string;
  digestEmailHtml: string;
}): { subject: string; html: string; text: string } {
  const subject = `boxscore: ${opts.teamName} · ${opts.digestPrettyDate}`;
  const html = wrapWithDigest({
    digestEmailHtml: opts.digestEmailHtml,
    unsubscribeUrl: opts.unsubscribeUrl,
    digestUrl: opts.digestUrl,
    previewText: `${opts.digestPrettyDate} · ${opts.teamName} digest from boxscore.`,
  });
  const text = `boxscore — ${opts.teamName} — ${opts.digestPrettyDate}\n\nView in browser: ${opts.digestUrl}\nUnsubscribe: ${opts.unsubscribeUrl}`;
  return { subject, html, text };
}

/**
 * Used for any email that embeds a daily digest. 600px wide outer table to
 * fit the digest's content, with a thin chrome on top and bottom.
 */
function wrapWithDigest(opts: {
  welcomeBanner?: string;
  digestEmailHtml: string;
  unsubscribeUrl: string;
  digestUrl: string;
  previewText?: string;
}): string {
  const preview = opts.previewText
    ? `<div style="display:none; max-height:0; overflow:hidden; mso-hide:all;">${opts.previewText}</div>`
    : "";
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
<body style="margin:0; padding:0; background:${PAPER}; font-family:'Source Sans 3', Helvetica, Arial, sans-serif; color:${INK};">
${preview}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#fff;">
  <tr><td style="padding:8px 8px 24px;">

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
      <tr><td align="right" style="padding-bottom:6px; font-family:'Source Sans 3', Helvetica, Arial, sans-serif; font-size:11px; font-style:italic; color:${MUTED};">
        <a href="${opts.digestUrl}" style="color:${MUTED}; text-decoration:underline;">View in browser →</a>
      </td></tr>

      <tr><td style="padding-bottom:4px; border-bottom:2px solid ${INK};">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td align="left" style="vertical-align:bottom; line-height:1;">
              <a href="https://boxscore.email/" style="text-decoration:none; color:${INK}; font-weight:800; font-size:20px; letter-spacing:-0.01em; font-family:'Source Sans 3', Helvetica, Arial, sans-serif;">
                <img src="https://boxscore.email/icon.png" alt="" width="24" height="24" style="vertical-align:bottom; margin-right:6px; border-radius:4px;">boxscore
              </a>
            </td>
            <td align="right" style="vertical-align:bottom;">
              <a href="https://boxscore.email/r/support?src=email-header" style="display:inline-block; font-family:'Source Sans 3', Helvetica, Arial, sans-serif; font-size:12px; font-weight:700; background:#fff; color:${INK}; padding:5px 12px; border:1px solid ${INK}; border-radius:999px; text-decoration:none; letter-spacing:0.02em;">Support</a>
            </td>
          </tr>
        </table>
      </td></tr>

      ${opts.welcomeBanner ? `<tr><td style="padding:14px 0 8px;">${opts.welcomeBanner}</td></tr>` : ""}

      <tr><td style="padding-top:6px;">
        ${opts.digestEmailHtml}
      </td></tr>

      <tr><td style="padding-top:18px; border-top:1px solid ${RULE}; text-align:center; font-family:'Source Sans 3', Helvetica, Arial, sans-serif; font-size:12px; color:${MUTED}; font-style:italic;">
        <a href="${opts.digestUrl}" style="color:${MUTED};">View in browser</a>
        &nbsp;·&nbsp;
        <a href="${opts.unsubscribeUrl}" style="color:${MUTED};">Unsubscribe in one click</a>
      </td></tr>

      <tr><td style="padding-top:8px; text-align:center; font-family:'Source Sans 3', Helvetica, Arial, sans-serif; font-size:12px; color:${MUTED}; font-style:italic;">
        Like boxscore? <a href="https://boxscore.email/r/support?src=email-footer" style="color:${MUTED};">Leave a tip →</a>
      </td></tr>
    </table>

  </td></tr>
</table>
</body>
</html>`;
}
