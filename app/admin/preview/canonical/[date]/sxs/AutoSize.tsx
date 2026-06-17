"use client";

import { useEffect } from "react";

// Size two same-origin iframes to fit their content so the inner scroll
// bars disappear and the parent page becomes the only scrolling surface.
// Both iframes get the SAME height (the taller of the two) so rows align
// across the side-by-side grid — the scroll-position match between the
// two panes then comes "for free" since both share the parent's scroll.
//
// Same-origin only: we reach into contentDocument to measure
// scrollHeight and to attach a ResizeObserver. The /frame route lives on
// the same host so this works without CORS errors.

export function AutoSize({ leftId, rightId }: { leftId: string; rightId: string }) {
  useEffect(() => {
    const left  = document.getElementById(leftId)  as HTMLIFrameElement | null;
    const right = document.getElementById(rightId) as HTMLIFrameElement | null;
    if (!left || !right) return;

    const cleanups: Array<() => void> = [];

    const measure = (frame: HTMLIFrameElement): number => {
      const doc = frame.contentDocument;
      if (!doc) return 0;
      // documentElement.scrollHeight is the conservative number — it
      // covers the case where the inner body has margin/padding that
      // body.scrollHeight would miss.
      return Math.max(
        doc.documentElement?.scrollHeight ?? 0,
        doc.body?.scrollHeight ?? 0,
      );
    };

    const sync = () => {
      const h = Math.max(measure(left), measure(right));
      if (h <= 0) return;
      // +2px guards against subpixel rounding that can re-trigger an
      // inner scrollbar at 1.5× zoom.
      const px = `${h + 2}px`;
      if (left.style.height  !== px) left.style.height  = px;
      if (right.style.height !== px) right.style.height = px;
    };

    const wire = (frame: HTMLIFrameElement) => {
      const onReady = () => {
        sync();
        const doc = frame.contentDocument;
        if (!doc?.body) return;
        // Catch font-load reflows, image loads, anything that changes
        // the inner document height after first paint.
        const ro = new ResizeObserver(() => sync());
        ro.observe(doc.body);
        cleanups.push(() => ro.disconnect());
      };
      if (frame.contentDocument?.readyState === "complete") {
        onReady();
      } else {
        frame.addEventListener("load", onReady);
        cleanups.push(() => frame.removeEventListener("load", onReady));
      }
    };

    wire(left);
    wire(right);

    const onWinResize = () => sync();
    window.addEventListener("resize", onWinResize);
    cleanups.push(() => window.removeEventListener("resize", onWinResize));

    return () => { for (const c of cleanups) c(); };
  }, [leftId, rightId]);

  return null;
}
