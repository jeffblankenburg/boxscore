"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { Platform } from "@/lib/social-followers";

// Debounced auto-save for the notes column. Save fires 700ms after the last
// keystroke so the operator doesn't get hit with a network round-trip on
// every character. Status pill flashes "saved" briefly so they know the
// write went through; on failure it sticks with "error" until the next edit
// so a silent backend issue can't masquerade as success.

const DEBOUNCE_MS = 700;
const SAVED_FLASH_MS = 1500;

type Status = "idle" | "dirty" | "saving" | "saved" | "error";

type Props = {
  platform: Platform;
  handle: string;
  defaultValue: string;
  action: (formData: FormData) => Promise<void>;
};

export function NotesField({ platform, handle, defaultValue, action }: Props) {
  const [value, setValue] = useState(defaultValue);
  const [status, setStatus] = useState<Status>("idle");
  const [, startTransition] = useTransition();
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef(defaultValue);

  // Clear pending timers on unmount so a save scheduled by a row that
  // disappeared (e.g. after re-sort) doesn't fire against stale state.
  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      if (savedTimer.current) clearTimeout(savedTimer.current);
    };
  }, []);

  const save = (next: string) => {
    if (next === lastSaved.current) {
      setStatus("idle");
      return;
    }
    setStatus("saving");
    const fd = new FormData();
    fd.set("platform", platform);
    fd.set("handle", handle);
    fd.set("notes", next);
    startTransition(async () => {
      try {
        await action(fd);
        lastSaved.current = next;
        setStatus("saved");
        if (savedTimer.current) clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(() => setStatus("idle"), SAVED_FLASH_MS);
      } catch {
        setStatus("error");
      }
    });
  };

  const onChange = (next: string) => {
    setValue(next);
    setStatus("dirty");
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => save(next), DEBOUNCE_MS);
  };

  // Save on blur in addition to debounce — covers the case where the operator
  // tabs/clicks away before the debounce fires.
  const onBlur = () => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    save(value);
  };

  return (
    <div className="fl-notes-field">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        rows={2}
        placeholder="—"
      />
      <span className={`fl-notes-status fl-notes-status-${status}`}>
        {status === "saving" ? "saving…"
          : status === "saved" ? "saved"
          : status === "error" ? "save failed"
          : ""}
      </span>
    </div>
  );
}
