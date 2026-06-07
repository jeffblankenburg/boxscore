export const BRAND = {
  name: "boxscore",
  domain: "boxscore.email",
  tagline: "the sports page for your inbox",
  subscribeUrl: "/subscribe",
  tipJarUrl: "https://ko-fi.com/jeffblankenburg",
  social: [
    { label: "Twitter", href: "https://twitter.com/boxscoreemail" },
    { label: "Bluesky", href: "https://bsky.app/profile/boxscore.email" },
    { label: "Facebook", href: "https://facebook.com/boxscore.email" },
  ],
  // Footer "legal" links. Single source of truth for both the real site
  // (rendered as JSX in app/layout.tsx) and the admin preview frame
  // (rendered as an HTML string in app/admin/preview/[sport]/frame/route.ts).
  // Tip Jar opens in a new tab; the rest are in-app navigation.
  footerLinks: [
    { label: "About", href: "/about", external: false },
    // Advertise link hidden — page is broker/private-share only. Restore
    // once we're ready for public discovery.
    // { label: "Advertise", href: "/advertise", external: false },
    { label: "RSS", href: "/rss/mlb", external: false },
    { label: "Privacy", href: "/privacy", external: false },
    { label: "Terms", href: "/terms", external: false },
    { label: "Tip Jar", href: "/r/support?src=web-footer", external: true },
  ],
} as const;
