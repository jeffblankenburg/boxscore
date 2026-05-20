"use client";

// Small "Copy" affordance for the announcements list. The list preview
// strips HTML + truncates, so the operator can't actually read what they
// authored from the table — this lets them yank the raw string back into
// their clipboard for editing elsewhere or pasting back into the form.

import { useState } from "react";

export function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function handleClick() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
      setTimeout(() => setState("idle"), 1500);
    } catch {
      setState("failed");
      setTimeout(() => setState("idle"), 2500);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="admin-btn admin-btn-ghost admin-btn-small"
      aria-label="Copy announcement text"
    >
      {state === "copied" ? "Copied" : state === "failed" ? "Failed" : "Copy"}
    </button>
  );
}
