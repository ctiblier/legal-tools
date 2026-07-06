# Bates Stamp — Batch Mode & UX Overhaul

**Date:** 2026-07-06
**Status:** Shipped
**Scope:** `batesstamp/bates-stamp/index.html`, `batesstamp/styles.css`

Prompted by user feedback: (1) a request for adjustable margins because the
default 30 pt margin sometimes overlapped existing text, and (2) noting
that a competitor (Easy Bates) supported batch stamping.

---

## What shipped

### 1. Configurable margin

- New "Margin from Page Edge" input in section 5 (Page Layout).
- Default 25 pt (~0.35 in). Chosen to stay outside most printers'
  unprintable margin (~0.25 in / 18 pt) while remaining close to the
  edge for a professional look.
- Applied uniformly to Bates, exhibit, and confidentiality stamps.

### 2. Whitespace border

- Optional toggle: uniformly shrink each page's existing content and
  translate it toward the center so a blank band sits at all four
  edges. Guarantees no stamp overlaps document content, regardless
  of source layout.
- Implemented with pdf-lib's `page.scaleContent(s, s)` +
  `page.translateContent(dx, dy)` using uniform scale (min of
  horizontal and vertical fit) so aspect ratio is preserved.
- Default border 50 pt (~0.7 in) — sized to clear the largest
  default stamp (24 pt exhibit font + margin).

### 3. Batch multi-file stamping

- File input became `multiple`.
- Selection is now backed by a JS `selectedFiles` array (source of
  truth) instead of the browser `FileList`. This allows appending
  files with a second click/drop and removing individual files.
- Continuous Bates numbering across files: file 1 gets N to
  N+pages1−1, file 2 picks up at N+pages1, etc.
- Auto-incrementing exhibit values per file:
  - Alphabetic (`A`, `EX`) → Excel-column style: A→B→...→Z→AA
  - Trailing digits (`1`, `EX-1`) → increment the trailing number,
    preserving zero-padding
  - Fallback: append `-N` to base value
- Output packaged as a single ZIP (`bates-stamped-YYYY-MM-DD.zip`)
  via JSZip loaded from unpkg with a computed SRI hash.
- 100-file batch limit; each file still ≤100 MB.

### 4. Preview data table

- Below the drop zone, a preview table renders as files are added.
- Columns adapt to enabled options: File, Size, Pages, Bates Range
  (when Bates on), Exhibit (when exhibit on), remove.
- Page counts are read lazily via `PDFLib.PDFDocument.load` and the
  table re-renders progressively as counts populate.
- Preview updates live when Bates prefix, starting number, padding,
  or base exhibit value change.
- Exhibit letters render as brand-colored badge pills; Bates ranges
  render in monospace to visually mirror the actual stamps.
- Table sits inside a bordered container with a "PREVIEW — N files —
  what will be stamped" caption so it reads as a preview panel, not
  a passive list.
- Password-protected or unreadable files are flagged inline (red row,
  "cannot stamp" message) and block the Stamp button.

### 5. Distributed appearance controls

- Each stamp type's position, font size, and color moved from a
  shared "Appearance" section into the corresponding stamp section
  (Bates Numbers, Exhibit Stamp, Confidentiality Notice).
- Section 5 renamed "Appearance" → "Page Layout" and now contains
  only the two genuinely-global controls (margin, whitespace border).
- Toggling a stamp type off now hides its appearance controls in one
  place — no more separate `batesAppearance` / `exhibitAppearance` /
  `confidentialityAppearance` divs.

### 6. Removed text opacity control

- The 50–100 % opacity slider was cluttering the UI without much
  practical value. Stamps now always render fully opaque.

### 7. Drop zone slimmed down

- Padding 32 → 18 px, icon 36 → 28 px. Once the preview table
  became the visual anchor below the drop zone, the drop zone no
  longer needed to dominate.

---

## Notable implementation choices

- **Preview computation is on the client during selection**, not
  deferred to stamp time. Trade-off: adds up to a few seconds of
  parsing per file on selection, but users see the actual Bates
  ranges they're about to produce before committing. For a batch
  of legal-sized productions, that verification is worth the wait.

- **Deduplication key** is `name|size|lastModified` — good enough
  for typical file-manager selections and avoids false positives
  from same-named files in different states.

- **Continuous vs. per-file numbering**: hard-coded to continuous
  after user confirmation. Standard discovery-production behavior;
  no toggle added to keep the UI simple.

- **SRI hash for JSZip** was computed locally rather than fabricated
  (a fabricated hash blocks the script from loading).

## Not shipped / deferred

- **Drag-to-reorder** in the file list. Users can currently work
  around by renaming files (`01_smith.pdf`) or by removing and
  re-adding in the right order. Reorder handles are a nice-to-have
  if requested.

- **Per-file progress checkmark during stamping**. The status bar
  already reports "Processing file 3 of 10" which was judged good
  enough for now.
