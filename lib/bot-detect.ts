// Identify mailbox link scanners and other automated agents so we don't
// state-change on their behalf. List is conservative — match only well-known
// scanner UAs to avoid blocking real users. Expand as we see new offenders
// in production logs.

const BOT_UA_PATTERNS: RegExp[] = [
  // Microsoft / Office 365 SafeLinks (prefixes URLs and pre-clicks them)
  /SafeLinks/i,

  // Gmail / Google image proxy + Google's own previewers
  /GoogleImageProxy/i,
  /Google-(Read-Aloud|Site-Verification|Web-Preview)/i,

  // Enterprise mail security gateways
  /Mailmark/i,
  /Mimecast/i,
  /Proofpoint/i,
  /Barracuda/i,
  /Symantec/i,
  /urldefense/i,
  /Forcepoint/i,
  /Trend.{0,3}Micro/i,

  // Social card / chat link expanders
  /facebookexternalhit/i,
  /LinkedInBot/i,
  /Twitterbot/i,
  /Slackbot/i,
  /Discordbot/i,
  /TelegramBot/i,
  /WhatsApp/i,

  // Generic catch-alls — word-boundary anchored to avoid hitting "robot"
  // in unusual UA strings like "DuckDuckBot"
  /\bbot\b/i,
  /\bcrawler\b/i,
  /\bspider\b/i,
  /\bscanner\b/i,
  /\bheadless\b/i,
  /\bpreview\b/i,
  /\bcurl\b/i,
  /\bwget\b/i,
];

export function isLikelyBot(userAgent: string | null | undefined): boolean {
  // Missing or empty UA = bot. Every real browser sets one.
  if (!userAgent || userAgent.trim() === "") return true;
  return BOT_UA_PATTERNS.some((re) => re.test(userAgent));
}
