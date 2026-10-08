// shared/pdf/table-layout.js
// Where every cell of a table sits, under limits that keep a hostile table
// from costing more than a sane one.
//
// Cells carry spans but no position, so the grid is worked out here once. The
// parser runs it and writes the clamped spans back into the block IR, so the
// HTML preview, the PDF and the column count all see the same table; drawTable
// runs it again on spans that are already within the limits. Two replays of
// the same rules drifted apart once already.

// No table is wider than this many columns: a cell starting at column c spans
// at most MAX_COLUMNS - c of them, and one at or past the edge spans one. HTML
// caps a single colspan at 1000 but not the grid, and rowspans that push each
// row further right built a 300,000-column table that hung Chrome's preview.
export const MAX_COLUMNS = 1000;

// The rows below their own that all of a table's rowspans may hold, summed
// over cells. Past it a cell spans its own row only. Layout and the row rules
// cost one step per held span per row, so this bounds both: 5000 cells of
// rowspan=0 over 40,000 rows ran Chrome out of memory without it. Real
// tables use a few hundred.
export const SPAN_BUDGET = 200000;

// A cell's spans as given, made whole and at least 1. The parser already caps
// them at the HTML limits; this is for block lists that come from elsewhere.
function requested(cell) {
  const cols = Math.min(MAX_COLUMNS, Math.max(1, Math.floor(cell.colspan) || 1));
  const rows = Math.min(65534, Math.max(1, Math.floor(cell.rowspan) || 1));
  return { cols, depth: rows - 1 };
}

/**
 * @param {Array<Array<{colspan:number,rowspan:number}>>} rows
 * @returns {{
 *   starts: number[][],      // starts[r][k]: first column of cell k of row r
 *   spans: Array<Array<{cols:number, depth:number}>>,  // the spans used, after the limits
 *   heldAfter: Array<Array<{start:number, cols:number}>>,  // ranges a rowspan carries
 *                            // from row r into row r + 1, sorted by start
 *   columnCount: number      // the widest row; a held column needs no counting of
 *                            // its own, the row that started the span was that wide
 * }}
 */
export function layoutTable(rows) {
  // Held columns are kept as one range per spanning cell, never column by
  // column: with colspan 1000 a per-column walk ran for minutes.
  let held = []; // [{start, cols, left}]: held for `left` more rows, this one included
  const starts = [];
  const spans = [];
  const heldAfter = [];
  let columnCount = 0;
  let budget = SPAN_BUDGET;
  for (let r = 0; r < rows.length; r++) {
    const next = [];
    for (const h of held) if (h.left > 1) next.push({ start: h.start, cols: h.cols, left: h.left - 1 });
    const rowStarts = [];
    const rowSpans = [];
    let ci = 0;
    let i = 0;
    for (const cell of rows[r]) {
      // Step over held ranges. They are sorted by start and may overlap, so a
      // range ending at or before ci is passed and one covering ci moves ci to
      // its end.
      for (; i < held.length && held[i].start <= ci; i++) {
        const end = held[i].start + held[i].cols;
        if (end > ci) ci = end;
      }
      const want = requested(cell);
      const cols = Math.max(1, Math.min(want.cols, MAX_COLUMNS - ci));
      // A span past the last row holds nothing that is ever laid out.
      let depth = Math.min(want.depth, rows.length - 1 - r);
      if (depth > budget) depth = 0;
      budget -= depth;
      rowStarts.push(ci);
      rowSpans.push({ cols, depth });
      // A cell spanning several columns and rows holds all of them for the
      // rows below, even columns its own row never mentions.
      if (depth > 0) next.push({ start: ci, cols, left: depth });
      ci += cols;
    }
    if (ci > columnCount) columnCount = ci;
    next.sort((a, b) => a.start - b.start);
    starts.push(rowStarts);
    spans.push(rowSpans);
    heldAfter.push(next.map((h) => ({ start: h.start, cols: h.cols })));
    held = next;
  }
  return { starts, spans, heldAfter, columnCount };
}
