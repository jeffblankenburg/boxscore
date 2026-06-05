import type { MetadataRoute } from "next";
import { EMAIL_LINK_BASE } from "@/lib/site";

// Tells crawlers what's public and where to find the URL list. The disallow
// list is the set of token/subscriber-private routes that should never be
// indexed: /c (confirm), /u (unsubscribe), /r (tracked redirects), /share
// (share-card pages), /auth (magic-link flow), /settings (signed-in pages),
// plus /admin and the entire /api surface.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/admin",
          "/api",
          "/c/",
          "/u/",
          "/r/",
          "/share/",
          "/auth",
          "/settings",
        ],
      },
    ],
    sitemap: `${EMAIL_LINK_BASE}/sitemap.xml`,
    host: EMAIL_LINK_BASE,
  };
}
