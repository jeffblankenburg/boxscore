"use client";

// Per-row toggle for /settings, styled to match the /subscribe picker (label
// wrapping checkbox + name). Instant-toggles via the same server actions
// the old toggle buttons used — we just trade the explicit button click for
// an onChange that fires the action with the appropriate "next" value.
//
// useTransition keeps the row from desyncing while the server is processing:
// the checkbox is disabled mid-flight, and the redirect from the server
// action causes a fresh page render that picks up the new defaultChecked.

import { useTransition } from "react";

export function SettingsToggleCheckbox({
  active,
  action,
  fields,
  label,
}: {
  active: boolean;
  action: (formData: FormData) => Promise<void>;
  fields: Record<string, string>;
  label: React.ReactNode;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <label className="settings-pick-label" aria-busy={pending}>
      <input
        type="checkbox"
        defaultChecked={active}
        disabled={pending}
        onChange={(e) => {
          const next = e.currentTarget.checked ? "on" : "off";
          const fd = new FormData();
          for (const [k, v] of Object.entries(fields)) fd.set(k, v);
          fd.set("next", next);
          startTransition(() => action(fd));
        }}
      />
      <span>{label}</span>
    </label>
  );
}
