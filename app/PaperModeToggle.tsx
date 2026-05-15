"use client";

import { usePathname, useSearchParams } from "next/navigation";

// Small text toggle in the site header. Adds/removes ?paper=1.
// Only changes anything on digest pages (/mlb/...); on other pages the param
// is harmless.
export function PaperModeToggle() {
  const pathname = usePathname();
  const params = useSearchParams();
  const on = params.get("paper") === "1";

  const next = new URLSearchParams(params.toString());
  if (on) next.delete("paper"); else next.set("paper", "1");
  const query = next.toString();
  const href = query ? `${pathname}?${query}` : pathname;

  return (
    <a href={href} className="paper-toggle">
      {on ? "← Web view" : "Newspaper mode →"}
    </a>
  );
}
