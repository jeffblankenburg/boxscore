"use client";

import { useState } from "react";

export function CopyId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard API can fail in non-HTTPS contexts; fall back to selecting.
    }
  };
  return (
    <button type="button" onClick={onClick} className="preview-id" title="Copy preview id">
      <code>{id}</code>
      <span className="preview-id-icon">{copied ? "✓" : "⧉"}</span>
    </button>
  );
}
