export const BRAND = {
  name: "boxscore",
  domain: "boxscore.email",
  tagline: "the sports page for your inbox",
  subscribeUrl: "/subscribe",
  tipJarUrl: "https://ko-fi.com/jeffblankenburg",
  // `slug` keys the brand-icon lookup in app/brand-icons.tsx. `label`
  // stays human-readable for aria-label and the JSON-LD sameAs[].
  social: [
    { slug: "x",        label: "X",        href: "https://twitter.com/boxscoreemail" },
    { slug: "bluesky",  label: "Bluesky",  href: "https://bsky.app/profile/boxscore.email" },
    { slug: "facebook", label: "Facebook", href: "https://facebook.com/boxscore.email" },
    { slug: "discord",  label: "Discord",  href: "https://discord.gg/ZskVxQq7yk" },
  ],
  // Footer "legal" links. Single source of truth for both the real site
  // (rendered as JSX in app/layout.tsx) and the admin preview frame
  // (rendered as an HTML string in app/admin/preview/[sport]/frame/route.ts).
  // Tip Jar opens in a new tab; the rest are in-app navigation.
  footerLinks: [
    { label: "About", href: "/about", external: false },
    { label: "Advertise", href: "/advertise", external: false },
    { label: "RSS", href: "/rss/mlb", external: false },
    { label: "Privacy", href: "/privacy", external: false },
    { label: "Terms", href: "/terms", external: false },
    { label: "Tip Jar", href: "/r/support?src=web-footer", external: true },
  ],
} as const;
