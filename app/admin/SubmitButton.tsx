"use client";

import { useFormStatus } from "react-dom";

// Submit button that swaps its label and disables itself while the parent
// form's server action is in-flight. Lives in a Client Component so it can
// use useFormStatus(); the rest of the admin pages stay server-rendered.

export function SubmitButton({
  idleLabel,
  pendingLabel,
}: {
  idleLabel: string;
  pendingLabel: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      className="admin-btn"
      type="submit"
      disabled={pending}
      aria-busy={pending}
    >
      {pending ? pendingLabel : idleLabel}
    </button>
  );
}
