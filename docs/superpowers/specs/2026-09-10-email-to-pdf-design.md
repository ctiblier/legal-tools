# Email to PDF — Design

**Date:** 2026-09-10
**Site:** BatesStamp.com
**Tool slug:** `/email-to-pdf/`
**Status:** Approved design, pending implementation plan

---

## 1. Purpose

Convert `.eml` email files into PDFs suitable for use as evidence: searchable,
Bates-stampable, visually faithful enough to read like the original message, and
carrying enough provenance that the conversion itself can be authenticated.

Conversion happens entirely in the browser. No email content, no attachment, and
no derived hash ever leaves the user's machine. This is a hard constraint, not a
preference: the tool's users are handling privileged and confidential material,
and the site's standing promise is that files are never uploaded.

### Why this tool belongs on this site

Email is the single most common form of documentary evidence in civil practice
and the most awkward to produce. The existing workflow is a lawyer printing to
PDF from Outlook, which loses the header chain, silently renders in the
reviewer's own time zone, fires the sender's tracking pixels, and produces
nothing that ties the printout to the file it came from. Every one of those is
a defect this tool can remove, and the output drops directly into the Bates
Stamper with no OCR step in between.

---

## 2. Goals and non-goals

### Goals

- Searchable, selectable vector text output — never a page of pixels.
- Visual treatment good enough that the result reads as a considered document.
- Provenance sufficient to authenticate the conversion: raw headers, hashes,
  and a certificate stating what was and was not preserved.
- Batch conversion of a production-sized set without the tab falling over.
- Never silently alter or omit content. Every limitation is disclosed on the
  face of the document.

### Non-goals for v1

Each of these is a plausible follow-on. None blocks shipping.

- `.msg` (Outlook) input — deferred to v2, behind the same `EmailRecord`
  interface so the parser is the only thing that changes.
- `.pst` / `.mbox` container extraction.
- Converting `.docx` / `.xlsx` / other office attachments to PDF. Not
  achievable in-browser at acceptable quality; attempting it would produce
  documents that misrepresent their sources.
- Thread deduplication and conversation collapsing.
- OCR of image attachments.
- Bates numbering — that is the existing tool, one click away.

---

## 3. Decisions and their reasoning

These are the choices that shaped everything else. They are recorded with
reasoning because each has a plausible-sounding alternative that is wrong for
this use case.

### 3.1 Vector rebuild, not raster snapshot

The body is parsed and re-laid-out as real PDF text rather than screenshotted
with html2canvas.

A raster snapshot is pixel-faithful and useless: no text layer, so `Ctrl-F`
finds nothing and the Bates Stamper's downstream search sees an empty document;
roughly 800 KB per page against 12 KB; pagination has to be hand-sliced anyway;
and because remote images must stay blocked for privacy (§3.4), even the
"fidelity" is partial — the snapshot faithfully captures broken-image boxes.
Fidelity that costs searchability is a bad trade in a document whose purpose is
to be searched, cited, and quoted.

The cost is honest and accepted: the output will not be pixel-identical to
Outlook. It supports a deliberate subset of HTML (§4.2) that covers what email
actually contains.

### 3.2 Dates print verbatim

The `Date` header renders exactly as received, original UTC offset intact:
`Tue, 4 Mar 2026 09:14:22 -0800`.

Normalizing to the reviewer's local time zone is a silent alteration of
evidence, and time zone is frequently the disputed fact — whether a notice
landed before a deadline, whether a message predates a meeting. A converter
that quietly rewrites it has damaged the exhibit. Where a local equivalent is
shown at all, it is parenthesized and explicitly labeled as computed.

### 3.3 Nothing is ever truncated

Long bodies paginate. Wide tables split across pages with the header row
repeated. A 400-row table becomes twelve pages. There is no ellipsis anywhere
in this tool's output. A truncated exhibit is a misleading exhibit.

### 3.4 Remote images are blocked, and the block is visible

Every remote `http(s)` image reference is dropped and replaced with a labeled
placeholder box reading *"remote image not loaded"*.

The motivation is privacy before safety: loading a remote image fires the
sender's tracking pixel and tells them, with a timestamp and an IP address,
that their email is being reviewed. For opposing counsel's correspondence that
is an unacceptable disclosure.

The placeholder is deliberately visible rather than a blank gap. A gap is a
silent alteration; a labeled box is a disclosure. The certificate page (§5.1)
repeats the fact.

### 3.5 Disclosure over silence, everywhere

Wherever the tool cannot faithfully reproduce something — a character outside
the embedded fonts, an attachment it cannot append, a body it cannot decode, a
stylesheet it does not apply — it renders what it can and **states the
limitation on the certificate page**. Silent success on incomplete output is
the one failure mode this tool cannot have.

---

## 4. Architecture

Five modules plus a tool page. The load-bearing boundary is in the middle:
**HTML parsing never learns about PDFs, and the PDF renderer never learns about
email.** That is what makes the risky module testable and the renderer
reusable.

```
.eml bytes
    |
    v
  parse.js            -> EmailRecord      (postal-mime; headers, bodies, parts)
    |
    v
  html-to-blocks.js   -> block IR         (pure function; sanitize + interpret)
    |
    v
  layout.js           -> pages            (line breaking, pagination, drawing)
    ^
    |
  themes.js           -> theme object     (fonts, sizes, colors, header block)

  assemble.js         orchestrates all of the above + manifest, appendices,
                      merged attachment PDFs, certificate, embedded source
```

### 4.1 `shared/eml/parse.js`

Wraps `postal-mime`. Returns a normalized `EmailRecord`:

```js
{
  rawBytes,          // Uint8Array of the source file, retained for hashing
  rawHeaderBlock,    // string, verbatim (see note below)
  headers,           // [{ key, value }] as parsed
  from, to, cc, bcc, // [{ name, address }]
  date,              // { raw: string, parsed: Date|null }
  subject,           // decoded (RFC 2047)
  messageId,
  bodyHtml,          // string|null
  bodyText,          // string|null
  bodyPartUsed,      // 'html' | 'text' | 'none'
  attachments,       // [{ filename, mimeType, size, bytes, contentId,
                     //    disposition, sha256, error? }]
  inlineImages,      // Map<contentId, attachment>
  nested,            // [EmailRecord] for message/rfc822 parts
  defects            // [{ code, detail }] anything parse could not do
}
```

**Implementation note:** postal-mime exposes headers as a parsed key/value
array, not as the verbatim block. The raw header block is obtained separately by
slicing the source bytes up to the first CRLFCRLF (falling back to LFLF) and
decoding as ASCII. The raw appendix (§5.2) must be the bytes as received, not a
re-serialization of parsed values.

**Body part selection.** When both `text/html` and `text/plain` are present,
render the HTML — that is what the sender composed and the recipient saw. Use
plain only when there is no HTML part. `bodyPartUsed` records the choice and
the certificate reports it. `multipart/alternative` selects the richest part;
`multipart/related` resolves inline images by `Content-ID`; `message/rfc822`
parts are parsed recursively into `nested` and rendered as indented sub-records
rather than flattened into the parent.

**Substituting a `.msg` parser in v2** means writing a module that produces this
same shape. Nothing downstream changes.

### 4.2 `shared/eml/html-to-blocks.js`

A pure function: HTML string in, block IR out. No I/O, no live-DOM insertion, no
PDF knowledge. This module carries nearly all of the interpretive risk in the
system, and being pure is what makes it genuinely testable (§8).

**Sanitization.** The HTML is parsed with `DOMParser` into a detached document
that is never attached to the live DOM, so nothing executes and nothing loads.
Then `script`, `style`, `iframe`, `object`, `embed`, `svg`, `link`, and all
event-handler attributes are removed. Remote images are replaced per §3.4.
`cid:` images resolve from `inlineImages`; `data:` URIs pass through.

**Block IR.** A flat array. Blocks nest only via an explicit `children` array
(blockquotes, list items, table cells):

- `paragraph` — `{ runs: [{ text, bold, italic, underline, strike, color,
  sizeScale, href }] }`
- `heading` — `{ level: 1..6, runs }`
- `list` — `{ ordered, depth, items: [ [blocks] ] }`
- `blockquote` — `{ depth, children: [blocks] }` — quoted replies, the most
  common structure in litigation email
- `table` — `{ rows: [[{ runs, colspan, rowspan, header }]] }`
- `image` — `{ ref, widthPx, heightPx, alt }`
- `preformatted` — `{ text }`
- `rule`, `spacer`

Plain-text bodies go through a small separate path producing `preformatted` and
`blockquote` blocks, detecting `>` quote levels and bare URLs.

### 4.3 `shared/pdf/layout.js`

Block IR + theme + pdf-lib document, in; drawn pages, out. Knows nothing about
email. Responsible for line breaking, pagination, widow and orphan control,
table splitting with repeated header rows, image scaling, blockquote indent
rails, and the per-page footer.

### 4.4 `shared/eml/themes.js`

Three preset theme objects. Each supplies fonts, sizes, a color set, page
margins, and a header-block renderer.

- **`mail-client`** *(default)* — echoes how the message looked on screen.
  Subject as the leading line, sender name in bold above a lighter address
  line, recipients beneath, timestamp ranged right, a soft tinted header band,
  sans-serif throughout. Familiar to a judge or jury who read email the same way
  every day.
- **`exhibit`** — formal court-exhibit treatment in the site's Crimson Pro /
  DM Sans navy-and-gold system. Ruled header table, hairline rules, small-caps
  field labels, serif body at 10.5pt, generous margins. Prints well in black and
  white and photocopies cleanly.
- **`minimal`** — no rules or bands. Field labels small and gray in the left
  margin, values ranged left, body flowing beneath. Typography and whitespace
  only.

All three share the same footer, manifest, appendix, and certificate rendering.
The theme governs the header block and the type system, nothing structural.

### 4.5 `shared/eml/assemble.js`

Orchestrates a single `EmailRecord` into finished PDF bytes, in order: header
block, body, attachment manifest, appended attachment PDFs and image pages, raw
header appendix, certificate. Handles pdf-lib page copying (`copyPages`) and
source-file embedding (`attach`).

### 4.6 The tool page — `/email-to-pdf/`

Registered in `shared/tools.js` as `email-to-pdf`, category `document`, umami
event `convert-email`, with `TOOL_PIPELINE` suggestions into `bates-stamp`,
`redaction`, and `filing-assembler`. Uses the existing `initFileDropZone` with
`accept: ['.eml']`, multi-file, and integrates with `sessionFiles` so output
can be carried to the next tool.

---

## 5. Output document structure

For a single email, in order:

1. **Header block** — per the selected theme.
2. **Body** — the rendered block IR.
3. **Attachment manifest** — index, filename, MIME type, size, SHA-256, and
   disposition (appended / ZIP only / could not be read, with the reason).
   Omitted entirely when there are no attachments.
4. **Appended attachments** — PDFs merged behind a labeled separator page;
   images as full pages scaled to fit with the filename beneath.
5. **Appendix: full headers** — if enabled.
6. **Certificate of conversion** — if enabled.

**Footer on every page:** source filename · short SHA-256 · page *n* of *N*.
The short digest is the first 12 hex characters of the full source hash; the
full digest appears on the certificate.
This, with the certificate, is what ties a single loose page back to its source.

### 5.1 Certificate of conversion

Last page. States: tool name and version; conversion timestamp in UTC; source
filename; source SHA-256 in full; page count; attachment count; which body part
was rendered (§4.1); and a **Limitations** list naming everything the
conversion could not reproduce —

- remote images blocked (with a count)
- CSS not applied; layout is a reconstruction
- characters substituted, if any (with a count)
- attachments not appended, if any (listed)
- parse defects, if any (listed with codes)

The version string is a build constant in the tool page, bumped by hand
whenever the conversion pipeline changes behaviour. A certificate that cannot
name the exact code that produced it is worth little, and a static site has no
build system to derive one automatically.

Followed by whitespace sufficient for a declarant's signature, name, and date.
The page is a factual record of the conversion, not an assertion about the
underlying email, and its wording must stay on that side of the line.

### 5.2 Appendix: full headers

The verbatim RFC 822 header block — Received chain, `Message-ID`,
`DKIM-Signature`, `Authentication-Results`, `X-` headers, all of it —
monospaced. Soft-wrapped lines carry a visible continuation marker so a wrapped
header cannot be misread as two headers. Labeled as reproduced verbatim from
the source.

This is the authentication story when an email's origin is challenged, and it is
the single most common thing lost by printing from a mail client.

### 5.3 Options and defaults

| Option | Default | Notes |
|---|---|---|
| Style | `mail-client` | Radio: Mail client / Exhibit / Minimal |
| Output | one PDF per email | Alternative: single combined PDF, chronological, with a linked table of contents |
| Append attachment PDFs and images | on | |
| Download other attachments as ZIP | on | Uses the JSZip already on the site |
| Certificate of conversion | **on** | |
| Full raw header appendix | **on** | |
| SHA-256 of source and attachments | **on** | |
| Embed the original `.eml` in the PDF | **off** | Roughly doubles file size, and some e-filing portals reject PDFs carrying embedded files |

The four evidence options live in a collapsed **Evidence options** group. The
defaults are already correct for production work; the group opens for the user
who wants a quick, clean internal read without a certificate.

Filenames for per-email output derive from date and subject, sanitized:
`2026-03-04_RE-Settlement-terms.pdf`, deduplicated with a numeric suffix.

---

## 6. The tool page in use

Drop zone accepting multiple `.eml` files, then an options panel, then results.

**Preview step.** After parsing but before generating, the page renders the
first email's header block and body as HTML in the page itself, styled to match
the selected theme, updating live as the style is changed. The block IR renders
to HTML about as easily as to PDF, so this is cheap; it is also the difference
between a tool that feels considered and one that feels like a file chute.

Icons are inline SVG throughout, consistent with the rest of the site. Tool
cards on the index remain fully clickable links.

---

## 7. Failure handling

**Per-file isolation.** One malformed `.eml` must never kill a batch of three
hundred. Each file produces a result row: *converted*, *converted with
defects*, or *failed*, with a stated reason.

**Partial output is still output, and it says so.** An email whose body fails to
decode still yields a PDF with intact headers and an explicit block reading
*"body could not be decoded (base64 error at byte N)"*, with the same defect
listed on the certificate. A lawyer needs to know the email exists even when its
body is unreadable. A `.eml` that yields no parseable headers at all is a
failure, not a partial: it produces no PDF and an explicit error row.

**Encrypted or corrupt attachments** are listed on the manifest with the failure
reason. They are never silently dropped.

**Size.** Files are checked before parsing: warn above ~25 MB, refuse above
~100 MB with a clear message. Batches process sequentially with a progress
count, and blobs are released between files so a large set does not exhaust the
tab.

---

## 8. Testing

This repository has no test infrastructure — it is a static site with no build
step and no package manifest — and the whole pipeline is not honestly
unit-testable in that environment. The approach is therefore proportionate
rather than uniform: real assertions where they pay, scripted manual
verification where they do not, and no pretense that the second is the first.

**Fixture corpus** at `docs/fixtures/eml/`:

- plain-text only, no HTML part
- HTML with three levels of nested quoted replies
- `multipart/related` with inline CID images
- base64 body with a deliberately broken chunk
- RFC 2047 encoded-word subject in a non-Latin script
- an attached `message/rfc822`
- a 6 MB PDF attachment
- a real-world Outlook message with nested tables and a signature image
- a message with a tracking pixel and two remote images
- headers only, empty body

**Real assertions.** `html-to-blocks.js` is a pure function, so it is tested
against those fixtures in an in-browser runner page at `/email-to-pdf/tests.html`
asserting on the emitted block IR. That module carries nearly all the
interpretive risk; tests there pay for themselves. `parse.js` normalization and
the filename sanitizer are tested the same way.

**Scripted manual verification.** Layout, assembly, and the appended-attachment
paths get a written checklist run against the fixture corpus with Playwright
driving the page, with the resulting PDFs inspected by eye. This is manual
verification made repeatable — not automated regression, and it should not be
described as such in commit messages or documentation.

---

## 9. Dependencies and assets

| Dependency | Purpose | Note |
|---|---|---|
| `postal-mime` | MIME parsing | ESM; loaded via `<script type="module">`. The rest of the site's classic scripts are unaffected. |
| `pdf-lib` | PDF construction | Already on the site |
| `@pdf-lib/fontkit` | TTF embedding and subsetting | New |
| `jszip` | Attachment ZIP | Already on the site |

**Fonts must be added to the repository as TTF.** pdf-lib's built-in fonts are
WinAnsi-only: an email carrying Cyrillic, Greek, CJK, or emoji renders as
garbage or throws outright, and real evidence work hits that regularly. The
site's existing self-hosted faces are `woff2`, which fontkit cannot embed, so
TTF builds of DM Sans (regular/bold/italic/bold-italic) and Crimson Pro are
added alongside them, plus a monospace face for the header appendix. All are
OFL-licensed and embeddable. They are subsetted at embed time
(`embedFont(bytes, { subset: true })`) and lazy-loaded on this page only, so no
other tool pays for them.

Any character still unmappable after embedding is substituted with U+FFFD and
counted on the certificate (§3.5).

### Known implementation gotchas

- **SHA-256 needs a secure context.** `crypto.subtle` is unavailable over
  `file://`. Local development must be served over `http://localhost`, which
  counts as secure. Production is HTTPS and unaffected.
- **pdf-lib has no high-level link API.** The combined-output table of contents
  needs link annotations built by hand as annotation dictionaries via
  `pdfDoc.context.obj`. Budget for it; it is fiddly, not hard.
- **Retaining `rawBytes` for hashing doubles peak memory** per file. Hash early,
  then release the reference before rendering, unless the embed-source option is
  on.

---

## 10. Open questions

None blocking. Two worth revisiting after the tool has real use:

1. Whether the combined-PDF table of contents should also list attachments, or
   only emails. Listing both is more useful and much longer.
2. Whether a `.msg` front-end (v2) should reuse the same tool page with a
   widened `accept`, or ship as a sibling page. The parser boundary supports
   either.
