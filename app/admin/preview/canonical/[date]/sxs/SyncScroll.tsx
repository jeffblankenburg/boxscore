"use client";

import { useEffect } from "react";

// Mirror scroll position between two same-origin iframes. Attaches scroll
// listeners on both contentWindows once they've loaded; whichever side
// scrolled most recently is the "active" side, and the inactive side
// follows. The 120ms timer prevents the feedback loop where the
// programmatic scroll on the follower would fire its own scroll event
// and bounce the leader back.
//
// Same-origin matters: the iframes here serve from /admin/preview/...
// on the same host as the parent page so contentWindow.scrollY and
// scrollTo work without CORS errors.

export function SyncScroll({ leftId, rightId }: { leftId: string; rightId: string }) {
  useEffect(() => {
    const left  = document.getElementById(leftId)  as HTMLIFrameElement | null;
    const right = document.getElementById(rightId) as HTMLIFrameElement | null;
    if (!left || !right) return;

    let activeSide: "left" | "right" | null = null;
    let resetTimer: number | null = null;
    const markActive = (side: "left" | "right") => {
      activeSide = side;
      if (resetTimer) window.clearTimeout(resetTimer);
      resetTimer = window.setTimeout(() => { activeSide = null; }, 120);
    };

    const cleanups: Array<() => void> = [];

    // Wait until each iframe is loaded before attaching — accessing
    // contentWindow on an in-progress nav can throw, and the addEventListener
    // would attach to a soon-to-be-discarded document anyway.
    const attach = (frame: HTMLIFrameElement, side: "left" | "right", other: HTMLIFrameElement) => {
      const wireUp = () => {
        const win = frame.contentWindow;
        if (!win) return;
        const handler = () => {
          // If the other side is currently the active scroller, this
          // event was caused by our own scrollTo — drop it on the floor.
          if (activeSide && activeSide !== side) return;
          markActive(side);
          const otherWin = other.contentWindow;
          if (!otherWin) return;
          otherWin.scrollTo({ top: win.scrollY, left: 0, behavior: "auto" });
        };
        win.addEventListener("scroll", handler, { passive: true });
        cleanups.push(() => win.removeEventListener("scroll", handler));
      };
      if (frame.contentDocument?.readyState === "complete") {
        wireUp();
      } else {
        frame.addEventListener("load", wireUp);
        cleanups.push(() => frame.removeEventListener("load", wireUp));
      }
    };

    attach(left,  "left",  right);
    attach(right, "right", left);

    return () => {
      if (resetTimer) window.clearTimeout(resetTimer);
      for (const c of cleanups) c();
    };
  }, [leftId, rightId]);

  return null;
}
