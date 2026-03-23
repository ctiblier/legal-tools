# Legal Toolkit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform batesstamp.com from a single Bates stamping tool into a multi-tool legal document toolkit with 7 new tools, shared infrastructure, and cross-tool pipeline.

**Architecture:** Static HTML/JS/CSS site on Cloudflare Pages. Each tool is a standalone `index.html` in its own directory under `batesstamp/`. Shared design system (`brand.css`) and shared JS modules (`file-handler.js`, `nav.js`) are copied into the deploy directory at build time. All PDF processing is client-side using pdf-lib and pdf.js.

**Tech Stack:** Vanilla HTML/JS/CSS, pdf-lib v1.17.1 (CDN), pdf.js (CDN), SortableJS (CDN), JSZip (CDN, for batch zip downloads), Cloudflare Pages

**Deferred to post-launch:** Web Workers for PDF processing (`pdf-worker.js`) and OPFS-based memory management for 1GB+ filings. The initial implementation uses main-thread processing with lazy loading and sequential merge, which handles filings up to ~500MB. Workers and OPFS will be added as a performance enhancement after the core tools are stable.

**Spec:** `docs/superpowers/specs/2026-03-22-legal-toolkit-design.md`

---

## File Map

### New Files to Create

```
shared/
├── file-handler.js          # Shared drag-drop upload, file validation, download logic
├── nav.js                   # Shared navigation component (injects header + nav + footer)
├── tools.js                 # Tool registry (names, paths, descriptions, icons)
├── pdf-worker.js            # DEFERRED: Web Worker for PDF processing (post-launch)
└── session-files.js         # Session file list manager (cross-tool pipeline)

batesstamp/
├── index.html               # NEW: toolkit homepage (replaces current Bates tool at root)
├── bates-stamp/
│   └── index.html           # MOVED: existing Bates tool (from batesstamp/index.html)
├── filing-assembler/
│   └── index.html           # NEW: filing assembler with slip sheets
├── redaction/
│   └── index.html           # NEW: privilege redaction tool
├── metadata-stripper/
│   └── index.html           # NEW: PDF metadata stripper
├── page-extractor/
│   └── index.html           # NEW: PDF page extractor/splitter
├── compressor/
│   └── index.html           # NEW: PDF compressor
├── watermark/
│   └── index.html           # NEW: document watermarking
├── pleading-paper/
│   └── index.html           # NEW: pleading paper generator
└── _redirects               # Cloudflare Pages redirect rules

build.sh                      # Build script (replaces single cp command)
```

### Files to Modify

```
batesstamp/styles.css         # Add styles for new tools, homepage, shared components
batesstamp/about.html         # Update to reflect toolkit (not single tool)
batesstamp/privacy-policy.html # Add pdf.js, SortableJS disclosures
batesstamp/terms-of-service.html # Update for toolkit scope
batesstamp/sitemap.xml        # Add all new tool URLs
batesstamp/manifest.json      # Update start_url and name
batesstamp/robots.txt         # No changes needed (already allows all)
pfscalculator/index.html      # Add cross-link to toolkit in nav and footer
pfscalculator/about.html      # Add cross-link to toolkit
shared/brand.css              # Minor additions for new component patterns
.gitignore                    # Add batesstamp/shared/
README.md                     # Update build commands and project description
```

---

## Task Sequence

Tasks are ordered by dependency. Infrastructure first, then tools from simplest to most complex, then cross-cutting concerns last.

---

### Task 1: Build Script & Infrastructure

**Files:**
- Create: `build.sh`
- Modify: `.gitignore`, `README.md`

This task sets up the build pipeline so shared files are available to all tools.

- [ ] **Step 1: Create the build script**

Create `build.sh` at the repo root:

```bash
#!/bin/bash
# Build script for BatesStamp Legal Toolkit
# Copies shared files into the Cloudflare Pages deploy directory (batesstamp/)

set -e

echo "Building BatesStamp Legal Toolkit..."

# Copy shared CSS (existing pattern)
cp shared/brand.css batesstamp/

# Copy shared JS modules (only if they exist — allows incremental development)
mkdir -p batesstamp/shared
for f in file-handler.js nav.js tools.js session-files.js pdf-worker.js; do
  if [ -f "shared/$f" ]; then
    cp "shared/$f" "batesstamp/shared/"
  fi
done

echo "Build complete."
```

- [ ] **Step 2: Update .gitignore**

Add `batesstamp/shared/` to `.gitignore` so build artifacts are not committed.

- [ ] **Step 3: Update README.md**

Update the Cloudflare Pages build command from `cp shared/brand.css batesstamp/` to `bash build.sh`. Update project description to reflect the toolkit.

- [ ] **Step 4: Verify build works locally**

Run: `cd /home/ctibs/Projects/legal-tools && bash build.sh`
Expected: No errors. `batesstamp/shared/` directory created (will be empty until shared JS is written).

- [ ] **Step 5: Commit**

```bash
git add build.sh .gitignore README.md
git commit -m "feat: add build script and update infrastructure for toolkit"
```

---

### Task 2: Tool Registry

**Files:**
- Create: `shared/tools.js`

Central registry of all tools — used by the nav component, homepage, and cross-tool pipeline. Single source of truth for tool names, paths, descriptions, and icons.

- [ ] **Step 1: Create tools.js**

```javascript
// Tool registry — single source of truth for all tool metadata
const TOOLS = [
  {
    id: 'bates-stamp',
    name: 'Bates Stamper',
    description: 'Add Bates numbers, exhibit stamps, and confidentiality notices to PDFs',
    path: '/bates-stamp/',
    icon: '#',  // SVG icon reference — will be defined in CSS/HTML
    category: 'document',
    umamiEvent: 'stamp-document',
    flagship: true
  },
  {
    id: 'filing-assembler',
    name: 'Filing Assembler',
    description: 'Combine motion, exhibits, and slip sheets into one PDF ready to e-file',
    path: '/filing-assembler/',
    icon: '📎',
    category: 'document',
    umamiEvent: 'assemble-filing'
  },
  {
    id: 'redaction',
    name: 'Privilege Redaction',
    description: 'Permanently redact sensitive content with labeled privilege reasons',
    path: '/redaction/',
    icon: '█',
    category: 'document',
    umamiEvent: 'redact-document'
  },
  {
    id: 'metadata-stripper',
    name: 'Metadata Stripper',
    description: 'Remove hidden author, dates, and edit history from PDFs before filing',
    path: '/metadata-stripper/',
    icon: '🔍',
    category: 'document',
    umamiEvent: 'strip-metadata'
  },
  {
    id: 'page-extractor',
    name: 'Page Extractor',
    description: 'Pull specific pages from a PDF for filing excerpts or partial exhibits',
    path: '/page-extractor/',
    icon: '📄',
    category: 'document',
    umamiEvent: 'extract-pages'
  },
  {
    id: 'compressor',
    name: 'PDF Compressor',
    description: 'Reduce PDF file size to meet e-filing upload limits',
    path: '/compressor/',
    icon: '📦',
    category: 'document',
    umamiEvent: 'compress-pdf'
  },
  {
    id: 'watermark',
    name: 'Document Watermark',
    description: 'Apply DRAFT, CONFIDENTIAL, or custom watermarks across PDF pages',
    path: '/watermark/',
    icon: '💧',
    category: 'document',
    umamiEvent: 'watermark-document'
  },
  {
    id: 'pleading-paper',
    name: 'Pleading Paper',
    description: 'Generate numbered-line pleading paper for California, Federal, or custom courts',
    path: '/pleading-paper/',
    icon: '📝',
    category: 'generator',
    umamiEvent: 'generate-pleading'
  },
  {
    id: 'pfs-calculator',
    name: 'PFS Calculator',
    description: 'Florida Statute 768.79 settlement threshold calculator',
    path: 'https://pfscalculator.com',
    icon: '🧮',
    category: 'calculator',
    external: true
  }
];

// Cross-tool suggestions: after using tool X, suggest tool Y
const TOOL_PIPELINE = {
  'bates-stamp': ['compressor', 'metadata-stripper'],
  'filing-assembler': ['bates-stamp', 'metadata-stripper', 'compressor'],
  'redaction': ['metadata-stripper'],
  'metadata-stripper': ['compressor'],
  'page-extractor': ['bates-stamp', 'watermark'],
  'compressor': [],
  'watermark': ['compressor'],
  'pleading-paper': []
};
```

- [ ] **Step 2: Commit**

```bash
git add shared/tools.js
git commit -m "feat: add tool registry with metadata and pipeline config"
```

---

### Task 3: Shared Navigation Component

**Files:**
- Create: `shared/nav.js`
- Modify: `shared/brand.css` (add tool dropdown styles)

The nav component injects a consistent header, navigation bar (with tool dropdown), and footer into every page. Each tool page just includes the script and calls `initNav()`.

- [ ] **Step 1: Create nav.js**

Build a JS module that:
1. Reads the current page path to determine which nav link is active
2. Injects the header HTML (site title, tagline)
3. Injects the nav bar with links: Home, Tools (dropdown), About, Privacy Policy, Terms
4. The "Tools" dropdown lists all tools from `TOOLS` array (loaded via `tools.js`)
5. Injects the footer (3-column: brand info, page links, tool links)
6. Includes the trust badge: "Your files never leave your browser"

The nav must match the existing `brand.css` header/nav/footer patterns exactly. Reference the current `batesstamp/index.html` lines 167-183 (nav) and 484-507 (footer) for the HTML structure to replicate.

Key details:
- `aria-current="page"` on the active link
- External tool links (PFS Calculator) open in new tab with `target="_blank" rel="noopener"`
- Tools dropdown: button that toggles a positioned list on click, closes on outside click or Escape
- Mobile: dropdown items stack vertically in the hamburger menu
- Footer copyright: "© 2026 BatesStamp.com. All processing happens on your device."

- [ ] **Step 2: Add dropdown styles to brand.css**

Add CSS for `.tools-dropdown` (positioned below the nav link), `.tools-dropdown-toggle` (the button), and `.tools-dropdown-item` styling. Follow existing nav color patterns (navy background, white text, gold hover underline). Add mobile breakpoint rules to stack dropdown items.

- [ ] **Step 3: Test nav component**

Create a minimal test HTML file (do not commit), include `tools.js` and `nav.js`, verify:
- Nav renders with all links
- Tools dropdown opens/closes on click
- Active page is highlighted
- Footer renders with correct links
- Mobile responsive (resize browser)

- [ ] **Step 4: Commit**

```bash
git add shared/nav.js shared/brand.css
git commit -m "feat: add shared navigation component with tools dropdown"
```

---

### Task 4: Shared File Handler

**Files:**
- Create: `shared/file-handler.js`

Extract and generalize the drag-and-drop upload pattern from the existing Bates stamper (`batesstamp/index.html` lines 511-564). This becomes the reusable file handler for all tools.

- [ ] **Step 1: Create file-handler.js**

Build a module that exports a function to initialize a file drop zone:

```javascript
function initFileDropZone(dropZoneId, options) {
  // options: {
  //   accept: ['.pdf', '.jpg', '.png'],  // allowed file types
  //   multiple: false,                    // allow multiple files
  //   maxSizeMB: 100,                     // max file size in MB
  //   onFile: (file) => {},               // callback when file is selected (single mode)
  //   onFiles: (files) => {},             // callback when files are selected (multiple mode)
  //   lazyLoad: true                      // store File reference only, don't read bytes
  // }
}
```

Features:
- Drag-and-drop with visual feedback (drag-over class toggle)
- Click-to-browse fallback via hidden file input
- File type validation with error messages
- File size validation and display
- SVG icon swap (upload icon → checkmark) on file selection
- Updates drop zone text with filename and formatted file size
- Status text: "Your document never leaves your browser. Max {maxSizeMB}MB."

Also export helper functions:
- `formatFileSize(bytes)` — returns human-readable size (KB, MB, GB)
- `downloadPdf(pdfBytes, filename)` — creates blob URL and triggers download
- `readFileAsArrayBuffer(file)` — returns Promise<ArrayBuffer>

Match the existing CSS classes: `.file-drop-zone`, `.drop-zone-icon`, `.drop-zone-text`, `.drop-zone-hint`, `.drop-zone-filename`, `.drag-over`, `.has-file`.

- [ ] **Step 2: Test with a minimal HTML page**

Create a test page (do not commit) that uses `initFileDropZone` to verify drag-drop, click-to-browse, validation, and visual feedback all work.

- [ ] **Step 3: Commit**

```bash
git add shared/file-handler.js
git commit -m "feat: add shared file handler with drag-drop, validation, and download"
```

---

### Task 5: Session File Manager

**Files:**
- Create: `shared/session-files.js`

Manages a session-scoped list of files the user has processed. Enables the cross-tool pipeline where output from one tool can be opened in another without re-uploading.

- [ ] **Step 1: Create session-files.js**

```javascript
// Session file manager — tracks processed files in memory for cross-tool pipeline
// Files are stored as in-memory Blob references — nothing is persisted to disk
// Cleared automatically when the tab closes

const sessionFiles = {
  files: [],  // Array of { name, blob, size, addedFrom, timestamp }

  add(name, blob, fromTool) { ... },
  remove(index) { ... },
  getAll() { ... },
  clear() { ... },

  // Render a small dropdown showing available files
  // When a file is clicked, call the provided callback with the Blob
  renderDropdown(containerId, onSelect) { ... }
};
```

Key implementation details:
- Store Blob references (not ArrayBuffers) to minimize memory duplication
- Maximum 10 files in the list (FIFO — oldest drops off when 11th is added)
- `renderDropdown` creates a small UI element showing file names and sizes
- Each file entry has a "Use in [Tool]" link that navigates to the tool with the file pre-loaded via URL hash parameter (e.g., `#session-file=0`)
- On page load, if URL hash contains `session-file=N`, auto-load that file into the drop zone
- Blobs cannot survive page navigation between different HTML pages. Approach: use a `SharedWorker` to hold blob references across page navigations. The worker stores blobs keyed by session file index. When page A adds a file, it posts the blob to the worker. When page B loads with a `#session-file=N` hash, it requests blob N from the worker. Fallback if `SharedWorker` is unavailable: prompt the user to re-upload (degrade gracefully). Alternative: open the target tool via `window.open()` and use `postMessage` to pass the blob before the original page unloads.

- [ ] **Step 2: Commit**

```bash
git add shared/session-files.js
git commit -m "feat: add session file manager for cross-tool pipeline"
```

---

### Task 6: Toolkit Homepage

**Files:**
- Create: `batesstamp/index.html` (new homepage — the current index.html will be moved in the next task)

**Important sequence:** Before this task, temporarily rename `batesstamp/index.html` to `batesstamp/bates-stamp-tool.html` so we don't lose it. It will be moved to `batesstamp/bates-stamp/index.html` in Task 7.

- [ ] **Step 1: Rename existing index.html (preserve git history)**

```bash
git mv batesstamp/index.html batesstamp/bates-stamp-tool.html
```

- [ ] **Step 2: Create the new homepage**

Create `batesstamp/index.html` — the toolkit landing page. Structure:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <!-- Google Analytics: G-13354133605 -->
  <!-- Umami: b5a8938f-fd00-486c-bf17-0352963407f3 -->
  <title>Free Legal Document Tools | BatesStamp.com</title>
  <meta name="description" content="Free, private, browser-based legal document tools. Bates stamping, redaction, filing assembly, and more. Your files never leave your browser.">
  <!-- canonical: https://batesstamp.com/ -->
  <!-- OG tags, Twitter card, structured data -->
  <!-- Load brand.css and styles.css -->
</head>
<body>
  <!-- Skip link -->
  <div class="container">
    <!-- Header: injected by nav.js -->
    <!-- Nav: injected by nav.js -->
    <main id="main-content">
      <!-- Hero section -->
      <section class="toolkit-hero">
        <h2>Free Legal Document Tools</h2>
        <p>Private. Secure. Browser-based. Your files never leave your device.</p>
      </section>

      <!-- Trust signals -->
      <div class="trust-badges">
        <span>No uploads</span>
        <span>No accounts</span>
        <span>No data collection</span>
      </div>

      <!-- Tool grid -->
      <section class="tool-grid">
        <!-- Flagship card (larger) for Bates Stamper -->
        <!-- Standard cards for each tool -->
        <!-- External card for PFS Calculator (opens pfscalculator.com) -->
      </section>
    </main>
    <!-- Footer: injected by nav.js -->
  </div>
  <script src="/shared/tools.js"></script>
  <script src="/shared/nav.js"></script>
  <script>
    // Render tool grid from TOOLS registry
    // Initialize nav
  </script>
</body>
</html>
```

The tool grid is generated from the `TOOLS` array so it stays in sync automatically. Each card shows: icon, tool name, one-line description, and a "Use Tool" link. The flagship tool (Bates Stamper) gets a larger card with a "Most Popular" badge.

- [ ] **Step 3: Add homepage styles to styles.css**

Add CSS for:
- `.toolkit-hero` — centered, padded section
- `.trust-badges` — flex row of small badge items with subtle styling
- `.tool-grid` — CSS grid, auto-fit, minmax(280px, 1fr)
- `.tool-card` — white card with border, hover shadow, gold top border on hover
- `.tool-card.flagship` — spans 2 columns on desktop, highlighted border
- `.tool-card.external` — subtle indicator for external links
- Responsive: single column on mobile

- [ ] **Step 4: Add structured data**

Add JSON-LD for:
- `WebSite` schema with name "BatesStamp.com" and URL
- `ItemList` schema listing all tools
- `Organization` schema (existing pattern)

- [ ] **Step 5: Test homepage locally**

Run: `bash build.sh && python3 -m http.server 8080 --directory batesstamp`
Verify: Homepage renders with tool grid, nav works, cards link correctly, responsive on mobile.

- [ ] **Step 6: Commit**

```bash
git add batesstamp/index.html batesstamp/bates-stamp-tool.html batesstamp/styles.css
git commit -m "feat: add toolkit homepage with tool grid"
```

---

### Task 7: Migrate Bates Stamper to /bates-stamp/

**Files:**
- Move: `batesstamp/bates-stamp-tool.html` → `batesstamp/bates-stamp/index.html`
- Create: `batesstamp/_redirects`
- Modify: `batesstamp/sitemap.xml`, `batesstamp/manifest.json`

- [ ] **Step 1: Create the bates-stamp directory and move the file**

```bash
mkdir -p batesstamp/bates-stamp
mv batesstamp/bates-stamp-tool.html batesstamp/bates-stamp/index.html
```

- [ ] **Step 2: Update internal references in the moved file**

In `batesstamp/bates-stamp/index.html`:
- Update CSS paths: `href="/brand.css"` and `href="/styles.css"` (absolute paths, no change needed)
- Update canonical URL: `https://batesstamp.com/bates-stamp/`
- Update `og:url`: `https://batesstamp.com/bates-stamp/`
- Update nav links to use absolute paths (they should already be absolute)
- Remove the header/nav/footer HTML and replace with `nav.js` injection (or keep inline initially and migrate later)
- Add `<script src="/shared/tools.js"></script>` and `<script src="/shared/nav.js"></script>`
- Add cross-tool suggestion links at the bottom (links to filing assembler, watermark, etc.)

- [ ] **Step 3: Create Cloudflare _redirects file**

Create `batesstamp/_redirects`:
```
# Redirect old Bates tool URL patterns to new location
# Note: the root (/) is now the homepage, not the Bates tool
```

No actual redirects needed since the root is now the homepage. If users had bookmarked `batesstamp.com` expecting the tool, they'll land on the homepage which prominently links to the tool.

- [ ] **Step 4: Update sitemap.xml**

Update `batesstamp/sitemap.xml` to include all new tool URLs:
- `/` (homepage, priority 1.0)
- `/bates-stamp/` (priority 0.9)
- `/filing-assembler/` (priority 0.8)
- `/redaction/` (priority 0.8)
- `/metadata-stripper/` (priority 0.8)
- `/page-extractor/` (priority 0.8)
- `/compressor/` (priority 0.8)
- `/watermark/` (priority 0.8)
- `/pleading-paper/` (priority 0.8)
- `/about.html` (priority 0.6)
- `/privacy-policy.html` (priority 0.4)
- `/terms-of-service.html` (priority 0.4)

- [ ] **Step 5: Update manifest.json**

Update `batesstamp/manifest.json`:
- `name`: "BatesStamp.com - Free Legal Document Tools"
- `short_name`: "BatesStamp"
- `description`: "Free, private, browser-based legal document tools"
- `start_url`: "/" (homepage — this is correct for the new structure)

- [ ] **Step 6: Test locally**

Run: `bash build.sh && python3 -m http.server 8080 --directory batesstamp`
Verify:
- Homepage at `/` shows tool grid
- Bates tool at `/bates-stamp/` works correctly (upload, stamp, download)
- Nav links work from both pages
- No broken asset references

- [ ] **Step 7: Commit**

```bash
git mv batesstamp/bates-stamp-tool.html batesstamp/bates-stamp/index.html
git add batesstamp/_redirects batesstamp/sitemap.xml batesstamp/manifest.json
git commit -m "feat: migrate Bates stamper to /bates-stamp/ and update sitemap"
```

---

### Task 8: Document Watermarking Tool

**Files:**
- Create: `batesstamp/watermark/index.html`

The simplest new tool — reuses the Bates stamper's pdf-lib text drawing pattern with rotation and opacity. Reference `batesstamp/bates-stamp/index.html` for the pdf-lib usage pattern.

- [ ] **Step 1: Create watermark/index.html**

HTML structure:
1. Analytics (GA + Umami), SEO meta tags, structured data
2. CSS links (`/brand.css`, `/styles.css`)
3. Shared scripts (`/shared/tools.js`, `/shared/nav.js`, `/shared/file-handler.js`)
4. pdf-lib CDN script (same unpkg URL as Bates stamper)

UI sections:
1. **File upload** — single PDF drop zone via `initFileDropZone`
2. **Watermark text** — preset select (DRAFT, CONFIDENTIAL, ATTORNEY EYES ONLY, PRIVILEGED, DO NOT DISTRIBUTE, COPY) + custom text input
3. **Appearance settings**:
   - Opacity: range slider, 10-100%, default 30%
   - Color: select (Gray, Red, Black), default gray
   - Position: select (Diagonal across page, Header, Footer, Centered), default diagonal
   - Font size: select (Auto-scale, Small, Medium, Large), default auto-scale
4. **Preview** — show first page with watermark overlay (optional, can defer to Phase 2)
5. **Action button** — "Apply Watermark" with `data-umami-event="watermark-document"`
6. **Status message** area

JavaScript:
- Load the uploaded PDF with `PDFDocument.load()`
- For each page:
  - Get page dimensions
  - Embed Helvetica font
  - Calculate text position based on selected position
  - For diagonal: rotate text ~45 degrees, center on page
  - Draw text with selected opacity and color using `page.drawText()`
- Save and trigger download via `downloadPdf()`

This follows the same pattern as the Bates stamper's `stampPDF()` function but with rotation for diagonal watermarks.

- [ ] **Step 2: Test the tool**

Open in browser. Upload a test PDF. Apply each watermark preset. Verify:
- Text appears on all pages
- Diagonal rotation looks correct
- Opacity slider works
- Color options work
- Download produces valid PDF

- [ ] **Step 3: Commit**

```bash
git add batesstamp/watermark/
git commit -m "feat: add document watermarking tool"
```

---

### Task 9: PDF Metadata Stripper

**Files:**
- Create: `batesstamp/metadata-stripper/index.html`

Uses pdf-lib's metadata API to read and remove document properties.

- [ ] **Step 1: Create metadata-stripper/index.html**

UI sections:
1. **File upload** — single or multiple PDF drop zone (multiple mode)
2. **Metadata display** — after upload, show a table of found metadata:
   - Title, Author, Subject, Keywords, Creator, Producer
   - Creation Date, Modification Date
   - Custom metadata fields
   - Annotation count (if any — shown separately with explanation)
   - XMP metadata (present/not present)
3. **Options** — checkboxes:
   - "Strip all metadata" (checked by default)
   - "Also remove annotations (comments, highlights, sticky notes)" (unchecked by default, with explanation text)
4. **Action button** — "Strip Metadata" with `data-umami-event="strip-metadata"`
5. **Status/results** — show before/after comparison (what was removed)

JavaScript:
- Load PDF with `PDFDocument.load()`
- Read metadata: `pdf.getTitle()`, `pdf.getAuthor()`, `pdf.getSubject()`, `pdf.getKeywords()`, `pdf.getCreator()`, `pdf.getProducer()`, `pdf.getCreationDate()`, `pdf.getModificationDate()`
- Display found values in the UI
- On strip: `pdf.setTitle('')`, `pdf.setAuthor('')`, etc.
- For XMP: check if XMP exists via `pdfDoc.catalog.get(PDFName.of('Metadata'))`, then remove with `pdfDoc.catalog.delete(PDFName.of('Metadata'))`. Import `PDFName` from pdf-lib.
- For annotations: iterate pages, get `/Annots` array, clear if user opted in
- Save and download

For batch mode: process each file, zip results using JSZip (add CDN), or download individually if only 2-3 files.

- [ ] **Step 2: Test with a metadata-rich PDF**

Create a test PDF with metadata using any PDF tool. Upload to the stripper. Verify:
- All metadata fields are detected and displayed
- After stripping, verify with a PDF viewer that metadata is gone
- Annotation removal works when opted in
- Batch upload works with multiple files

- [ ] **Step 3: Commit**

```bash
git add batesstamp/metadata-stripper/
git commit -m "feat: add PDF metadata stripper tool"
```

---

### Task 10: PDF Page Extractor

**Files:**
- Create: `batesstamp/page-extractor/index.html`

Uses pdf-lib's `copyPages` and pdf.js for page thumbnails.

- [ ] **Step 1: Create page-extractor/index.html**

Add pdf.js CDN script alongside pdf-lib.

UI sections:
1. **File upload** — single PDF drop zone
2. **Page thumbnails** — after upload, render each page as a small thumbnail using pdf.js canvas rendering (150px wide). Each thumbnail is clickable to select/deselect. Selected pages get a blue border/overlay with page number badge.
3. **Page range input** — text input for manual entry: "1-3, 7, 12-15". Syncs with thumbnail selection.
4. **Controls**:
   - "Select All" / "Deselect All" buttons
   - Page count display: "X of Y pages selected"
5. **Action button** — "Extract Pages" with `data-umami-event="extract-pages"`
6. **Status/download** area

JavaScript:
- On upload: render all pages as thumbnails using pdf.js
  - `pdfjsLib.getDocument(arrayBuffer)` → for each page: `page.render()` to a small canvas
- Track selected pages in a Set
- On extract: load PDF with pdf-lib, `copyPages()` for selected page indices, create new document, save and download
- Parse page range input: handle "1-3, 7, 12-15" format, validate against total page count
- Sync thumbnail selection ↔ page range input bidirectionally

For split mode (stretch): add a "Split" tab that lets user specify split points (e.g., "every 10 pages" or "at pages 5, 12, 20"). Creates multiple PDFs. Download as zip.

- [ ] **Step 2: Test with a multi-page PDF**

Upload a 20+ page PDF. Verify:
- Thumbnails render for all pages
- Click to select/deselect works
- Page range input works and syncs with thumbnails
- Extract produces correct pages
- Edge cases: select all, select none (disable button), single page

- [ ] **Step 3: Commit**

```bash
git add batesstamp/page-extractor/
git commit -m "feat: add PDF page extractor with thumbnail selection"
```

---

### Task 11: Pleading Paper Generator

**Files:**
- Create: `batesstamp/pleading-paper/index.html`

Pure pdf-lib page creation — no input PDF needed. Generates a blank pleading paper PDF.

- [ ] **Step 1: Create pleading-paper/index.html**

UI sections:
1. **Format selection** — radio buttons or select:
   - California (28 lines)
   - Federal (25 lines)
   - Custom
2. **Settings panel**:
   - Line count: number input (default from format, editable in Custom mode)
   - Page count: number input (how many pages to generate, default 1)
   - Line number position: Left margin (default)
   - Margins: inputs for top, bottom, left, right (pre-filled per format)
3. **Caption section** (optional, collapsible):
   - Court name (text input)
   - Case caption (textarea — plaintiff vs. defendant)
   - Case number (text input)
   - Document title (text input)
4. **Action button** — "Generate Pleading Paper" with `data-umami-event="generate-pleading"`

JavaScript:
- Create new `PDFDocument` with pdf-lib
- Set page size to US Letter (8.5" x 11" = 612 x 792 points)
- For each page:
  - Draw left margin line (vertical line at the specified left margin position)
  - Draw numbered lines:
    - Calculate line spacing based on line count and usable area
    - For each line: draw a horizontal line and the line number in the left margin
  - If caption provided: draw court name centered at top, case caption block, case number, document title
  - If page numbers enabled: draw centered page number at bottom
- Embed a standard font (Times-Roman for legal documents)
- Save and download

Format presets:
- **California**: 28 lines, 1" margins, double vertical lines at left margin (at 1" and 1.25"), line numbers in 10pt
- **Federal**: 25 lines, 1" margins, single vertical line, line numbers in 10pt
- **Custom**: all fields editable

- [ ] **Step 2: Test output**

Generate each format. Open in a PDF viewer. Verify:
- Correct number of lines
- Line numbers properly aligned in margin
- Margins match expected values
- Caption fills in correctly when provided
- Multiple pages generate correctly

- [ ] **Step 3: Commit**

```bash
git add batesstamp/pleading-paper/
git commit -m "feat: add pleading paper generator"
```

---

### Task 12: PDF Compressor

**Files:**
- Create: `batesstamp/compressor/index.html`

Uses the rasterize-and-rebuild pattern: pdf.js renders pages to canvas, pdf-lib rebuilds from images.

- [ ] **Step 1: Create compressor/index.html**

Load pdf.js and pdf-lib from CDN.

UI sections:
1. **File upload** — single or multiple PDF drop zone
2. **File info** — show current file size after upload
3. **Compression level** — radio buttons:
   - Light (200 DPI) — "Minimal quality loss, ~20-40% reduction"
   - Medium (150 DPI) — "Balanced quality and size, ~40-60% reduction" (default)
   - Heavy (100 DPI) — "Maximum reduction, some quality loss"
4. **Warning notice** (shown after upload): "Compression converts pages to images. Text will no longer be searchable or selectable. For scanned documents, there is no difference."
5. **Action button** — "Compress PDF" with `data-umami-event="compress-pdf"`
6. **Progress bar** — percentage + "Compressing page X of Y..."
7. **Results** — show original size, compressed size, reduction percentage

JavaScript:
- Load PDF with pdf.js: `pdfjsLib.getDocument(arrayBuffer)`
- For each page:
  - Get page dimensions
  - Create canvas at target DPI (scale = targetDPI / 72)
  - Render page to canvas: `page.render({ canvasContext, viewport })`
  - Convert canvas to JPEG data URL: `canvas.toDataURL('image/jpeg', quality)` (quality: 0.85 for light, 0.75 for medium, 0.65 for heavy)
  - Embed JPEG into new pdf-lib PDFDocument
  - Update progress bar
- Save and trigger download
- Show before/after size comparison

Batch mode: process each file individually, show results table.

- [ ] **Step 2: Test with various PDFs**

Test with:
- A text-heavy PDF (should reduce significantly)
- A scanned/image PDF (should maintain quality)
- A large PDF (50+ pages — verify progress bar works)
Each compression level should produce different file sizes.

- [ ] **Step 3: Commit**

```bash
git add batesstamp/compressor/
git commit -m "feat: add PDF compressor with rasterize-and-rebuild"
```

---

### Task 13: Privilege Redaction Tool

**Files:**
- Create: `batesstamp/redaction/index.html`

Most complex single tool — pdf.js for rendering, canvas for drawing redaction boxes, rasterize-and-rebuild for permanent redaction.

- [ ] **Step 1: Create redaction/index.html — HTML structure and styles**

UI layout:
1. **File upload** — single PDF drop zone
2. **Redaction workspace** (appears after upload):
   - **Page viewer** — large canvas showing current page (rendered by pdf.js)
   - **Page navigation** — prev/next buttons, page number display, page thumbnails sidebar
   - **Drawing mode** — user clicks and drags on the canvas to draw redaction rectangles
   - **Redaction reason selector** — dropdown that applies to the next drawn box:
     - Attorney-Client Privilege
     - Work Product Doctrine
     - Confidential / Proprietary
     - Privacy / Personal Information
     - Trade Secret
     - Custom (text input)
   - **Redaction list** — shows all drawn redactions with page number, coordinates, and reason. Each entry has a delete button.
   - **"Apply to all pages"** — checkbox to apply the same reason to all boxes
3. **Actions**:
   - "Preview Redacted" — shows rasterized preview
   - "Apply Redactions & Download" with `data-umami-event="redact-document"`
4. **Warning**: "Redactions are permanent. The original text is irrecoverably removed."

- [ ] **Step 2: Implement page rendering with pdf.js**

JavaScript for the page viewer:
- Load PDF with `pdfjsLib.getDocument()`
- Render current page to a display canvas at screen resolution
- Scale to fit the workspace width (maintain aspect ratio)
- Page navigation: prev/next buttons update the displayed page
- Store page dimensions for coordinate mapping

- [ ] **Step 3: Implement redaction box drawing**

JavaScript for the canvas interaction:
- On mousedown: start recording a rectangle (startX, startY)
- On mousemove (while dragging): draw a semi-transparent red overlay showing the rectangle being drawn
- On mouseup: finalize the rectangle, add to the redaction list for this page with the selected reason
- Draw all existing redaction boxes on the current page as semi-transparent red overlays with white text labels showing the reason
- Support deleting individual redaction boxes from the list
- Map canvas coordinates to PDF page coordinates (account for scale factor)
- Touch support: same interaction with touchstart/touchmove/touchend

- [ ] **Step 4: Implement rasterize-and-rebuild for permanent redaction**

JavaScript for the "Apply Redactions" action:
1. For each page in the PDF:
   a. Render page to a high-resolution canvas (300 DPI) using pdf.js
   b. For each redaction box on this page:
      - Draw a filled black rectangle at the redaction coordinates
      - Draw white text label (the redaction reason) centered in the black box
   c. Convert canvas to JPEG (quality 0.92 for high quality at 300 DPI)
   d. Embed JPEG into new pdf-lib PDFDocument
   e. Update progress bar: "Processing page X of Y..."
2. Strip all metadata from the output PDF
3. Save and trigger download

- [ ] **Step 5: Test redaction thoroughly**

Critical test: open the output PDF in a text editor or PDF inspector. Verify that no original text content exists — only image data. This is the most important test for this tool.

Also test:
- Drawing multiple boxes on one page
- Boxes on different pages
- Different redaction reasons per box
- Deleting a box from the list
- Large PDF performance

- [ ] **Step 6: Commit**

```bash
git add batesstamp/redaction/
git commit -m "feat: add privilege redaction tool with rasterize-and-rebuild"
```

---

### Task 14: Filing Assembler

**Files:**
- Create: `batesstamp/filing-assembler/index.html`

The most complex tool. Multi-file upload, drag-to-reorder with SortableJS, auto-generated slip sheets, and memory management for large filings.

- [ ] **Step 1: Create filing-assembler/index.html — HTML structure**

Load pdf-lib, pdf.js, and SortableJS from CDN.

UI layout:
1. **Main document upload** — drop zone for the motion/brief (single PDF)
2. **Exhibit list** — sortable list where each entry shows:
   - Drag handle (hamburger icon)
   - Exhibit label (auto-assigned: "Exhibit A", "Exhibit B", etc. — editable)
   - Filename and page count
   - Remove button
3. **"Add Exhibit" drop zone** — below the list, for adding more exhibits (PDF or images)
4. **Slip sheet options** (collapsible panel):
   - Label format: select (Exhibit A/B/C, Exhibit 1/2/3, Plaintiff's Exhibit, Defendant's Exhibit, Custom)
   - Case caption: text inputs (case name, case number, court name) — optional
   - Font size: select (default 24pt)
   - Orientation: select (Auto-match exhibit, Portrait, Landscape)
5. **Additional options** (collapsible):
   - "Include cover sheet" checkbox
   - "Include table of contents" checkbox
6. **Summary** — running total: number of exhibits, total page count, estimated file size
7. **Action button** — "Assemble Filing" with `data-umami-event="assemble-filing"`
8. **Progress bar** — "Assembling page X of Y..."

- [ ] **Step 2: Implement file management and SortableJS**

JavaScript:
- Initialize exhibit list with `new Sortable(exhibitList, { handle: '.drag-handle', animation: 150, onEnd: updateExhibitLabels })`
- When exhibits are reordered, auto-update labels (A, B, C, etc.)
- Store only `File` references (lazy loading) — do not read bytes until assembly
- Display page count per exhibit by quickly loading with pdf-lib to read `getPageCount()`
- For image files: display as single-page entry
- Support drag-and-drop onto the exhibit zone, or click-to-browse for multiple files
- Auto-assign next sequential label when a new exhibit is added

- [ ] **Step 3: Implement slip sheet generation**

JavaScript function `createSlipSheet(label, options)`:
- Create a single-page PDFDocument
- Page size: match the first page of the following exhibit (auto-match), or use Letter size
- Center the label text (e.g., "EXHIBIT A") on the page
  - Font: Helvetica-Bold, size from options (default 36pt)
  - Vertically and horizontally centered
- If case caption provided: draw it above the label in smaller font
  - Court name (centered, 14pt)
  - Case name (centered, 12pt)
  - Case number (centered, 12pt)
- Return the single-page PDF bytes

- [ ] **Step 4: Implement assembly with sequential merge**

JavaScript function `assembleFiling()`:
1. Create output `PDFDocument`
2. If cover sheet enabled: generate and add cover sheet page
3. Track page counts for TOC (first pass)
4. For each exhibit (in order):
   a. Generate slip sheet → copy its page into output
   b. Read exhibit file bytes (lazy load now)
   c. If PDF: load with pdf-lib, `copyPages()` into output
   d. If image: embed image into a new page sized to the image
   e. Release exhibit source bytes
   f. Update progress bar
5. If TOC enabled: generate TOC page(s) with exhibit names and starting page numbers, insert after cover sheet (requires two-pass: first pass to count pages, then generate TOC and insert)
6. Save output and trigger download
7. Add output to session file list for cross-tool pipeline

Memory management:
- Only `File` references stored until processing
- Each exhibit's bytes are released after copying into output
- Show running file size total as warning indicator
- Progress reporting via status messages

- [ ] **Step 5: Implement "insert slip sheets into existing PDF" mode**

Add a toggle or tab: "I already have a merged PDF, just add slip sheets"
- Upload single PDF
- User specifies page numbers where slip sheets should be inserted (e.g., "before page 5, before page 12")
- Tool loads the PDF, inserts generated slip sheet pages at specified positions
- Download modified PDF

- [ ] **Step 6: Test thoroughly**

Test scenarios:
- 3 exhibits (PDF files) with default slip sheets → verify order, labels, slip sheets present
- Reorder exhibits → verify labels update, output reflects new order
- Image file as exhibit → verify it appears as a single page
- Large filing (many exhibits) → verify progress bar and no freezing
- Slip sheet with case caption → verify formatting
- TOC generation → verify page numbers are correct
- Insert slip sheets into existing PDF → verify pages are in right places

- [ ] **Step 7: Commit**

```bash
git add batesstamp/filing-assembler/
git commit -m "feat: add filing assembler with slip sheets and SortableJS"
```

---

### Task 15: Cross-Tool Pipeline Integration

**Files:**
- Modify: all tool `index.html` files

Add the "Open in Next Tool" suggestions and session file list dropdown to each tool.

- [ ] **Step 1: Add post-processing suggestions to each tool**

After a tool completes processing (download triggered), show a section:
```
Done! Open your result in another tool:
[Bates Stamper] [Metadata Stripper] [Compressor]
```

The suggested tools come from the `TOOL_PIPELINE` map in `tools.js`. Each button navigates to the tool's page. The output blob is added to the session file manager so it's available on the next page.

- [ ] **Step 2: Add session file dropdown to all tools**

On each tool page, if there are files in the session file manager, show a small "Recent Files" dropdown near the file upload zone. Clicking a file from the list loads it into the drop zone as if the user had uploaded it.

- [ ] **Step 3: Test the pipeline**

1. Upload a PDF to the watermark tool
2. Apply a watermark
3. Click "Open in Compressor" suggestion
4. Verify the watermarked PDF is pre-loaded in the compressor
5. Compress it
6. Verify session file list shows both the watermarked and compressed versions

- [ ] **Step 4: Commit**

```bash
git add batesstamp/*/index.html shared/session-files.js
git commit -m "feat: add cross-tool pipeline and session file list"
```

---

### Task 16: Site-Wide Updates

**Files:**
- Modify: `batesstamp/about.html`, `batesstamp/privacy-policy.html`, `batesstamp/terms-of-service.html`
- Modify: `pfscalculator/index.html`, `pfscalculator/about.html`

- [ ] **Step 1: Update about.html**

Rewrite to describe the toolkit, not just the Bates stamper:
- Mission box: "Free, private legal document tools for everyone"
- Feature grid: one card per tool (generated or hardcoded)
- Who this is for: expanded list covering all tool users
- Contact section: same email, same response time
- Cross-link to pfscalculator.com

- [ ] **Step 2: Update privacy-policy.html**

Add disclosures for:
- pdf.js (loaded from CDN — Mozilla)
- SortableJS (loaded from CDN)
- All processing remains client-side
- Session file list: stored in browser memory only, cleared on tab close
- No new data collection beyond existing GA + Umami

- [ ] **Step 3: Update terms-of-service.html**

- Update "Description of Service" to cover all tools
- Update "Third-Party Services" to include pdf.js and SortableJS
- Add specific disclaimers for redaction tool: "permanent redaction uses rasterization — verify output before filing"

- [ ] **Step 4: Add cross-links to PFS Calculator**

In `pfscalculator/index.html`:
- Add a link in the nav or a banner: "More free legal tools at BatesStamp.com"
- Add a "More Tools" section in the footer linking to batesstamp.com

In `pfscalculator/about.html`:
- Add "Other Free Tools" section linking to batesstamp.com toolkit

- [ ] **Step 5: Commit**

```bash
git add batesstamp/about.html batesstamp/privacy-policy.html batesstamp/terms-of-service.html
git add pfscalculator/index.html pfscalculator/about.html
git commit -m "feat: update legal pages and add cross-links for toolkit"
```

---

### Task 17: Analytics & SEO

**Files:**
- Modify: all new tool pages

- [ ] **Step 1: Verify analytics on all tool pages**

Each tool page must have:
- Google Analytics: `G-13354133605`
- Umami: website ID `b5a8938f-fd00-486c-bf17-0352963407f3`, script from `umami.ctibs.app`
- Custom Umami event on the primary action button (defined in `TOOLS` registry)

Check every tool page has the correct analytics tags in the `<head>`.

- [ ] **Step 2: Add SEO meta tags and structured data to all tool pages**

Each tool page needs:
- Unique `<title>` targeting relevant search queries (include "Free" and "Online")
- Unique `<meta name="description">` (150-160 chars)
- Canonical URL
- Open Graph tags (title, description, url, image, type)
- Twitter card tags
- JSON-LD structured data:
  - `WebApplication` schema for each tool
  - `FAQPage` schema with 3-5 relevant Q&A pairs per tool
  - `BreadcrumbList` schema: Home > [Tool Name]

Example title/description patterns:
- Watermark: "Free PDF Watermark Tool | Add CONFIDENTIAL, DRAFT Stamps Online | BatesStamp.com"
- Redaction: "Free PDF Redaction Tool | Permanently Redact Privileged Documents Online | BatesStamp.com"
- Compressor: "Free PDF Compressor | Reduce File Size for E-Filing | BatesStamp.com"

- [ ] **Step 3: Commit**

```bash
git add batesstamp/*/index.html
git commit -m "feat: add analytics and SEO to all tool pages"
```

---

### Task 18: Final Testing & Cleanup

- [ ] **Step 1: Full build and local test**

```bash
cd /home/ctibs/Projects/legal-tools
bash build.sh
python3 -m http.server 8080 --directory batesstamp
```

Walk through every page:
- Homepage: tool grid renders, all links work
- Each tool: upload → process → download works
- Nav: tools dropdown works on every page, active state correct
- Footer: all links work, cross-site links work
- Mobile: resize to 375px width, verify all tools are usable
- Cross-tool pipeline: process a file, use "Open in Next Tool"

- [ ] **Step 2: Verify no broken references**

Check for:
- Broken CSS/JS paths (all should be absolute: `/brand.css`, `/styles.css`, `/shared/*.js`)
- Broken image/asset references
- Incorrect canonical URLs
- Mismatched analytics IDs

- [ ] **Step 3: Validate HTML**

Run each page through basic validation — check for unclosed tags, duplicate IDs (a past issue per commit 02a1cfd), missing alt text, missing aria labels.

- [ ] **Step 4: Commit any final fixes**

```bash
# Stage only the specific files that were fixed — review with git diff first
git diff --name-only
# Then add specific files:
git add [specific files from diff]
git commit -m "fix: final testing cleanup and fixes"
```

---

## Build Order Summary

```
Task 1:  Infrastructure (build.sh, .gitignore, README)
Task 2:  Tool Registry (tools.js)
Task 3:  Shared Navigation (nav.js, dropdown CSS)
Task 4:  Shared File Handler (file-handler.js)
Task 5:  Session File Manager (session-files.js)
Task 6:  Toolkit Homepage (new index.html)
Task 7:  Bates Stamper Migration (move to /bates-stamp/)
Task 8:  Document Watermarking (simplest new tool)
Task 9:  PDF Metadata Stripper
Task 10: PDF Page Extractor
Task 11: Pleading Paper Generator
Task 12: PDF Compressor
Task 13: Privilege Redaction (most complex single tool)
Task 14: Filing Assembler (most complex overall)
Task 15: Cross-Tool Pipeline Integration
Task 16: Site-Wide Updates (about, privacy, terms, cross-links)
Task 17: Analytics & SEO
Task 18: Final Testing & Cleanup
```

Tasks 1-7 are sequential (each depends on previous). Tasks 8-14 (individual tools) can be built in any order after Task 7, but the listed order goes from simplest to most complex. Tasks 15-18 depend on all tools being complete.
