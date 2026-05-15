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
  const copyPost = async () => {
    if (!navigator.clipboard?.write) {
      // No image-clipboard support — fall back to text-only.
      await navigator.clipboard.writeText(text);
      throw new Error(
        "Image clipboard not supported in this browser — copied text only. Download the image separately.",
      );
    }
    // Fetch the image (public Supabase Storage URL has CORS) and write a
    // single ClipboardItem with BOTH text and image. Pasting into Twitter's
    // compose box inserts the text and attaches the image in one action.
    const res = await fetch(imageUrl);
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    const blob = await res.blob();
    const imageType = blob.type || "image/png";
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/plain": new Blob([text], { type: "text/plain" }),
        [imageType]: blob,
      }),
    ]);
  };

  return (
    <div className="copy-buttons">
      <FlashButton
        onClick={copyPost}
        idle="Copy post (text + image)"
        pending="Copying…"
        done="✓ Copied — paste into X"
      />
      <a href={imageUrl} download className="admin-btn admin-btn-small admin-btn-ghost">
        Download image
      </a>
    </div>
  );
}
