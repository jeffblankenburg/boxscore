// Production-dependency vulnerability gate (used by `npm run audit` and the
// pre-push hook). Fails on any high/critical advisory EXCEPT those explicitly
// accepted below. Keeps the guard meaningful — a new fixable high still blocks
// a push — while not letting one un-fixable transitive advisory wedge it shut.
//
// Fails open (exit 0) if npm audit can't run at all (offline), matching the
// hook's intent: tooling trouble must not block a push; only a real finding.

import { execSync } from "node:child_process";

// Accepted advisories: id → why. Keep this tiny and revisit each one.
const ALLOW = new Map([
  [
    "GHSA-mrhx-c7xc-m3w5",
    // zod <4.6.6 memory-exhaustion DoS, pulled in ONLY by @atproto/* (the
    // BlueSky social client). We don't import zod directly; @atproto requires
    // zod ^3.23.8 so it can't move to 4.6.6, and there's no patched 3.x —
    // `npm audit fix --force` would just downgrade @atproto. Low risk:
    // triggered only by a malicious BlueSky API response, and social posting
    // is deferred. Revisit when @atproto supports zod 4.
    "zod<4.6.6 DoS via @atproto; no in-range fix; low risk, social posting deferred",
  ],
]);

let report;
try {
  const out = execSync("npm audit --omit=dev --json", {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  report = JSON.parse(out);
} catch (e) {
  // npm audit exits non-zero when vulns exist but still prints JSON to stdout.
  if (e.stdout) {
    try { report = JSON.parse(e.stdout); } catch { /* fall through */ }
  }
  if (!report) {
    console.log("npm audit could not run (offline?) — allowing.");
    process.exit(0);
  }
}

// Collect every DISTINCT high/critical advisory object across the tree. A
// package that's vulnerable only because of a downstream package lists that
// package name (a string) in `via`; the advisory object itself carries the
// GHSA id. So if the only advisory objects present are allowlisted, the whole
// chain is accepted.
const advisories = new Map(); // id -> title
for (const v of Object.values(report.vulnerabilities ?? {})) {
  for (const via of v.via ?? []) {
    if (typeof via !== "object") continue;
    if (via.severity !== "high" && via.severity !== "critical") continue;
    const id = via.url?.match(/GHSA-[\w-]+/)?.[0] ?? String(via.source ?? via.title ?? "unknown");
    advisories.set(id, via.title ?? "");
  }
}

const notAllowed = [...advisories.keys()].filter((id) => !ALLOW.has(id));
if (notAllowed.length > 0) {
  console.error("High/critical production vulnerabilities (not allowlisted):");
  for (const id of notAllowed) console.error(`  ${id}  ${advisories.get(id)}`);
  console.error("\nFix with `npm audit fix` (review the diff), or add to the allowlist in scripts/audit-check.mjs with a reason.");
  process.exit(1);
}

const accepted = [...advisories.keys()];
console.log(
  accepted.length
    ? `npm audit: no unaccepted high/critical prod vulns (${accepted.length} allowlisted: ${accepted.join(", ")}).`
    : "npm audit: no high/critical production vulnerabilities.",
);
process.exit(0);
