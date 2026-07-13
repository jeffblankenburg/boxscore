/** @type {import('next').NextConfig} */

// Content Security Policy — report-only for now. The digest renderer
// injects HTML via dangerouslySetInnerHTML in ~22 places (rendered from
// our own templates against known-good data, but a CSP is the seatbelt
// against a rendering bug or third-party script compromise). Vercel
// Analytics + PostHog need 'unsafe-inline' on scripts to boot, hence
// the permissive script-src; tighten with nonces later if we want to
// move to enforce mode.
const cspReportOnly = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://static.getclicky.com https://us-assets.i.posthog.com https://va.vercel-scripts.com https://cdn.vercel-insights.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://us.i.posthog.com https://us-assets.i.posthog.com https://vitals.vercel-insights.com https://in.getclicky.com https://api.actionnetwork.com",
  // 'self' (not 'none') so first-party admin tools can iframe our own pages
  // — e.g. /admin/preview embeds /admin/preview/[sport]/frame. Cross-origin
  // framing (clickjacking) is still blocked.
  "frame-ancestors 'self'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // SAMEORIGIN (not DENY) so first-party admin tools can iframe our own
  // pages (see /admin/preview). Still blocks cross-origin clickjacking.
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  // Start in report-only so we can see violations without breaking pages.
  // Flip the header name to "Content-Security-Policy" when we're confident.
  { key: "Content-Security-Policy-Report-Only", value: cspReportOnly },
];

const nextConfig = {
  async redirects() {
    return [
      {
        source: "/transactions",
        destination: "/mlb/transactions",
        permanent: true,
      },
      {
        source: "/fantasy",
        destination: "/mlb/fantasy",
        permanent: true,
      },
      {
        source: "/predictions",
        destination: "/mlb/predictions",
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
    ];
  },
};

export default nextConfig;
