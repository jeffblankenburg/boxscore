// Plain-HTML email templates. Inline styles only — no <style> blocks, no
// external stylesheets — so they render consistently across Gmail, Apple Mail,
// Outlook, etc. Visual language matches the website: cream paper, italic
// dateline, serif accents.

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

export function welcomeEmail(opts: {
  digestDate: string;
  digestPrettyDate: string;
  digestUrl: string;
  unsubscribeUrl: string;
}): { subject: string; html: string; text: string } {
  const subject = "Welcome to boxscore.email";
  const html = wrap(
    `
    <p style="font-size:16px; line-height:1.5; margin-top:24px;">
      You're in. The next daily digest will hit your inbox at <b>5am ET</b>.
    </p>
    <p style="font-size:16px; line-height:1.5;">
      In the meantime, here's the latest one — <i>${opts.digestPrettyDate}</i>:
    </p>
    ${button(opts.digestUrl, "Read today's digest →")}
    <p style="font-size:13px; color:${MUTED}; margin-top:24px;">
      Each morning you'll get yesterday's standings, line scores, full box scores, and league leaders — all in one email. No tracking pixels, no clickbait.
    </p>
    <p style="font-size:12px; color:${MUTED}; margin-top:28px; padding-top:14px; border-top:1px dotted ${RULE}; text-align:center;">
      Don't want this? <a href="${opts.unsubscribeUrl}" style="color:${MUTED};">Unsubscribe in one click</a>.
    </p>
    `,
    { previewText: `Your first digest from ${opts.digestPrettyDate} is ready.` },
  );
  const text =
    `Welcome to boxscore.email!\n\nYou're in. Daily digests arrive at 5am ET.\n\nLatest digest (${opts.digestPrettyDate}):\n${opts.digestUrl}\n\nUnsubscribe anytime: ${opts.unsubscribeUrl}`;
  return { subject, html, text };
}
