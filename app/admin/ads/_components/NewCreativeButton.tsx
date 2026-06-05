"use client";

// Trigger button + modal wrapper for the new-creative form. Modal closes
// automatically on successful submit because the server action redirects
// (and the page navigates / the dialog unmounts with it). Cancel/close
// dismisses without saving.
//
// Built on the native <dialog> element — gets focus trap, Escape-to-close,
// inert-of-background, and ::backdrop for free. Backdrop styling lives in
// admin.css so a single rule covers any other dialogs we add later.
//
// This pattern is the foundation for the self-serve booking flow #47 —
// same CreativeForm, same validation, same preview, just opened from a
// public CTA instead of the admin button.

import { useRef } from "react";
import { CreativeForm } from "./CreativeForm";

export function NewCreativeButton({
  campaignId,
  returnPath,
}: {
  campaignId: string;
  returnPath: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  function open() {
    dialogRef.current?.showModal();
  }
  function close() {
    dialogRef.current?.close();
  }

  return (
    <>
      <button type="button" className="a-btn a-btn-primary" onClick={open}>
        + New creative
      </button>

      <dialog
        ref={dialogRef}
        className="a-dialog"
        onClick={(e) => {
          // Click on the backdrop (the dialog itself, not children) closes.
          // The native ::backdrop pseudo-element receives clicks on the
          // dialog node itself (because the form is inside an inner div).
          if (e.target === e.currentTarget) close();
        }}
      >
        <div className="a-dialog-inner">
          <div className="a-dialog-head">
            <h2 className="a-dialog-title">New creative</h2>
            <button
              type="button"
              className="a-btn a-btn-ghost"
              aria-label="Close"
              onClick={close}
            >
              ✕
            </button>
          </div>
          <CreativeForm
            mode="create"
            campaignId={campaignId}
            returnPath={returnPath}
          />
        </div>
      </dialog>
    </>
  );
}
