# Legal Toolkit Design Spec

**Date:** 2026-03-22
**Status:** Draft
**Author:** ctibs + Claude

---

## Vision

Transform batesstamp.com from a single-purpose Bates stamping tool into a free, privacy-first, browser-based legal toolkit. All document processing happens client-side — files never leave the user's browser. The Photopea of legal tools.

**Target users:** Anyone dealing with legal documents — solo/small firm attorneys, paralegals, pro se litigants, legal assistants, corporate compliance teams.

**Supported file types:** PDFs and images (JPEG, PNG). Word document support is a future goal (see Phase 2).

---

## Site Architecture

The root of batesstamp.com becomes a tool directory. Each tool lives at its own path. PFS Calculator remains on pfscalculator.com (see decision rationale below).

```
batesstamp.com/                    → toolkit landing page (tool grid)
batesstamp.com/bates-stamp         → Bates stamping (existing, moved from root)
batesstamp.com/filing-assembler    → filing assembler with slip sheets
batesstamp.com/redaction           → privilege redaction
batesstamp.com/metadata-stripper   → PDF metadata stripper
batesstamp.com/page-extractor      → PDF page extractor/splitter
batesstamp.com/compressor          → PDF compressor
batesstamp.com/watermark           → document watermarking
batesstamp.com/pleading-paper      → pleading paper generator
batesstamp.com/about
batesstamp.com/privacy-policy
batesstamp.com/terms-of-service
```

**PFS Calculator:** Stays on pfscalculator.com as a separate Cloudflare Pages project — no migration. It already ranks well on Google (39 referrals) and moving it risks SEO disruption for no immediate benefit. The toolkit homepage links to pfscalculator.com as an external tool card (with a "opens pfscalculator.com" note), and pfscalculator.com cross-links back to the toolkit. Can be migrated under batesstamp.com later once the toolkit has established traffic.

**Deployment:** Static site on Cloudflare Pages. The build step copies `shared/brand.css` and shared JS modules into the `batesstamp/` deploy directory. Same pattern as the current setup.

**pfscalculator.com:** Remains its own Cloudflare Pages project. No changes to deployment. Cross-links added between both sites.

---

## Phase 1 Tools

### 1. Bates Stamper (existing)

Move from site root to `/bates-stamp`. No functional changes. Root URL redirects to new path (or the homepage links to it prominently as the flagship tool).

### 2. Filing Assembler (`/filing-assembler`)

**Purpose:** Assemble a complete court filing from separate documents — main brief/motion plus exhibits with auto-generated slip sheets — into a single PDF ready to e-file.

**Workflow:**
1. User drops in their motion/brief as the main document
2. User drags in exhibit documents one by one (PDF, images)
3. Each exhibit auto-generates a slip sheet (e.g., "EXHIBIT A") inserted before it
4. User can reorder exhibits by dragging
5. User customizes slip sheet format
6. Download one combined PDF

**Slip sheet options:**
- Label format: Exhibit A/B/C, Exhibit 1/2/3, Plaintiff's Exhibit A, Defendant's Exhibit 1, or custom text
- Optional case caption (case name, case number, court)
- Font size and positioning (centered, customizable)
- Portrait or landscape (auto-match to the exhibit behind it, or manual override)

**Additional features:**
- Optional cover sheet generation
- Optional table of contents with page numbers (requires two-pass assembly: first pass to calculate page counts, second to generate TOC with correct page numbers and insert at the front)
- Page count display per document and total
- Ability to insert a slip sheet into an already-merged PDF at a specific page break (for users who have a pre-assembled PDF and just need slip sheets added)

**Key technical detail:** Must handle large filings (500MB+). See Memory Management section.

### 3. Privilege Redaction (`/redaction`)

**Purpose:** Permanently redact sensitive content from PDF documents with labeled redaction reasons, suitable for discovery production.

**Workflow:**
1. User uploads a PDF
2. PDF renders page-by-page in the browser (via pdf.js)
3. User draws redaction boxes over content to redact
4. User selects a redaction reason per box (or applies one reason to all):
   - Attorney-Client Privilege
   - Work Product Doctrine
   - Confidential / Proprietary
   - Privacy / Personal Information
   - Trade Secret
   - Custom label
5. Preview redacted document
6. Download flattened PDF with redactions permanently applied

**Critical requirements:**
- Redactions must be **permanent** — the underlying text/image data must be irrecoverably removed, not just covered with a black box. A cosmetic overlay is a legal liability.

**Technical approach — rasterize and rebuild:**
pdf-lib cannot selectively remove text operators from a PDF content stream. The only reliable client-side approach for permanent redaction is:
1. Render each page to a high-DPI canvas using pdf.js (300 DPI for print quality)
2. Draw black redaction boxes with labels onto the canvas
3. Create a new PDF from the rasterized page images using pdf-lib

This guarantees the original text/vector data is gone — the output is image-based. Trade-offs:
- Output files are larger than the original (image-based vs vector)
- Output text is not searchable/selectable (acceptable for redacted discovery documents)
- High-DPI rendering preserves visual quality for printing and filing

- Redaction labels appear on the redacted area (e.g., a black box with white text reading "ATTORNEY-CLIENT PRIVILEGE")
- Metadata stripped from output (author, edit history) to prevent leaking info about who redacted what

### 4. PDF Metadata Stripper (`/metadata-stripper`)

**Purpose:** Remove hidden metadata from PDFs before filing or production to prevent inadvertent disclosure of sensitive information.

**What gets stripped (document-level metadata):**
- Author / creator name
- Creation and modification dates
- Software used to create the document
- Edit history / revision info
- Custom metadata fields
- XMP metadata

**Optional: annotation removal (separate from metadata)**
Annotations (comments, highlights, sticky notes) are structural PDF elements, not metadata. The tool will present these separately and let the user choose whether to remove them. This distinction is important because users may not expect a "metadata stripper" to remove visible annotations.

**Out of scope for Phase 1:** Stripping EXIF/GPS data from images embedded within PDFs. This requires parsing image streams within PDF XObjects and is significantly more complex. Listed as a Phase 2 stretch goal.

**Workflow:**
1. User uploads one or more PDFs
2. Tool displays what metadata was found (so user can see what they're removing)
3. User chooses: strip all, or selectively keep certain fields
4. Download cleaned PDF(s)

**Batch support:** Allow multiple files to be processed at once with a zip download option.

### 5. Pleading Paper Generator (`/pleading-paper`)

**Purpose:** Generate properly formatted pleading paper (numbered line paper) for court filings, matching jurisdiction-specific requirements.

**Formats to support (Phase 1):**
- California (28 lines, double-spaced, line numbers on left margin)
- Federal (25 lines typical)
- Generic / custom (user specifies line count, margins, spacing)

**Options:**
- Line count (25, 26, 28, or custom)
- Margins (standard court margins or custom)
- Header: court name, case caption, case number
- Footer: page numbers
- Output as blank PDF (for printing or opening in Word — Word can import PDFs directly)

**Stretch:** Pre-fill caption from a form (court name, parties, case number, document title).

### 6. PDF Page Extractor (`/page-extractor`)

**Purpose:** Pull specific pages out of a PDF for filing excerpts, deposition clips, or partial exhibits.

**Workflow:**
1. User uploads a PDF
2. PDF renders page thumbnails in the browser (via pdf.js)
3. User selects pages — click individual thumbnails, enter page ranges (e.g., "1-3, 7, 12-15"), or select all/none
4. Download extracted pages as a new PDF

**Additional features:**
- Split mode: split a PDF into multiple files (e.g., split a 50-page document into 5 ten-page files)
- Page count and file size estimate before download
- Drag to reorder extracted pages

**Technical notes:** Straightforward with pdf-lib — `copyPages` for extraction, already proven in the Bates stamper.

### 7. PDF Compressor (`/compressor`)

**Purpose:** Reduce PDF file size to meet e-filing size limits (typically 25-50MB per upload).

**Workflow:**
1. User uploads one or more PDFs
2. Tool shows current file size and estimated compressed size
3. User selects compression level:
   - Light (minimal quality loss, ~20-40% reduction) — downsample images to 200 DPI
   - Medium (balanced, ~40-60% reduction) — downsample to 150 DPI
   - Heavy (maximum reduction, visible quality loss) — downsample to 100 DPI
4. Download compressed PDF(s)

**Technical approach:**
Render each page to canvas at the target DPI using pdf.js, then rebuild the PDF from the rasterized images using pdf-lib. Same rasterize-and-rebuild pattern as the redaction tool. Trade-off is the same: output becomes image-based (non-searchable). For documents that are already image-heavy (scanned documents), this is lossless in practice. For text-heavy documents, show a warning that searchability will be lost.

**Batch support:** Multiple files with zip download option.

### 8. Document Watermarking (`/watermark`)

**Purpose:** Apply text watermarks across PDF pages — DRAFT, CONFIDENTIAL, ATTORNEY EYES ONLY, or custom text.

**Workflow:**
1. User uploads a PDF
2. User selects or types watermark text:
   - Presets: DRAFT, CONFIDENTIAL, ATTORNEY EYES ONLY, PRIVILEGED, DO NOT DISTRIBUTE, COPY
   - Custom text field
3. User configures appearance:
   - Opacity (10-100%)
   - Color (default gray, options for red, black)
   - Position: diagonal across page (default), header, footer, or centered
   - Font size (auto-scale to page or manual)
4. Preview watermarked pages
5. Download watermarked PDF

**Technical notes:** Nearly identical to Bates stamper logic — pdf-lib text drawing with rotation and opacity. Can share significant code with the existing Bates stamp implementation.

### 9. PFS Calculator (stays on pfscalculator.com)

No migration. Remains on its own domain and Cloudflare Pages project. Add a cross-link banner or footer link pointing to the BatesStamp toolkit, and list it on the toolkit homepage as an external tool card.

---

## Technical Architecture

### Stack

- **HTML + vanilla JS + CSS** — no frameworks
- **pdf-lib** — PDF creation, modification, merging, metadata manipulation (already in use)
- **pdf.js** (Mozilla) — PDF rendering for in-browser preview (needed for redaction tool)
- **SortableJS** — touch-compatible drag-and-drop reordering (Filing Assembler)
- **Shared `brand.css`** — existing design system for consistent look across tools
- **Cloudflare Pages** — static hosting, same as current
- **Build step:** Shell script that copies `shared/` files into the deploy directory (extends existing `brand.css` copy)

### Shared Components

These are vanilla JS modules shared across tools:

- **File upload / drag-and-drop handler** — unified drop zone with file type validation. Already exists in BatesStamp; extract and generalize.
- **Download handler** — consistent download UX with filename formatting
- **Nav component** — shared header with tool dropdown for jumping between tools
- **Trust badge** — "Your files never leave your browser" indicator, present on every tool
- **Footer** — shared about/privacy/terms links

### Directory Structure

`batesstamp/` is the Cloudflare Pages deploy directory. Shared files are copied into it at build time (same pattern as the existing `brand.css` copy step). Site-wide assets (favicons, robots.txt, sitemap.xml, CNAME, manifest.json, BingSiteAuth.xml) remain in `batesstamp/` root.

```
legal-tools/
├── shared/
│   ├── brand.css              (existing — copied to batesstamp/ at build)
│   ├── file-handler.js        (shared upload/download — copied to batesstamp/shared/ at build)
│   └── nav.js                 (shared navigation — copied to batesstamp/shared/ at build)
├── batesstamp/
│   ├── index.html             (new: toolkit landing page)
│   ├── styles.css             (existing, renamed for consistency)
│   ├── CNAME, robots.txt, sitemap.xml, manifest.json, etc. (existing site assets)
│   ├── shared/                (populated by build — gitignored)
│   ├── bates-stamp/
│   │   └── index.html         (existing tool, moved)
│   ├── filing-assembler/
│   │   └── index.html
│   ├── redaction/
│   │   └── index.html
│   ├── metadata-stripper/
│   │   └── index.html
│   ├── page-extractor/
│   │   └── index.html
│   ├── compressor/
│   │   └── index.html
│   ├── watermark/
│   │   └── index.html
│   ├── pleading-paper/
│   │   └── index.html
│   ├── about.html
│   ├── privacy-policy.html
│   └── terms-of-service.html
├── pfscalculator/              (separate site — no changes, cross-links only)
└── README.md
```

---

## Memory Management

Large legal filings (500MB+) require careful memory handling in the browser. The strategy is a reliable default path with a progressive enhancement layer.

### Default Path (all browsers)

**1. Lazy file loading**
When the user drags in files, store only the `File` reference (a pointer to the file on disk). Do not read file bytes into memory until that specific file is being processed. This means 20 dragged-in files consume virtually zero memory until merge time.

**2. Sequential input loading**
During the combine/merge step, load one input document at a time:
1. Read Exhibit A bytes into memory
2. Copy pages into the output PDFDocument
3. Release Exhibit A's source bytes (nullify reference, let GC collect)
4. Read Exhibit B bytes into memory
5. Repeat

**Memory reality:** This avoids loading all input files simultaneously, but the output `PDFDocument` accumulates all pages in memory as they are copied. Peak memory is approximately: full output PDF size + largest single input file. For a 500MB filing, the output document alone will consume ~500MB. This approach works for typical filings (under ~500MB) on modern machines with 4GB+ browser memory limits. For larger filings, the OPFS-enhanced path is needed.

**3. Web Workers**
Offload PDF processing (merge, redaction, metadata stripping) to a Web Worker. Benefits:
- UI thread stays responsive (no freezing during large operations)
- Worker gets its own memory allocation separate from the main thread
- Progress reporting back to UI via `postMessage`

### Enhanced Path (progressive, OPFS)

**4. Origin Private File System (OPFS)**
When the browser supports OPFS (Chrome 86+, Firefox 111+, Safari 15.2+, Edge 86+ — effectively all modern browsers):
- Instead of building one massive PDFDocument in memory, merge documents in batches: combine small groups of exhibits into intermediate PDFs, serialize each to OPFS, release from memory, then do a final byte-level concatenation pass
- This keeps peak memory to the size of one batch (~50-100MB) rather than the entire output
- Enables handling filings in the 1GB+ range

**Note:** The final concatenation of pre-built PDFs may require a low-level approach (e.g., qpdf compiled to WASM, or manual PDF cross-reference table merging) since pdf-lib would reload all pages into memory. This is an implementation detail to resolve during development — if too complex, the OPFS path can simply write/read intermediate bytes to reduce GC pressure without full streaming.

**Detection and fallback:**
```
if (navigator.storage && navigator.storage.getDirectory) {
  // Use OPFS-enhanced path
} else {
  // Fall back to memory-only path
}
```

The user never sees a difference. No settings, no feature flags. The tool automatically uses the best available strategy. If OPFS throws an error at runtime (e.g., storage quota exceeded), catch it and fall back to the default path silently.

### Guardrails

- Display a running file size total as the user adds documents
- Show a warning (not a block) at 500MB: "Large filing — processing may take a moment"
- Show estimated processing time for large jobs
- Progress bar during merge/processing operations

---

## Homepage Design

The new batesstamp.com root page serves as the tool directory.

**Content:**
- Tagline: something like "Free Legal Document Tools — Private, Secure, Browser-Based"
- Brief value proposition: all processing happens in your browser, no uploads, no accounts
- Tool grid: card for each tool with icon, name, one-line description, and link
- Trust signals: "No uploads. No accounts. No data collection. Your documents stay on your device."
- Footer: about, privacy policy, terms of service

**Tool cards display:**
- Tool icon/illustration
- Tool name
- One-line description
- "Use Tool" button/link

The flagship tool (Bates Stamper) should be visually prominent — larger card or featured position.

---

## Shared UX Patterns

### Navigation
- Sticky header with site name/logo and a tool dropdown menu
- Current tool highlighted in nav
- Accessible on mobile (hamburger menu)

### File Upload
- Drag-and-drop zone with click-to-browse fallback
- File type validation with clear error messages
- File size display
- Multiple file support where applicable

### Processing Feedback
- Progress bar for long operations
- Estimated time remaining for large files
- "Processing... your files never leave your browser" reassurance during waits

### Download
- Clear download button with filename preview
- Auto-suggested filename based on tool and input

### Trust Badge
Present on every tool page: a small, consistent indicator that files are processed locally. Not intrusive, but always visible.

### Cross-Tool Pipeline ("Open in Next Tool")
After processing a document, offer to open the result directly in another relevant tool. Examples:
- Filing Assembler → "Open in Bates Stamper" or "Open in Metadata Stripper"
- Bates Stamper → "Open in Compressor" (if the output is large)
- Redaction → "Open in Metadata Stripper" (natural pairing)
- Page Extractor → "Open in Watermark" or "Open in Bates Stamper"

Implementation: pass the output PDF blob via in-memory reference (no re-upload needed). The target tool receives the file as if the user had dropped it in. This is a major differentiator over generic PDF sites that force re-upload between operations.

### Session File List
Keep a session-only (not persisted, not stored) list of files the user has worked with during the current browser session. Displayed as a small sidebar or dropdown so users can quickly pass a document into another tool without re-uploading. Uses `sessionStorage` references to in-memory blobs — cleared automatically when the tab closes. No data is ever written to disk or persisted beyond the session.

### Mobile
All tools must be usable on mobile/tablet. The existing responsive breakpoints in `brand.css` provide the foundation. For the Filing Assembler's drag-to-reorder, use SortableJS (lightweight, touch-compatible library) since the HTML5 Drag and Drop API does not work on mobile. Other tools' file upload uses standard click-to-browse on mobile (drag-and-drop is a desktop enhancement).

---

## SEO Strategy

Each tool page is an independent SEO entry point. Key considerations:
- Unique `<title>` and `<meta description>` per tool, targeting specific legal search queries
- Structured data (FAQ schema) where applicable
- Clean URLs (`/redaction` not `/tools/redaction.html`)
- Internal linking between related tools (e.g., Bates stamper links to filing assembler)
- "Free" prominently in titles and descriptions (high-intent modifier for legal tool searches)

**Target queries (examples):**
- "free bates stamp pdf online"
- "redact pdf for discovery free"
- "assemble court filing exhibits"
- "remove metadata from pdf before filing"
- "extract pages from pdf free"
- "compress pdf for e-filing"
- "watermark pdf confidential"
- "california pleading paper template"
- "florida proposal for settlement calculator"

---

## SEO Migration Checklist

Moving the Bates stamper from `/` to `/bates-stamp/` requires careful SEO handling:
- Update `<link rel="canonical">` on the Bates stamper page to the new URL
- Update Open Graph `og:url` meta tag
- Update sitemap.xml with all new tool URLs
- Add 301 redirect from old root tool URL to `/bates-stamp/` (via `_redirects` file or Cloudflare rules)
- Update any structured data (JSON-LD) URLs
- Submit updated sitemap to Google Search Console and Bing Webmaster Tools

## Future Tools (Phase 2+)

Not in scope for Phase 1, but validated as useful:
- Word document support (DOCX input for Filing Assembler — requires mammoth.js or similar for DOCX-to-PDF conversion)
- EXIF/GPS stripping from images embedded in PDFs
- Discovery document combiner (merge + auto-Bates in one step)
- Table of authorities generator
- Certificate of service generator

---

## Out of Scope

- Server-side processing (all client-side, always)
- User accounts or saved state
- Cloud storage integration
- Payment/premium features (for now)
- Deadline calculator (friend's project)
- OCR (massive scope, needs Tesseract WASM, questionable quality)
- Additional calculators (interest, damages, fee/cost — revisit in Phase 2)

---

## Decisions (resolved from brainstorming)

1. **Branding:** TBD — keep "BatesStamp" for now since it has SEO equity. Can rebrand later.
2. **Monetization:** Tip jar (Buy Me a Coffee or Ko-fi, whichever comes back online first). Placement on homepage and as a subtle link on each tool page. Affiliate links to explore in Phase 2.
3. **Analytics:** Continue Umami + Google Analytics on all new tool pages. Add custom events for each tool's primary action (like the existing `stamp-document` event).
4. **pfscalculator.com:** Stays on its own domain. No migration — cross-links only. Can revisit once the toolkit has traffic.
