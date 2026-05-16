"use client";

import { useState, useCallback } from "react";

type State = "idle" | "ok" | "error";

function FlashButton({
  onClick,
  idle,
  pending,
  done,
  className,
}: {
  onClick: () => Promise<void>;
  idle: string;
  pending: string;
  done: string;
  className?: string;
}) {
  const [state, setState] = useState<State>("idle");
  const [busy, setBusy] = useState(false);
  const handleClick = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onClick();
      setState("ok");
      setTimeout(() => setState("idle"), 1800);
    } catch (err) {
      console.error(err);
      setState("error");
      setTimeout(() => setState("idle"), 2500);
    } finally {
      setBusy(false);
    }
  }, [onClick, busy]);

  const label =
    state === "ok" ? done :
    state === "error" ? "Failed — see console" :
    busy ? pending : idle;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      className={`admin-btn admin-btn-small ${className ?? ""} ${state === "ok" ? "admin-btn-ok" : ""}`}
    >
      {label}
    </button>
  );
}

export function CopyButtons({ text, imageUrl }: { text: string; imageUrl: string }) {
  // One-click hybrid: open X's compose URL with text already filled in, AND
  // put the image on the clipboard so Cmd/Ctrl+V in the new tab attaches it.
  //
  // Why split text and image instead of combining them: Twitter's paste
  // handler grabs the image from a multi-type ClipboardItem and ignores the
  // text — a Twitter-side quirk, not a clipboard limitation. Splitting the
  // channels (URL for text, clipboard for image) gets us closest to a
  // single-paste flow.
  //
  // Why open the window first: popup blockers require window.open to fire
  // synchronously from a user gesture. Awaiting fetch + clipboard first
  // loses that context in Safari.
  const tweetThis = async () => {
    const intentUrl = `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
    const win = window.open(intentUrl, "_blank", "noopener,noreferrer");
    if (!win) {
      throw new Error("Popup blocked — allow popups for this site and try again.");
    }

    if (!navigator.clipboard?.write) {
      throw new Error("Image clipboard not supported — use Download image and attach manually.");
    }
    const res = await fetch(imageUrl);
    if (!res.ok) throw new Error(`image fetch ${res.status}`);
    const blob = await res.blob();
    const imageType = blob.type || "image/png";
    await navigator.clipboard.write([
      new ClipboardItem({ [imageType]: blob }),
    ]);
  };

  return (
    <div className="copy-buttons">
      <FlashButton
        onClick={tweetThis}
        idle="Tweet this →"
        pending="Opening X…"
        done="✓ Paste image in new tab"
      />
      <a href={imageUrl} download className="admin-btn admin-btn-small admin-btn-ghost">
        Download image
      </a>
    </div>
  );
}
