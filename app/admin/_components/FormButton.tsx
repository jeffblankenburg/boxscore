"use client";

import { useFormStatus } from "react-dom";

// Submit button for server-action forms in the new admin shell. Replaces
// the old SubmitButton.tsx (which used the now-deprecated `admin-btn` class).
// Shows a "pending" label and disables the button while the action is
// in-flight, courtesy of useFormStatus().

export function FormButton({
  idleLabel,
  pendingLabel,
  variant = "default",
}: {
  idleLabel: string;
  pendingLabel: string;
  variant?: "default" | "primary" | "danger";
}) {
  const { pending } = useFormStatus();
  const cls =
    variant === "primary"
      ? "a-btn a-btn-primary"
      : variant === "danger"
        ? "a-btn a-btn-danger"
        : "a-btn";
  return (
    <button type="submit" className={cls} disabled={pending} aria-busy={pending}>
      {pending ? pendingLabel : idleLabel}
    </button>
  );
}
