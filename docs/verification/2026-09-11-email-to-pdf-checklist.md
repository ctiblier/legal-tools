# Email to PDF — verification checklist

Run against the fixture corpus after any change to the conversion pipeline.
This is manual verification made repeatable — **not** automated regression.
Do not describe it as a test suite in commit messages or documentation.

Setup: `bash build.sh --dev`, then serve `batesstamp/` and open `/email-to-pdf/`.
Drive it by hand or with Playwright — the spec allows either; what matters is that
the same fixtures are exercised in the same order every time and that a human looks
at the resulting PDFs, which is the part no driver can do.

> **A fixture that cannot expose a defect is not coverage.** Two of the items below
> passed for the life of the project against fixture 07, whose attached PDF is 6 MB
> of padding with nothing drawn on it — so "the footer does not overprint the
> attachment" could not have failed no matter what the code did. Fixture 13 exists
> to make that item real. Before trusting a green item here, check that the fixture
> it names actually contains the thing being looked for.

Last worked: **2026-09-18** (Playwright-driven, results recorded inline below).

## Automated first

- [x] `python3 docs/fixtures/eml/generate.py` has been run (fixture 07 is
      gitignored and absent on a fresh clone; its tests fail with a clear
      "fixture not found" message until it is generated).
- [x] `/email-to-pdf/tests.html` reports PASS with zero failures.
      Result: **PASS 167/167**

## Rendering — check in all three styles

- [x] `02-html-nested-quotes.eml` — three quote levels each indented one step
      further, each with a rail; the signature block's line breaks survive.
- [x] `08-outlook-tables.eml` — all four rows and four columns present; the nested
      table inside the disputed cell renders; no row is lost at a page break.
- [x] `01-plain-text.eml` — the indented list lines keep their alignment; two
      quote levels distinguishable. Rails confirmed visually in the exhibit style.
- [x] `05-encoded-word-subject.eml` — Cyrillic renders as letters, not boxes; the
      CJK sentence shows replacement characters **and** the certificate reports the
      substitution count (**13**).
      **Count the characters before accepting this number.** The body's CJK
      sentence 契約書の翻訳を添付します。 is 13 characters. This item was first
      recorded green at 26 — the count was being incremented once per
      measurement as well as once per draw, so it read 2x in the simple case and
      quadratically for a long unbreakable token. A plausible-looking number on
      a certificate is exactly the kind of thing that passes a manual check.
- [x] `03-inline-cid-image.eml` — the inline image appears in the body.
      Note: this fixture's image is 1x1, so it proves embedding only. Image
      *sizing* was checked separately with a 240x90 three-band PNG, which rendered
      at the correct position and aspect ratio.
- [x] `10-headers-only.eml` — renders a header block and the "no body text" note.

## Evidence

- [x] Footer on every page: filename, 12-char hash, `page n of N`, with N equal to
      the real page count. Checked page-by-page across a 47-page combined exhibit;
      no gap, repeat or missing footer.
- [x] Header appendix reproduces the Received chain verbatim, including the IP
      (`203.0.113.24`); wrapped long headers are visibly continuations.
- [x] Certificate lists: tool version, UTC timestamp, full source SHA-256,
      Message-ID, the raw Date header, page count, attachment count, body part used.
      The printed SHA-256 was compared against `sha256sum` of the source and matches.
- [x] `09-remote-images.eml` — certificate reports 2 blocked remote images
      including 1 tracking pixel; the body shows labeled placeholders, not gaps.
      No request to any `marketing.example` host was made (see Privacy).
- [x] A remote image sized in **percentages** (`width="1%"`) gets a placeholder,
      not deletion. `parseInt('1%')` is `1`, so it was classed as a tracking
      pixel and removed outright — the only blocked remote image with no mark.
- [x] An HTML part that renders to nothing falls back to the plain-text part and
      says so, rather than drawing a blank body under a certificate claiming the
      HTML part was used.
- [x] `07-large-pdf-attachment.eml` — manifest shows the filename, type, size and
      full hash; the attachment's pages follow a labeled separator page.
- [x] On those merged attachment pages, the stamped footer does not overprint
      content already in the page's bottom margin.
      **Check this with fixture 13, not fixture 07** — fixture 07's page is blank.
      Appended pages are scaled to ~94% and centred so the footer band stays clear;
      the reduction is disclosed on the certificate as `ATTACHMENT_SCALED`.
- [x] A PDF attachment adds exactly one separator page plus its own page count —
      no stray blank page.
- [x] An attachment page carrying `/Rotate` is appended in the orientation a
      reader sees, not upright. Check with fixture 14 and compare against the
      attachment rendered on its own.
- [x] In a combined PDF, **each certificate describes only its own message.**
      Check with two messages where the *first* blocks remote images and the
      second has none: the second certificate must not mention remote images,
      and neither may report a page count near the document total. Both figures
      were running document-wide totals until 2026-09-18.
- [x] Dates print with their original offset. Converted `01-plain-text.eml` in a
      browser set to `Asia/Tokyo` (UTC+9); it still reads
      `Tue, 4 Mar 2026 09:14:22 -0800` in the body, the appendix, the certificate,
      and the output filename.
- [x] Turn off each evidence option in turn and confirm the corresponding section
      disappears and nothing else changes. Certificate off → 2 pages, appendix
      intact. Appendix off → 2 pages, certificate intact. Hashes off → footers lose
      the hash, certificate keeps the full SHA-256.
- [x] `embedSource` on — the `.eml` is attached to the PDF, extracts, and its
      SHA-256 matches the original byte for byte.
- [x] `embedSource` on **with combined output** — every message's source is
      attached, not none. The combined path had no `attach()` call at all until
      2026-09-18, so the option silently did nothing. Verified by extracting both
      and comparing SHA-256 against the originals.
- [x] In combined output, two messages attaching the same filename produce two
      distinct ZIP entries. Entries are namespaced per message; a bare filename
      meant one silently overwrote the other.

## Searchability

- [x] Select body text in a PDF reader and copy it; the clipboard contains the
      same words.
- [x] `Ctrl-F` a phrase spanning a line break; it is found.
      Checked against the **raw** pdf.js item stream rather than
      `extractPdfText()`, whose whitespace collapsing would mask exactly this
      defect. Words are discrete items with real space items between them and
      `hasEOL` at each wrap; four phrases spanning wraps all matched.
      The twelve committed fixtures have no wrapping body paragraph, so this needs
      a long-paragraph message — see the note at the end.
- [x] Open the converted PDF in the Bates Stamper and stamp it; the stamp applies
      (`EXH_0001`–`EXH_0003`) and the text layer survives. The Bates stamp lands
      below the conversion footer without colliding with it.

## Batch

- [x] All fixtures at once, one PDF per email: a single `converted-emails.zip`
      containing one PDF per message with dated, unique filenames — not separate
      downloads, which the browser would block.
- [x] A single file converts to a direct PDF download, not a ZIP.
- [x] Same set combined: TOC first, oldest first, TOC links jump correctly,
      footer numbering continuous. Every printed TOC page number was compared
      against the page its link annotation actually resolves to — all 14 match,
      and each destination page starts with the right message.
- [x] A message with a long subject has its contents entry **wrapped**, not run
      off the right edge of the sheet. Entries were drawn unwrapped until
      2026-09-18, putting text at x=613 on a 612pt page with nothing to mark it.
- [x] With many long-subject messages, the contents list stops with its
      "contents continue" notice **on a reserved page** — no contents text
      appears after the exhibits begin.
- [ ] Introduce a deliberately corrupt file (`head -c 200 /dev/urandom > bad.eml`)
      into the batch: it appears as a red failure row, every other file still
      converts, and the run completes.
      **This item does not describe what the tool does.** The batch does complete
      and every other file converts, but the corrupt file does *not* fail — RFC 822
      has no magic bytes, so postal-mime accepts any byte string and it converts to
      a message with no subject, sender or date. Nothing is concealed: the body
      says "This message contained no body text", the certificate says
      "Body rendered from no body part — the message had none" and reports 490
      unrenderable characters, and the appendix reproduces the raw bytes. Left
      unchecked pending a decision on whether an unparseable file should be
      refused rather than disclosed.

## Privacy

- [x] With the network log open, convert `09-remote-images.eml`. **No request** is
      made to any `marketing.example` host, and no request carries email content
      anywhere. The only third-party requests on the page are the Umami analytics
      script and the pdf-lib / JSZip CDN loads.
- [x] The preview pane's links are not clickable — they render as
      `<span class="eml-link">` with the target preserved in a `title` attribute,
      and the pane contains no `<a>` elements at all.

## Responsiveness and accessibility

- [x] At 400px width the options and preview remain usable and nothing overflows
      horizontally (`scrollWidth` equals `clientWidth`; no element extends past the
      viewport).
- [x] The drop zone is reachable and operable by keyboard — tabbing reaches the
      file input inside it, which carries `aria-label="Choose .eml files"`.
- [x] No emoji anywhere in the UI or the output.

## Fixtures this checklist needs that the corpus does not have

Two items above cannot be exercised by the committed fixtures and were checked with
throwaway messages. If either becomes load-bearing, promote it to `generate.py`:

- **A body paragraph long enough to wrap.** Every committed fixture has short body
  lines, so the body line-breaker is never exercised by the corpus. Needed for the
  cross-line-break search item.
- **A visibly-sized inline image.** Fixture 03's inline PNG is 1x1.
