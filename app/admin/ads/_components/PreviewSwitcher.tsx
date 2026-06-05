"use client";

// One iframe + three controls:
//   Surface  — Web | Email
//   Size     — Mobile (400px) | Widescreen (1024px)
//   Slot     — where in the digest the creative gets spliced
//
// Both un-spliced base documents (webDoc, emailDoc) are computed
// server-side and shipped as props. The splice itself runs on the client
// in a useMemo, so switching slots is instant — no server round-trip.
// `spliceIntoDigest` is pure string manipulation and runs fine in the
// browser.

import { useMemo, useState } from "react";
import {
  SLOTS,
  spliceIntoDigest,
  type AdFormat,
} from "@/lib/ads-render";

type Surface = "web" | "email";
type Size = 400 | 1024;

export function PreviewSwitcher({
  webDoc,
  emailDoc,
  webCreativeHtml,
  emailCreativeHtml,
  format,
}: {
  webDoc: string;
  emailDoc: string;
  webCreativeHtml: string;
  emailCreativeHtml: string;
  format: AdFormat;
}) {
  const slots = SLOTS[format];
  const [surface, setSurface] = useState<Surface>("web");
  const [size, setSize] = useState<Size>(400);
  const [slotIndex, setSlotIndex] = useState<number>(1);

  const splicedDoc = useMemo(() => {
    const base = surface === "web" ? webDoc : emailDoc;
    const creativeHtml = surface === "web" ? webCreativeHtml : emailCreativeHtml;
    return spliceIntoDigest({
      digestHtml: base,
      format,
      slotIndex,
      creativeHtml,
      target: surface,
    });
  }, [surface, slotIndex, webDoc, emailDoc, webCreativeHtml, emailCreativeHtml, format]);

  const selectedSlot = slots[slotIndex - 1];
  const slotIsEmailOnly = Boolean(selectedSlot?.emailOnly);
  const showEmailOnlyWarning = slotIsEmailOnly && surface === "web";

  return (
    <>
      <div
        style={{
          display: "flex",
          gap: 16,
          alignItems: "flex-end",
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        <ControlGroup label="Surface">
          <SegmentedControl<Surface>
            options={[
              { value: "web", label: "Web" },
              { value: "email", label: "Email" },
            ]}
            value={surface}
            onChange={setSurface}
          />
        </ControlGroup>

        <ControlGroup label="Size">
          <SegmentedControl<Size>
            options={[
              { value: 400, label: "Mobile · 400px" },
              { value: 1024, label: "Widescreen · 1024px" },
            ]}
            value={size}
            onChange={setSize}
          />
        </ControlGroup>

        {/* Slot selector — only useful when the format has multiple slots.
            sponsor_line and classified each have a single slot, so a
            dropdown adds clutter without offering a choice. */}
        {slots.length > 1 && (
          <ControlGroup label="Slot">
            <select
              className="a-select"
              value={slotIndex}
              onChange={(e) => setSlotIndex(Number(e.target.value))}
              style={{ minWidth: 240 }}
            >
              {slots.map((slot, i) => (
                <option key={slot.id} value={i + 1}>
                  {slot.label}
                </option>
              ))}
            </select>
          </ControlGroup>
        )}
      </div>

      {showEmailOnlyWarning && (
        <div
          style={{
            padding: "8px 12px",
            background: "var(--a-warning-bg)",
            color: "var(--a-warning-fg)",
            border: "1px solid var(--a-warning-fg)",
            borderRadius: 6,
            marginBottom: 12,
            fontSize: 13,
          }}
        >
          This slot is email-only — the creative won't appear in the web
          preview. Switch the Surface toggle to Email to see it in context.
        </div>
      )}

      <div style={{ overflowX: "auto", paddingBottom: 8 }}>
        <iframe
          title={`${surface} preview at ${size}px`}
          srcDoc={splicedDoc}
          width={size}
          height={900}
          style={{
            border: "1px solid var(--a-border)",
            borderRadius: 6,
            background: "#fff",
            display: "block",
          }}
        />
      </div>
    </>
  );
}

function ControlGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        className="a-muted"
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        border: "1px solid var(--a-border-strong)",
        borderRadius: 6,
        overflow: "hidden",
      }}
    >
      {options.map((opt, i) => {
        const active = opt.value === value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            onClick={() => onChange(opt.value)}
            style={{
              fontFamily: "inherit",
              fontSize: 13,
              padding: "6px 14px",
              border: "none",
              borderLeft: i > 0 ? "1px solid var(--a-border-strong)" : "none",
              background: active ? "var(--a-accent)" : "var(--a-bg)",
              color: active ? "var(--a-accent-fg)" : "var(--a-text)",
              cursor: "pointer",
              fontWeight: active ? 600 : 500,
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
