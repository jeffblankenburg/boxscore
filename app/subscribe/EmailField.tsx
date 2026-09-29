"use client";

import { useRef, useState } from "react";
import { validateEmail } from "@/lib/email-validate";

// Email input with live validation, using the SAME validateEmail as the server
// action so the field and the action can't drift. Blocks submit (via
// setCustomValidity) on an address that can't deliver — bad format or a TLD
// that doesn't exist (foo@bar.con). Accepts any valid address otherwise.
export function EmailField() {
  const ref = useRef<HTMLInputElement>(null);
  const [showError, setShowError] = useState(false);

  function check(value: string, reveal: boolean) {
    const input = ref.current;
    const v = value.trim();
    if (v === "") {
      input?.setCustomValidity("");
      setShowError(false);
      return;
    }
    const { ok } = validateEmail(v);
    input?.setCustomValidity(ok ? "" : "Please enter a valid email address.");
    if (reveal) setShowError(!ok);
    else if (ok) setShowError(false);
  }

  return (
    <>
      <input
        ref={ref}
        type="email"
        name="email"
        required
        placeholder="you@yourdomain.com"
        autoComplete="email"
        className="subscribe-input subscribe-input-block"
        aria-label="Email address"
        // Validate as they type (clears the error the moment it's fixed) but
        // only reveal the message on blur, so we don't scold mid-typing.
        onInput={(e) => check(e.currentTarget.value, false)}
        onBlur={(e) => check(e.currentTarget.value, true)}
      />
      {showError && (
        <p className="subscribe-error" role="alert">
          Please enter a valid email address.
        </p>
      )}
    </>
  );
}
