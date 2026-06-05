"use client";

// Two modes:
//   create — shown in the "+ New creative" section. Format dropdown is
//            editable and drives the payload template. Submit button calls
//            createCreative server action.
//   edit   — shown per-existing-creative. Format is fixed (changing it
//            would invalidate placements). Payload textarea auto-saves
//            (500ms debounce) whenever the JSON is valid and differs from
//            the last-saved value — no submit button.
//
// Both modes render a live preview on the right that updates instantly as
// the textarea changes. renderCreative is pure string manipulation, safe
// to call client-side.

import { useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { renderCreative, type AdFormat, type Payload } from "@/lib/ads-render";
import { createCreative, saveCreativeUpdates } from "../actions";

const TEMPLATES: Record<AdFormat, string> = {
  sponsor_line: JSON.stringify(
    {
      copy: "Today's edition brought to you by <b>Advertiser Name</b>, doing X since YYYY",
      cta_url: "https://advertiser.example.com",
    },
    null,
    2,
  ),
  standings_strip: JSON.stringify(
    {
      headline: "ADVERTISER NAME",
      body: "Tagline · Find us at advertiser.example.com",
      cta_url: "https://advertiser.example.com",
    },
    null,
    2,
  ),
  display_box: JSON.stringify(
    {
      headline: "Advertiser Name",
      body: "Two-sentence pitch that reads like a small-paper display ad.",
      cta_text: "Shop at advertiser.example.com",
      cta_url: "https://advertiser.example.com",
    },
    null,
    2,
  ),
  classified: JSON.stringify(
    {
      lead: "CATEGORY —",
      body: "One-line classified copy with a phone number or URL at the end.",
      cta_url: "https://advertiser.example.com",
    },
    null,
    2,
  ),
};

const FORMAT_LABELS: Record<AdFormat, string> = {
  sponsor_line: "Sponsor line",
  standings_strip: "Standings strip",
  display_box: "Display box",
  classified: "Classified",
};

type Props =
  | {
      mode: "create";
      campaignId: string;
      returnPath: string;
    }
  | {
      mode: "edit";
      creativeId: string;
      format: AdFormat;
      initialPayload: string;
      initialImageUrl: string | null;
      initialAltText: string | null;
      returnPath: string;
    };

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: number }
  | { kind: "error"; message: string };

function tryParse(s: string): Payload | null {
  try {
    const v = JSON.parse(s);
    if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
    return v as Payload;
  } catch {
    return null;
  }
}

export function CreativeForm(props: Props) {
  const [format, setFormat] = useState<AdFormat>(
    props.mode === "edit" ? props.format : "sponsor_line",
  );
  const [payload, setPayload] = useState<string>(
    props.mode === "edit" ? props.initialPayload : TEMPLATES.sponsor_line,
  );
  const [imageUrl, setImageUrl] = useState<string>(
    props.mode === "edit" ? (props.initialImageUrl ?? "") : "",
  );
  const [altText, setAltText] = useState<string>(
    props.mode === "edit" ? (props.initialAltText ?? "") : "",
  );
  const [showImageFields, setShowImageFields] = useState<boolean>(
    Boolean(imageUrl),
  );

  // Track what the server last knows about, so auto-save can detect dirty.
  const [lastSavedPayload, setLastSavedPayload] = useState<string>(
    props.mode === "edit" ? props.initialPayload : "",
  );
  const [lastSavedImageUrl, setLastSavedImageUrl] = useState<string>(
    props.mode === "edit" ? (props.initialImageUrl ?? "") : "",
  );
  const [lastSavedAltText, setLastSavedAltText] = useState<string>(
    props.mode === "edit" ? (props.initialAltText ?? "") : "",
  );

  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });

  const parsed = useMemo(() => tryParse(payload), [payload]);
  const validJson = parsed !== null;

  // Live-rendered preview. Pure string render of the *current* in-memory
  // state — updates on every keystroke that produces valid JSON. Falls
  // back to a placeholder when invalid.
  const previewHtml = useMemo(() => {
    if (!parsed) return null;
    const cta = typeof parsed.cta_url === "string" ? parsed.cta_url : "#";
    return renderCreative({
      format,
      payload: parsed,
      imageUrl: imageUrl || null,
      altText: altText || null,
      ctaUrl: cta,
    });
  }, [format, parsed, imageUrl, altText]);

  // Auto-save effect (edit mode only). Debounces 500ms after the last
  // change, then calls saveCreativeUpdates. Cleanup cancels in-flight
  // timers if the input changes again before the timer fires.
  const creativeId = props.mode === "edit" ? props.creativeId : null;
  useEffect(() => {
    if (props.mode !== "edit") return;
    if (!validJson) return;
    if (
      payload === lastSavedPayload &&
      imageUrl === lastSavedImageUrl &&
      altText === lastSavedAltText
    ) return;

    const handle = setTimeout(async () => {
      setSaveState({ kind: "saving" });
      const result = await saveCreativeUpdates({
        creativeId: creativeId!,
        payload,
        imageBlobUrl: imageUrl || null,
        altText: altText || null,
      });
      if (result.ok) {
        setLastSavedPayload(payload);
        setLastSavedImageUrl(imageUrl);
        setLastSavedAltText(altText);
        setSaveState({ kind: "saved", at: Date.now() });
      } else {
        setSaveState({ kind: "error", message: result.error });
      }
    }, 500);

    return () => clearTimeout(handle);
  }, [
    props.mode,
    creativeId,
    payload,
    imageUrl,
    altText,
    validJson,
    lastSavedPayload,
    lastSavedImageUrl,
    lastSavedAltText,
  ]);

  // Fade the "Saved" indicator back to idle after 2s so it doesn't stick.
  useEffect(() => {
    if (saveState.kind !== "saved") return;
    const handle = setTimeout(() => setSaveState({ kind: "idle" }), 2000);
    return () => clearTimeout(handle);
  }, [saveState]);

  function handleFormatChange(next: AdFormat) {
    if (props.mode !== "create") return;
    setFormat(next);
    // Only replace the payload with the new format's template if the
    // current value still matches a known template (i.e. the user hasn't
    // started editing).
    if (Object.values(TEMPLATES).includes(payload)) {
      setPayload(TEMPLATES[next]);
    }
  }

  const isCreate = props.mode === "create";

  return (
    <form
      action={isCreate ? createCreative : undefined}
      onSubmit={isCreate && !validJson ? (e) => e.preventDefault() : undefined}
    >
      {isCreate && (
        <>
          <input type="hidden" name="_return" value={props.returnPath} />
          <input type="hidden" name="campaign_id" value={props.campaignId} />
          <input type="hidden" name="format" value={format} />
          <input type="hidden" name="payload" value={payload} />
        </>
      )}

      {isCreate && (
        <div className="a-field" style={{ maxWidth: 240 }}>
          <label className="a-label">Format</label>
          <select
            className="a-select"
            value={format}
            onChange={(e) => handleFormatChange(e.target.value as AdFormat)}
          >
            {(Object.keys(TEMPLATES) as AdFormat[]).map((f) => (
              <option key={f} value={f}>{FORMAT_LABELS[f]}</option>
            ))}
          </select>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div style={{ position: "relative" }}>
          {isCreate && <label className="a-label">Payload JSON</label>}
          <textarea
            required={isCreate}
            rows={isCreate ? 12 : 10}
            className="a-textarea"
            style={{
              maxWidth: "none",
              width: "100%",
              borderColor: validJson ? "var(--a-border-strong)" : "var(--a-danger-fg)",
            }}
            value={payload}
            onChange={(e) => setPayload(e.target.value)}
            spellCheck={false}
          />
          {/* Absolute-positioned status dot in the textarea's top-right.
              Visible only in edit mode (auto-save is the only thing this
              indicator describes). Three states + a hidden state — see
              <SaveDot/> for the visual mapping. Does NOT push layout. */}
          {!isCreate && (
            <div
              style={{
                position: "absolute",
                top: isCreate ? 22 : 6,
                right: 8,
                pointerEvents: "none",
              }}
            >
              <SaveDot
                validJson={validJson}
                dirty={
                  payload !== lastSavedPayload ||
                  imageUrl !== lastSavedImageUrl ||
                  altText !== lastSavedAltText
                }
                state={saveState}
              />
            </div>
          )}
        </div>

        <div>
          {isCreate && <label className="a-label">Rendered preview</label>}
          <div
            style={{
              padding: 18,
              border: "1px solid var(--a-border)",
              borderRadius: 6,
              background: "#fff",
              minHeight: 60,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {previewHtml ? (
              <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
            ) : (
              <span className="a-muted" style={{ fontSize: 13 }}>
                Invalid JSON — fix to see preview
              </span>
            )}
          </div>
          {!isCreate && (
            <div style={{ marginTop: 6 }}>
              <a
                href={`/admin/ads/creatives/${creativeId}/preview`}
                target="_blank"
                rel="noreferrer"
                className="a-btn a-btn-sm"
              >
                Preview in digest →
              </a>
            </div>
          )}
        </div>
      </div>

      {/* Image controls — display_box only. */}
      {format === "display_box" ? (
        showImageFields ? (
          <div style={{ marginTop: 16 }}>
            <div className="a-field-row">
              <div className="a-field" style={{ flex: 1 }}>
                <label className="a-label">Image URL</label>
                <input
                  type="url"
                  className="a-input"
                  placeholder="https://…blob.vercel-storage.com/…"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                />
                {isCreate && <input type="hidden" name="image_blob_url" value={imageUrl} />}
              </div>
              <div className="a-field" style={{ flex: 1 }}>
                <label className="a-label">Alt text (required if image set)</label>
                <input
                  type="text"
                  className="a-input"
                  placeholder="What's in the image"
                  value={altText}
                  onChange={(e) => setAltText(e.target.value)}
                />
                {isCreate && <input type="hidden" name="alt_text" value={altText} />}
              </div>
            </div>
            <div style={{ marginTop: -8 }}>
              <button
                type="button"
                className="a-btn a-btn-sm"
                onClick={() => {
                  setShowImageFields(false);
                  setImageUrl("");
                  setAltText("");
                }}
              >
                Remove image
              </button>
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 16 }}>
            {isCreate && (
              <>
                <input type="hidden" name="image_blob_url" value="" />
                <input type="hidden" name="alt_text" value="" />
              </>
            )}
            <button
              type="button"
              className="a-btn"
              onClick={() => setShowImageFields(true)}
            >
              + Add image
            </button>
          </div>
        )
      ) : (
        isCreate && (
          <>
            <input type="hidden" name="image_blob_url" value="" />
            <input type="hidden" name="alt_text" value="" />
          </>
        )
      )}

      {isCreate && (
        <div className="a-form-actions">
          <CreateSubmit disabled={!validJson} />
        </div>
      )}
    </form>
  );
}

function CreateSubmit({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="a-btn a-btn-primary"
      disabled={pending || disabled}
      aria-busy={pending}
    >
      {pending ? "Creating…" : "Add creative"}
    </button>
  );
}

// Small corner indicator for the auto-save state. Three visual states +
// a hidden state, picked from the (validJson, dirty, saveState) tuple:
//
//   - error          → red dot (title=error message on hover)
//   - !validJson     → red dot (title="Invalid JSON")
//   - saving / dirty → spinning ring
//   - synced         → green dot
//
// No text. Tooltip on hover for the error case. Does not shift layout.
function SaveDot({
  validJson,
  dirty,
  state,
}: {
  validJson: boolean;
  dirty: boolean;
  state: SaveState;
}) {
  const size = 10;

  if (state.kind === "error") {
    return (
      <span
        title={state.message}
        style={{
          display: "inline-block",
          width: size,
          height: size,
          borderRadius: "50%",
          background: "var(--a-danger-fg)",
        }}
      />
    );
  }

  if (!validJson) {
    return (
      <span
        title="Invalid JSON"
        style={{
          display: "inline-block",
          width: size,
          height: size,
          borderRadius: "50%",
          background: "var(--a-danger-fg)",
        }}
      />
    );
  }

  if (state.kind === "saving" || dirty) {
    // Spinning ring — `aSpin` keyframe lives in admin.css.
    return (
      <span
        title="Saving"
        style={{
          display: "inline-block",
          width: size,
          height: size,
          borderRadius: "50%",
          border: "2px solid var(--a-border-strong)",
          borderTopColor: "var(--a-accent)",
          animation: "aSpin 0.8s linear infinite",
        }}
      />
    );
  }

  // Idle + valid + clean → saved.
  return (
    <span
      title="Saved"
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "50%",
        background: "var(--a-success-fg)",
      }}
    />
  );
}
