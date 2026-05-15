// Email templates.
//
// Two flavors:
//   - Short transactional emails (confirmation, simple notifications): inline
//     styles only, matched cream/italic aesthetic, ~5KB.
//   - Digest-embedded emails (welcome, daily send): include EMAIL_STYLES in
//     <head> (class-based CSS) plus the renderEmailContent() body. Sized for
//     Gmail's ~102KB cap.

import { EMAIL_STYLES } from "../render-email";

const PAPER = "#f9f7f1";
const INK = "#161410";
const MUTED = "#666";
const RULE = "#c4baa5";

const BASE_STYLES = `font-family: Georgia, "Times New Roman", Times, serif; color: ${INK};`;

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
      boxscore<span style="color:${MUTED};">.</span>email
    </a>
  </div>
  ${inner}
</div>
</body>
</html>`;
}

function button(href: string, label: string): string {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 20px auto;">
    <tr><td style="background:${INK}; border-radius:999px;">
      <a href="${href}" style="display:inline-block; padding:12px 28px; color:#fff; text-decoration:none; font-weight:700; font-family:Georgia, serif; letter-spacing:0.02em;">
        ${label}
      </a>
    </td></tr>
  </table>`;
}

function pasteLink(href: string): string {
  return `<p style="font-size:13px; color:${MUTED}; line-height:1.5; word-break:break-all;">
    Or paste this link into your browser:<br>
    <a href="${href}" style="color:${INK};">${href}</a>
  </p>`;
}

export function confirmationEmail(opts: { confirmUrl: string }): { subject: string; html: string; text: string } {
  const subject = "Confirm your boxscore.email subscription";
  const html = wrap(
    `
    <p style="font-size:16px; line-height:1.5; margin-top:24px;">
      One click to start receiving the daily MLB digest:
    </p>
    ${button(opts.confirmUrl, "Confirm subscription →")}
    ${pasteLink(opts.confirmUrl)}
    <p style="font-size:12px; color:${MUTED}; margin-top:28px; padding-top:14px; border-top:1px dotted ${RULE};">
      Didn't sign up? Ignore this email and you'll never hear from us.
    </p>
    `,
    { previewText: "Click to confirm your subscription." },
  );
  const text =
    `Confirm your boxscore.email subscription.\n\nClick to start receiving the daily MLB digest:\n${opts.confirmUrl}\n\nDidn't sign up? Ignore this email.`;
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
  const subject = `Welcome — boxscore.email · ${opts.digestPrettyDate}`;
  const html = wrapWithDigest({
    welcomeBanner: `<p style="font-family:Georgia, serif; font-size:15px; line-height:1.5; color:${INK}; margin:0;">
      You're in. The full digest below is for <i>${opts.digestPrettyDate}</i>. Another one will hit your inbox tomorrow morning at <b>5am&nbsp;ET</b>.
    </p>`,
    digestEmailHtml: opts.digestEmailHtml,
    unsubscribeUrl: opts.unsubscribeUrl,
    digestUrl: opts.digestUrl,
    previewText: `Welcome — your boxscore.email digest for ${opts.digestPrettyDate} is below.`,
  });
  const text = `Welcome to boxscore.email!\n\nThe full digest for ${opts.digestPrettyDate} is in this email. You'll get one every morning at 5am ET.\n\nView in browser: ${opts.digestUrl}\nUnsubscribe: ${opts.unsubscribeUrl}`;
  return { subject, html, text };
}

/**
 * Daily email — same shell as the welcome but no welcome banner. Used by the
 * 5:15am ET send cron for every active subscriber.
 */
export function dailyEmail(opts: {
  digestPrettyDate: string;
  digestUrl: string;
  unsubscribeUrl: string;
  digestEmailHtml: string;
}): { subject: string; html: string; text: string } {
  const subject = `boxscore.email · ${opts.digestPrettyDate}`;
  const html = wrapWithDigest({
    digestEmailHtml: opts.digestEmailHtml,
    unsubscribeUrl: opts.unsubscribeUrl,
    digestUrl: opts.digestUrl,
    previewText: `${opts.digestPrettyDate} · MLB digest from boxscore.email.`,
  });
  const text = `boxscore.email — ${opts.digestPrettyDate}\n\nView in browser: ${opts.digestUrl}\nUnsubscribe: ${opts.unsubscribeUrl}`;
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
<style>${EMAIL_STYLES}</style>
</head>
<body style="margin:0; padding:0; background:${PAPER}; font-family:Georgia, serif; color:${INK};">
${preview}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${PAPER};">
  <tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px; background:#fff; margin:24px auto; padding:24px 20px; box-shadow:0 0 8px rgba(0,0,0,0.06);">

      <tr><td align="right" style="padding-bottom:6px; font-family:Georgia, serif; font-size:11px; font-style:italic; color:${MUTED};">
        <a href="${opts.digestUrl}" style="color:${MUTED}; text-decoration:underline;">View in browser →</a>
      </td></tr>

      <tr><td style="padding-bottom:10px; border-bottom:2px solid ${INK}; text-align:center;">
        <a href="https://boxscore.email/" style="text-decoration:none; color:${INK}; font-weight:800; font-size:20px; letter-spacing:-0.01em; font-family:Georgia, serif;">
          boxscore<span style="color:${MUTED};">.</span>email
        </a>
      </td></tr>

      ${opts.welcomeBanner ? `<tr><td style="padding:14px 0 8px;">${opts.welcomeBanner}</td></tr>` : ""}

      <tr><td style="padding-top:6px;">
        ${opts.digestEmailHtml}
      </td></tr>

      <tr><td style="padding-top:18px; border-top:1px solid ${RULE}; text-align:center; font-family:Georgia, serif; font-size:12px; color:${MUTED}; font-style:italic;">
        <a href="${opts.digestUrl}" style="color:${MUTED};">View in browser</a>
        &nbsp;·&nbsp;
        <a href="${opts.unsubscribeUrl}" style="color:${MUTED};">Unsubscribe in one click</a>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}
