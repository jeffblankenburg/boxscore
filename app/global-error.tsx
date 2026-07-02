"use client";

// Nuclear-option error boundary. Fires only when the ROOT LAYOUT itself
// throws — e.g. if the layout calls a DB helper (isSportVisible, etc.)
// that hits Supabase during an outage. `app/error.tsx` can't catch this
// because it renders INSIDE the layout; if the layout crashed, error.tsx
// never mounted.
//
// Everything here is inline-styled because our normal stylesheet lives on
// the layout tree we no longer have. Keep it tiny and self-contained.

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[boxscore global-error]", error.digest ?? "no-digest", error);
  }, [error]);

  return (
    <html lang="en">
      <head>
        <title>Rain Delay — boxscore</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body
        style={{
          margin: 0,
          padding: "40px 20px",
          fontFamily:
            "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
          background: "#fafaf7",
          color: "#1a1a1a",
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <main style={{ maxWidth: 520, width: "100%" }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#6b6b6b",
              borderTop: "3px double #1a1a1a",
              borderBottom: "1px solid #1a1a1a",
              padding: "8px 0",
              marginBottom: 20,
              textAlign: "center",
            }}
          >
            Rain Delay — Technical Difficulties
          </div>

          <h1
            style={{
              fontFamily: "'Source Sans 3', Georgia, serif",
              fontWeight: 900,
              fontSize: 28,
              letterSpacing: "-0.01em",
              margin: "0 0 12px",
            }}
          >
            Sorry — we&apos;re having technical issues.
          </h1>

          <p
            style={{
              fontFamily:
                "'Source Sans 3', -apple-system, BlinkMacSystemFont, sans-serif",
              fontSize: 15,
              lineHeight: 1.55,
              margin: "0 0 24px",
              color: "#333",
            }}
          >
            Something upstream isn&apos;t responding, so we can&apos;t render
            the page right now. This is usually short. Try again in a minute.
          </p>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={reset}
              style={{
                padding: "10px 20px",
                background: "#1a1a1a",
                color: "#fff",
                border: "none",
                borderRadius: 4,
                fontWeight: 700,
                fontSize: 14,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Try again
            </button>
            <a
              href="/"
              style={{
                padding: "10px 20px",
                background: "transparent",
                color: "#1a1a1a",
                border: "1px solid #1a1a1a",
                borderRadius: 4,
                fontWeight: 700,
                fontSize: 14,
                textDecoration: "none",
                fontFamily: "inherit",
              }}
            >
              Front page
            </a>
          </div>

          {error.digest ? (
            <p
              style={{
                marginTop: 24,
                fontSize: 11,
                color: "#8a8a8a",
                letterSpacing: "0.03em",
              }}
            >
              Ref: {error.digest}
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
