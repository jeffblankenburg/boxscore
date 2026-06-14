// Game icons for the /games landing cards. Each entry returns a React
// element rendered into the 56×56 .g-card-icon slot. Currently PNG
// assets under /public — the components abstract the source so callers
// stay agnostic (we can swap to SVG later without touching page.tsx).

import type { ReactElement } from "react";

// Sizing lives in CSS at the call site (e.g. `.g-card-icon img` for the
// /games landing cards, `.time-machine-h-logo` for in-game headers).
// That way the same source PNG renders at 48px in the menu and 72px on
// the game page without prop plumbing.
function PngIcon({ src }: { src: string }): ReactElement {
  return <img src={src} alt="" draggable={false} />;
}

export function LinescordleIcon(): ReactElement {
  return <PngIcon src="/linescordle_icon.png" />;
}
export function StatSharksIcon(): ReactElement {
  return <PngIcon src="/statsharks_icon.png" />;
}
export function TimeMachineIcon(): ReactElement {
  return <PngIcon src="/timemachine_icon.png" />;
}

/** Map game slug to icon component. */
export const GAME_ICONS: Record<string, () => ReactElement> = {
  "linescordle":  LinescordleIcon,
  "statsharks":   StatSharksIcon,
  "time-machine": TimeMachineIcon,
};
