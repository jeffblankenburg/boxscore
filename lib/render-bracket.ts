// Universal playoff bracket renderer.
//
// One function (renderBracket) walks a tree of BracketNodes and emits a
// monospaced text bracket. Used across every sport's playoff coverage —
// NBA/NHL share an 8-per-conference shape, MLB has bye-laden league
// brackets (top-2 seeds), NFL has byes + single-game rounds. Same tree,
// same renderer; per-sport adapters build the tree.
//
// Score semantics are opaque: 4 = "won the series 4-x" for NBA/NHL/MLB
// (best-of-7/5/3), or "scored 4 points" for NFL. The renderer doesn't
// care — it just places numbers in cells.
//
// V1 supports LTR layout only. True right-to-left mirroring (so East
// reads first-round-on-the-right) is a future enhancement; for now,
// both conferences render LTR and stack vertically.

export type BracketTeam = { abbr: string; seed: number };

export type BracketNode =
  | { kind: "team"; team: BracketTeam; score: number | null }
  | { kind: "bye"; team: BracketTeam }
  | {
      kind: "series";
      upper: BracketNode;
      lower: BracketNode;
      result: SeriesResult;
    };

export type SeriesResult =
  | { kind: "decided"; winner: BracketTeam; winnerScore: number }
  | { kind: "in_progress"; upperScore: number; lowerScore: number }
  | { kind: "not_started" };

export type Bracket = {
  title: string;
  direction: "ltr" | "rtl";
  root: BracketNode;
};

// ─── public ───────────────────────────────────────────────────────────────

export function renderBracket(bracket: Bracket): string {
  const ltrLines = layout(bracket.root).lines;
  if (bracket.direction === "ltr") return ltrLines.join("\n");
  return ltrLines.map(mirrorLine).join("\n");
}

// Mirror a rendered line so the bracket reads right-to-left. Strategy:
// tokenize each line into alternating runs of (a) box-drawing/arrow
// characters and (b) everything else (team text, scores, spaces); reverse
// the token ORDER; within each box-run, reverse the character order AND
// swap directional glyphs (┐↔┌, ┘↔└, ├↔┤, →↔←); leave text-run characters
// untouched so "OKC  4" still reads as "OKC  4", not "4  CKO".
const BOX_CHAR = /[─│┐┘┌└├┤→←]/;
const MIRROR: Record<string, string> = {
  "┐": "┌", "┌": "┐",
  "┘": "└", "└": "┘",
  "├": "┤", "┤": "├",
  "→": "←", "←": "→",
};

function mirrorLine(line: string): string {
  if (line.length === 0) return line;
  const tokens: { isBox: boolean; text: string }[] = [];
  let cur = "";
  let curIsBox = BOX_CHAR.test(line[0]!);
  for (const c of line) {
    const isBox = BOX_CHAR.test(c);
    if (isBox === curIsBox) cur += c;
    else { tokens.push({ isBox: curIsBox, text: cur }); cur = c; curIsBox = isBox; }
  }
  tokens.push({ isBox: curIsBox, text: cur });
  tokens.reverse();
  return tokens.map((t) => {
    if (!t.isBox) return t.text;
    return t.text.split("").reverse().map((c) => MIRROR[c] ?? c).join("");
  }).join("");
}

// ─── layout ───────────────────────────────────────────────────────────────

type LayoutResult = {
  lines: string[];
  anchorRow: number;  // row of the outgoing connector — where parent attaches
  width: number;
};

function layout(node: BracketNode): LayoutResult {
  if (node.kind === "team") return leafLayout(formatTeam(node.team, node.score));
  if (node.kind === "bye") return leafLayout(formatBye(node.team));

  const u = layout(node.upper);
  const l = layout(node.lower);

  // Pad both subtrees to the same column width so connectors line up.
  const subtreeWidth = Math.max(u.width, l.width);
  const uLines = u.lines.map((s) => padEnd(s, subtreeWidth));
  const lLines = l.lines.map((s) => padEnd(s, subtreeWidth));

  // One spacer row between the two subtrees gives the connector vertical
  // room. The merge cell sits centered between the two child anchor rows.
  const spacerRows = 1;
  const upperAnchor = u.anchorRow;
  const lowerAnchorAbs = uLines.length + spacerRows + l.anchorRow;
  const mergeRow = Math.floor((upperAnchor + lowerAnchorAbs) / 2);

  const totalRows = uLines.length + spacerRows + lLines.length;
  const combined: string[] = [];
  for (let i = 0; i < totalRows; i++) {
    if (i < uLines.length) combined.push(uLines[i]!);
    else if (i < uLines.length + spacerRows) combined.push(" ".repeat(subtreeWidth));
    else combined.push(lLines[i - uLines.length - spacerRows]!);
  }

  // Suffix grammar (relative to col subtreeWidth):
  //   upperAnchor       " ─┐"  (space, dash, corner)
  //   in-between rows   "  │"  (2 spaces, pipe — keeps │ aligned under ┐)
  //   mergeRow          "  ├─ " + label  (├ aligned under ┐ from prior round)
  //   lowerAnchorAbs    " ─┘"
  //
  // The label has no trailing dash. The PARENT series, when it processes
  // this subtree, will append its own " ─┐" to the mergeRow line — which
  // produces a clean "LABEL ─┐" at the right edge.
  const mergeLabel = formatMerge(node.result);
  const out: string[] = combined.map((line, i) => {
    let suffix = "";
    if (i === upperAnchor) suffix = " ─┐";
    else if (i === lowerAnchorAbs) suffix = " ─┘";
    else if (i === mergeRow) suffix = "  ├─ " + mergeLabel;
    else if (i > upperAnchor && i < lowerAnchorAbs) suffix = "  │";
    return line + suffix;
  });

  const maxLen = Math.max(...out.map((s) => s.length));
  const padded = out.map((s) => padEnd(s, maxLen));
  return { lines: padded, anchorRow: mergeRow, width: maxLen };
}

function leafLayout(text: string): LayoutResult {
  return { lines: [text], anchorRow: 0, width: text.length };
}

// ─── formatting ───────────────────────────────────────────────────────────

// "(1) OKC" — leaves identify the team only. Series result (with the
// winner's score) lives in the parent merge cell, so showing the score
// in both places creates the "4 appearing twice" confusion. The score
// param is accepted for type stability — current adapters can pass it
// but the renderer ignores it.
function formatTeam(team: BracketTeam, _score: number | null): string {
  return `(${team.seed}) ${team.abbr.padEnd(4)}`;
}

// "(1) OKC  ── BYE ──" — single-line bye representation. The team flows
// straight to the next round; the parent's " ─┐" will hook onto the
// trailing "──".
function formatBye(team: BracketTeam): string {
  return `(${team.seed}) ${team.abbr.padEnd(4)}  ── BYE ──`;
}

// Content for the merge cell. Three states:
//   decided      → "OKC  4"
//   in_progress  → "1-1"
//   not_started  → "TBD"
function formatMerge(r: SeriesResult): string {
  if (r.kind === "decided") return `${r.winner.abbr.padEnd(4)} ${r.winnerScore}`;
  if (r.kind === "in_progress") return `${r.upperScore}-${r.lowerScore}`;
  return "TBD";
}

function padEnd(s: string, w: number): string {
  if (s.length >= w) return s;
  return s + " ".repeat(w - s.length);
}
