"use client";

import { useState } from "react";

// Client-side controls for the server QR generator (/admin/metrics/qr/image).
// The admin types a campaign label (src); we live-preview the code and offer
// downloads at print-ready sizes. The image bytes are generated server-side —
// this component only builds URLs and validates the label.

const SRC_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

// Standard = drop into a digital layout; print sizes are for physical media.
// 4096px covers a poster; SVG is vector (infinite resolution) and the right
// pick for anything a print shop handles.
const PNG_SIZES: Array<{ px: number; label: string; note: string }> = [
  { px: 512, label: "512px", note: "standard / web" },
  { px: 1024, label: "1024px", note: "business card" },
  { px: 2048, label: "2048px", note: "flyer / hi-res" },
  { px: 4096, label: "4096px", note: "poster / large-format" },
];

function imageUrl(src: string, opts: { format: "png" | "svg"; size?: number; download?: boolean }): string {
  const p = new URLSearchParams({ src, format: opts.format });
  if (opts.size) p.set("size", String(opts.size));
  if (opts.download) p.set("download", "1");
  return `/admin/metrics/qr/image?${p.toString()}`;
}

export default function QrGenerator({ defaultSrc = "sabr-2026" }: { defaultSrc?: string }) {
  const [src, setSrc] = useState(defaultSrc);
  const valid = SRC_RE.test(src);
  const target = `https://boxscore.email/r/qr?src=${src}`;

  return (
    <div className="qrgen">
      <div className="qrgen-controls">
        <label className="qrgen-label" htmlFor="qrgen-src">
          Campaign label (<code>src</code>)
        </label>
        <input
          id="qrgen-src"
          className="qrgen-input"
          value={src}
          onChange={(e) => setSrc(e.target.value.trim().toLowerCase())}
          placeholder="sabr-2026"
          spellCheck={false}
          autoComplete="off"
        />
        <p className="qrgen-hint">
          Lowercase letters, digits, hyphens (max 64). This is the key that
          groups scans in the report below — use a distinct label per print run
          or event (e.g. <code>sabr-2026</code>, <code>flyer-lobby</code>).
        </p>

        {valid ? (
          <>
            <p className="qrgen-target">
              Encodes: <a href={target} target="_blank" rel="noreferrer"><code>{target}</code></a>
            </p>

            <div className="qrgen-downloads">
              <span className="qrgen-downloads-title">Download PNG</span>
              <div className="qrgen-btn-row">
                {PNG_SIZES.map((s) => (
                  <a
                    key={s.px}
                    className="qrgen-btn"
                    href={imageUrl(src, { format: "png", size: s.px, download: true })}
                    // Same-origin download; the route sets Content-Disposition.
                    download
                  >
                    {s.label}
                    <span className="qrgen-btn-note">{s.note}</span>
                  </a>
                ))}
              </div>

              <span className="qrgen-downloads-title">Download vector</span>
              <div className="qrgen-btn-row">
                <a
                  className="qrgen-btn qrgen-btn-primary"
                  href={imageUrl(src, { format: "svg", download: true })}
                  download
                >
                  SVG
                  <span className="qrgen-btn-note">best for print</span>
                </a>
              </div>
            </div>
          </>
        ) : (
          <p className="qrgen-invalid">
            Enter a valid label to preview and download.
          </p>
        )}
      </div>

      <div className="qrgen-preview">
        {valid ? (
          // eslint-disable-next-line @next/next/no-img-element -- dynamic admin-only image endpoint, not a static asset
          <img
            className="qrgen-img"
            src={imageUrl(src, { format: "png", size: 512 })}
            alt={`QR code for ${target}`}
            width={280}
            height={280}
          />
        ) : (
          <div className="qrgen-img qrgen-img-empty">No preview</div>
        )}
        <span className="qrgen-preview-note">Preview (512px)</span>
      </div>
    </div>
  );
}
