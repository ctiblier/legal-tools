# Email to PDF Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a browser-only tool at `batesstamp.com/email-to-pdf/` that converts `.eml` files into searchable, evidence-grade PDFs.

**Architecture:** A five-stage pipeline — `.eml` bytes → `EmailRecord` → sanitized DOM → block IR → drawn PDF pages. The middle stage is a pure function with no PDF knowledge and no I/O, which is where the real tests live. The renderer has no email knowledge and is driven by a swappable theme object.

**Tech Stack:** Vanilla ES modules (no build step, no npm), pdf-lib 1.17.1 + `@pdf-lib/fontkit` 1.1.1 for PDF construction and TTF subsetting, postal-mime 3.0.0 for MIME parsing, JSZip 3.10.1 for attachment bundles, `crypto.subtle` for hashing.

**Spec:** `docs/superpowers/specs/2026-09-10-email-to-pdf-design.md` — read it before Task 1. The plan argues from the spec; where the plan appears to contradict it, the spec wins and the discrepancy is a bug in this plan.

## Global Constraints

Every task's requirements implicitly include all of these.

- **No network egress of user data, ever.** No `fetch`/`XHR` carrying email content, no telemetry containing filenames, subjects, addresses, or hashes. Umami events record that a conversion happened, never what was converted.
- **No build step beyond `build.sh`.** No `package.json`, no bundler, no transpiler. Third-party libraries are vendored into the repo as files or loaded from the CDNs already in use.
- **Source of truth for shared code is root `shared/`.** `batesstamp/shared/` is gitignored build output written by `build.sh`. Never edit files under `batesstamp/shared/` — the edit will be silently overwritten on the next build and will not be committed.
- **Nothing is ever truncated.** No ellipsis in any PDF output. Long content paginates.
- **Dates print verbatim** with their original UTC offset. Never normalize to local time.
- **Remote `http(s)` images are never fetched** and their absence is always visibly labeled.
- **Disclosure over silence.** Anything the tool cannot faithfully reproduce is rendered as best it can be *and* recorded in `record.defects` so it reaches the certificate page.
- **No emoji anywhere in UI or PDF output.** Icons are inline SVG in the UI and vector drawing primitives in the PDF. Standard PDF fonts do not carry emoji and the site's design language does not use them.
- **Style:** vanilla ES modules under `shared/eml/` and `shared/pdf/`; existing classic `<script>` globals (`tools.js`, `nav.js`, `file-handler.js`, `session-files.js`) stay classic and are untouched except where a task says otherwise. 4-space indent in HTML pages, 2-space in `shared/` JS, matching what is already there.
- **Version constant:** `EML_TOOL_VERSION` in `shared/eml/version.js`, bumped by hand whenever conversion behaviour changes. It prints on every certificate.

---

## File Structure

| Path | Responsibility |
|---|---|
| `shared/eml/version.js` | The single version constant. |
| `shared/eml/hash.js` | `sha256Hex` and the 12-char short form. |
| `shared/eml/parse.js` | postal-mime wrapper → `EmailRecord`. Raw header slicing, recursion into `message/rfc822`. |
| `shared/eml/sanitize.js` | Detached-DOM cleanup: strip active content, block remote images, resolve `cid:` images. |
| `shared/eml/html-to-blocks.js` | Sanitized DOM → block IR. Pure. |
| `shared/eml/text-to-blocks.js` | Plain-text body → block IR. Pure. |
| `shared/eml/blocks-to-html.js` | Block IR → HTML, for the in-page preview. Pure. |
| `shared/eml/themes.js` | Three theme objects + their header-block renderers. |
| `shared/eml/manifest.js` | Attachment manifest blocks; disposition decisions. Pure. |
| `shared/eml/certificate.js` | Certificate and raw-header-appendix blocks. Pure. |
| `shared/eml/assemble.js` | Orchestration: `EmailRecord` + options → PDF bytes. |
| `shared/eml/filename.js` | Output filename derivation and deduplication. Pure. |
| `shared/pdf/fonts.js` | TTF loading, fontkit embedding, subsetting, character substitution accounting. |
| `shared/pdf/measure.js` | Tokenizing and line breaking. Pure, injectable measurement. |
| `shared/pdf/writer.js` | `PageWriter`: cursor, pagination, footers, link annotations. |
| `shared/pdf/draw-blocks.js` | Block IR → drawing calls via `PageWriter`. |
| `shared/testing/harness.js` | Minimal in-browser assertion runner. |
| `shared/testing/fixtures.js` | Fixture base path and loader. |
| `batesstamp/email-to-pdf/index.html` | The tool page: markup, options, preview, batch driver. |
| `batesstamp/email-to-pdf/tests.html` | Test runner page. `noindex`, disallowed in robots.txt. |
| `batesstamp/vendor/postal-mime/` | Vendored parser (unbundled ESM, 10 files). |
| `batesstamp/vendor/fontkit.umd.js` | Vendored fontkit for pdf-lib. |
| `batesstamp/fonts/*.ttf` | TTF faces for embedding (the existing woff2 files stay for the site's own CSS). |
| `docs/fixtures/eml/` | Fixture corpus + its generator. |
| `docs/verification/2026-09-11-email-to-pdf-checklist.md` | Scripted manual verification checklist. |

**Deviation from the spec, deliberate:** the spec describes sanitization as living inside `html-to-blocks.js`. This plan splits it into `sanitize.js` because the two do genuinely different jobs (security/privacy filtering vs. layout interpretation), they fail differently, and keeping them separate keeps both files small enough to hold in context. The module boundary described in the spec — parsing knows nothing of PDFs — is unchanged.

**Why postal-mime and fontkit are vendored rather than CDN-loaded:** this site deliberately self-hosted its fonts to drop Google Fonts (commit `58a5a5d`). A tool whose entire promise is that confidential files never leave the browser should not have its parser arrive from a third party at page load. pdf-lib, pdf.js, JSZip and Sortable stay on their existing CDNs; that is pre-existing and out of scope here.

---

## Task 1: Plumbing and the test harness

Nothing in this task is user-visible. It exists so every later task has somewhere to put code and a way to run assertions.

**Files:**
- Modify: `build.sh`
- Create: `shared/testing/harness.js`
- Create: `shared/eml/version.js`
- Create: `batesstamp/email-to-pdf/tests.html`
- Modify: `batesstamp/robots.txt`

**Interfaces:**
- Consumes: nothing.
- Produces: `test(name, fn)`, `assert(cond, msg)`, `assertEqual(actual, expected, msg)`, `assertDeepEqual(actual, expected, msg)`, `assertThrows(fn, msg)`, `runAll()` from `/shared/testing/harness.js`. `EML_TOOL_VERSION` (string) from `/shared/eml/version.js`.

- [ ] **Step 1: Teach `build.sh` to copy nested shared directories**

The current loop copies a hard-coded flat list of filenames and would silently skip `shared/eml/` and `shared/pdf/` entirely — modules would 404 in production while working fine locally. Replace the loop:

```bash
#!/bin/bash
# Build script for BatesStamp Legal Toolkit
# Copies shared files into the Cloudflare Pages deploy directory (batesstamp/)

set -e

echo "Building BatesStamp Legal Toolkit..."

# Shared CSS lands at the site root (referenced as /brand.css)
cp shared/brand.css batesstamp/

# Shared JS — copied wholesale, including nested directories (eml/, pdf/, testing/).
# batesstamp/shared/ is gitignored build output; it is rebuilt from scratch each time
# so a deleted source file cannot survive as a stale copy.
rm -rf batesstamp/shared
mkdir -p batesstamp/shared
cp -R shared/. batesstamp/shared/
rm -f batesstamp/shared/brand.css

# Development only: stage the .eml test fixtures inside the served root so the
# test page can fetch them at the same absolute paths it will use in production.
# Never run with --dev for a deployed build; Cloudflare Pages runs `bash build.sh`
# with no arguments, so evidence fixtures cannot reach the live site.
if [ "$1" = "--dev" ]; then
  rm -rf batesstamp/fixtures
  if [ -d docs/fixtures/eml ]; then
    mkdir -p batesstamp/fixtures
    cp -R docs/fixtures/eml batesstamp/fixtures/
    echo "Dev fixtures staged at batesstamp/fixtures/eml/"
  else
    echo "No fixtures at docs/fixtures/eml/ — skipping dev staging."
    echo "Run: python3 docs/fixtures/eml/generate.py"
  fi
fi

echo "Build complete."
```

`batesstamp/fixtures/` is build output and must never be committed. Add it to
`.gitignore` alongside the existing `batesstamp/shared/` entry:

```
batesstamp/fixtures/
```

- [ ] **Step 2: Verify the build copies nested directories**

```bash
cd /home/ctibs/Projects/legal-tools
mkdir -p shared/eml && echo "export const PROBE = 1;" > shared/eml/__probe.js
bash build.sh
test -f batesstamp/shared/eml/__probe.js && echo "PASS: nested copy works" || echo "FAIL"
rm shared/eml/__probe.js && bash build.sh
test -f batesstamp/shared/eml/__probe.js && echo "FAIL: stale file survived" || echo "PASS: stale file removed"
```

Expected: `PASS: nested copy works` then `PASS: stale file removed`.

- [ ] **Step 3: Write the version constant**

```js
// shared/eml/version.js
// Bump by hand whenever conversion behaviour changes. This string prints on every
// certificate of conversion, and a certificate that cannot name the code that
// produced it is worth very little.
export const EML_TOOL_VERSION = '1.0.0';
```

- [ ] **Step 4: Write the test harness**

```js
// shared/testing/harness.js
// Minimal in-browser assertion runner. No dependencies, no build step.
//
// Usage:
//   import { test, assertEqual, runAll } from '/shared/testing/harness.js';
//   test('does the thing', () => { assertEqual(1 + 1, 2); });
//   runAll();
//
// runAll() renders results into #results and writes a machine-readable summary
// to window.__TEST_SUMMARY and document.title so a headless driver can read it
// without scraping the DOM.

const cases = [];

export function test(name, fn) {
  cases.push({ name, fn });
}

export class AssertionError extends Error {}

export function assert(cond, msg) {
  if (!cond) throw new AssertionError(msg || 'expected truthy value');
}

export function assertEqual(actual, expected, msg) {
  if (!Object.is(actual, expected)) {
    throw new AssertionError(
      (msg ? msg + ': ' : '') +
      'expected ' + JSON.stringify(expected) + ' but got ' + JSON.stringify(actual)
    );
  }
}

// Structural comparison by serialisation. Key order matters, which is fine here:
// every value compared in these tests is built by our own code in a fixed order.
export function assertDeepEqual(actual, expected, msg) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new AssertionError(
      (msg ? msg + ': ' : '') + 'expected\n' + JSON.stringify(expected, null, 2) +
      '\nbut got\n' + JSON.stringify(actual, null, 2)
    );
  }
}

export function assertThrows(fn, msg) {
  let threw = false;
  try { fn(); } catch (e) { threw = true; }
  if (!threw) throw new AssertionError(msg || 'expected the function to throw');
}

export async function runAll() {
  const out = document.getElementById('results');
  let passed = 0;
  const failures = [];

  for (const c of cases) {
    let error = null;
    try {
      await c.fn();
      passed++;
    } catch (e) {
      error = e;
      failures.push({ name: c.name, message: e.message, stack: e.stack });
    }
    if (out) {
      const row = document.createElement('div');
      row.className = error ? 'test-fail' : 'test-pass';
      row.textContent = (error ? 'FAIL  ' : 'pass  ') + c.name +
        (error ? '\n      ' + error.message : '');
      out.appendChild(row);
    }
  }

  const summary = { total: cases.length, passed, failed: failures.length, failures };
  window.__TEST_SUMMARY = summary;
  document.title = failures.length
    ? 'FAIL ' + failures.length + '/' + cases.length
    : 'PASS ' + passed + '/' + cases.length;

  if (out) {
    const banner = document.createElement('div');
    banner.className = failures.length ? 'test-summary fail' : 'test-summary pass';
    banner.textContent = failures.length
      ? failures.length + ' of ' + cases.length + ' failed'
      : 'all ' + passed + ' passed';
    out.prepend(banner);
  }
  return summary;
}
```

- [ ] **Step 5: Write the test runner page**

```html
<!-- batesstamp/email-to-pdf/tests.html -->
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="robots" content="noindex, nofollow">
    <title>Email to PDF — tests</title>
    <style>
        body { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 13px;
               margin: 24px; background: #fbfbfd; color: #1a1a1a; }
        #results > div { white-space: pre-wrap; padding: 3px 0; }
        .test-pass { color: #2f6f43; }
        .test-fail { color: #b02020; font-weight: 600; }
        .test-summary { margin-bottom: 16px; padding: 10px 14px; border-radius: 4px;
                        font-weight: 600; font-size: 15px; }
        .test-summary.pass { background: #e6f4ea; color: #1e5631; }
        .test-summary.fail { background: #fdeaea; color: #8c1c1c; }
    </style>
</head>
<body>
    <h1>Email to PDF — unit tests</h1>
    <div id="results"></div>
    <script type="module">
        import { runAll } from '/shared/testing/harness.js';
        // Each test module registers its cases on import.
        // Later tasks append their module to this list.
        await import('/shared/eml/__no_tests_yet.js').catch(() => {});
        await runAll();
    </script>
</body>
</html>
```

- [ ] **Step 6: Keep the test page out of search results**

Append to `batesstamp/robots.txt`:

```
Disallow: /email-to-pdf/tests.html
```

- [ ] **Step 7: Run the harness and confirm it reports zero tests**

```bash
cd /home/ctibs/Projects/legal-tools && bash build.sh
cd batesstamp && python3 -m http.server 8788
```

Open `http://localhost:8788/email-to-pdf/tests.html`. Expected: the page loads, shows "all 0 passed", and the tab title reads `PASS 0/0`. `localhost` is a secure context, so `crypto.subtle` works there — later tasks depend on this. Serving the directory over `file://` will break hashing and is not a supported way to run these tests.

- [ ] **Step 8: Commit**

```bash
git add build.sh .gitignore shared/testing/harness.js shared/eml/version.js \
        batesstamp/email-to-pdf/tests.html batesstamp/robots.txt
git commit -m "chore: build plumbing and in-browser test harness for email-to-pdf"
```

---

## Task 2: Fixture corpus

Ten fixtures that between them exercise every branch the parser and the block builder have. Written as a generator so they are reproducible and reviewable as source rather than as opaque blobs.

**Files:**
- Create: `docs/fixtures/eml/generate.py`
- Create: `docs/fixtures/eml/*.eml` (generated)
- Create: `docs/fixtures/eml/README.md`

**Interfaces:**
- Consumes: nothing.
- Produces: fixture files at `docs/fixtures/eml/`, served in tests from `/fixtures/eml/<name>.eml` (see Step 3).

- [ ] **Step 1: Write the generator**

```python
#!/usr/bin/env python3
"""Generate the .eml fixture corpus.

Deterministic: re-running produces byte-identical files, so a fixture change
always shows up as a reviewable diff. Run from the repository root:

    python3 docs/fixtures/eml/generate.py
"""
import base64
import hashlib
import pathlib
import zlib

OUT = pathlib.Path(__file__).parent

def write(name, text):
    # .eml files use CRLF line endings; normalise so the generator is
    # editable with ordinary LF source above.
    data = text.replace("\r\n", "\n").replace("\n", "\r\n").encode("utf-8")
    (OUT / name).write_bytes(data)
    print(f"{name}: {len(data)} bytes")

def tiny_png_b64():
    """A 1x1 red PNG, built rather than pasted so it is auditable."""
    def chunk(tag, payload):
        body = tag + payload
        return (len(payload).to_bytes(4, "big") + body +
                zlib.crc32(body).to_bytes(4, "big"))
    ihdr = (1).to_bytes(4, "big") + (1).to_bytes(4, "big") + bytes([8, 2, 0, 0, 0])
    raw = bytes([0, 255, 0, 0])
    png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) +
           chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))
    return base64.b64encode(png).decode("ascii")

# 1 -------------------------------------------------------------- plain text
write("01-plain-text.eml", """\
Return-Path: <jsmith@acme-manufacturing.example>
Received: from mail.acme-manufacturing.example (mail.acme-manufacturing.example
 [203.0.113.24]) by mx.firm.example with ESMTPS id 4a1f9c2e
 for <counsel@firm.example>; Tue, 4 Mar 2026 09:14:31 -0800 (PST)
Authentication-Results: mx.firm.example; dkim=pass header.d=acme-manufacturing.example
Message-ID: <20260304171422.A1F9C@acme-manufacturing.example>
Date: Tue, 4 Mar 2026 09:14:22 -0800
From: John Smith <jsmith@acme-manufacturing.example>
To: Robert Jones <counsel@firm.example>
Subject: Delivery schedule
MIME-Version: 1.0
Content-Type: text/plain; charset=utf-8

Bob,

Confirming the dates we discussed on the call:

  - First shipment: March 18
  - Balance: April 2

> On Mar 3, 2026, Robert Jones wrote:
> Can you send the revised schedule before Friday?
>> Earlier still, someone else wrote:
>> Is the schedule final?

Regards,
John
""")

# 2 --------------------------------------------- html with nested quoting
write("02-html-nested-quotes.eml", """\
Message-ID: <20260305181200.B2C3D@firm.example>
Date: Wed, 5 Mar 2026 10:12:00 -0800
From: Robert Jones <counsel@firm.example>
To: John Smith <jsmith@acme-manufacturing.example>
Cc: Paralegal Desk <docket@firm.example>
Subject: RE: Delivery schedule
MIME-Version: 1.0
Content-Type: text/html; charset=utf-8

<html><body>
<p>John,</p>
<p>Understood &mdash; please confirm <b>in writing</b> that the
<i>April 2</i> date is firm.</p>
<ul><li>Shipment one: March 18</li><li>Balance: April 2</li></ul>
<blockquote>
  <p>On Mar 4, John Smith wrote:</p>
  <p>Confirming the dates we discussed.</p>
  <blockquote>
    <p>On Mar 3, Robert Jones wrote:</p>
    <p>Can you send the revised schedule?</p>
    <blockquote><p>Is the schedule final?</p></blockquote>
  </blockquote>
</blockquote>
<p>Robert Jones<br>Jones &amp; Associates<br>tel 555-0142</p>
</body></html>
""")

# 3 ------------------------------------------- multipart/related inline cid
write("03-inline-cid-image.eml", f"""\
Message-ID: <20260306090000.C3D4E@acme-manufacturing.example>
Date: Thu, 6 Mar 2026 09:00:00 -0800
From: John Smith <jsmith@acme-manufacturing.example>
To: Robert Jones <counsel@firm.example>
Subject: Signed page
MIME-Version: 1.0
Content-Type: multipart/related; boundary="rel-boundary"; type="text/html"

--rel-boundary
Content-Type: text/html; charset=utf-8

<html><body><p>See the mark-up below.</p>
<p><img src="cid:markup001" alt="marked up page" width="48" height="48"></p>
<p>John</p></body></html>

--rel-boundary
Content-Type: image/png
Content-ID: <markup001>
Content-Transfer-Encoding: base64
Content-Disposition: inline; filename="markup.png"

{tiny_png_b64()}

--rel-boundary--
""")

# 4 ------------------------------------------------- broken base64 payload
write("04-broken-base64.eml", """\
Message-ID: <20260307120000.D4E5F@acme-manufacturing.example>
Date: Fri, 7 Mar 2026 12:00:00 -0800
From: John Smith <jsmith@acme-manufacturing.example>
To: Robert Jones <counsel@firm.example>
Subject: Corrupted message
MIME-Version: 1.0
Content-Type: text/plain; charset=utf-8
Content-Transfer-Encoding: base64

VGhpcyBpcyB0aGUgcmVhZGFibGUgb3BlbmluZyBsaW5lLg==
!!!!not valid base64 at all!!!!
====
""")

# 5 ------------------------------------ RFC 2047 encoded-word, non-Latin
write("05-encoded-word-subject.eml", """\
Message-ID: <20260308080000.E5F6A@example.example>
Date: Sat, 8 Mar 2026 08:00:00 +0300
From: =?UTF-8?B?0JDQvdC90LAg0JjQstCw0L3QvtCy0LA=?= <anna@example.example>
To: Robert Jones <counsel@firm.example>
Subject: =?UTF-8?B?0J/QtdGA0LXQstC+0LQg0LTQvtCz0L7QstC+0YDQsA==?=
MIME-Version: 1.0
Content-Type: text/plain; charset=utf-8

Здравствуйте,

Перевод договора прилагается. 契約書の翻訳を添付します。

Анна
""")

# 6 ------------------------------------------- attached message/rfc822
write("06-forwarded-message.eml", """\
Message-ID: <20260309140000.F6A7B@firm.example>
Date: Sun, 9 Mar 2026 14:00:00 -0700
From: Robert Jones <counsel@firm.example>
To: Senior Partner <partner@firm.example>
Subject: Fwd: Delivery schedule
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="fwd-boundary"

--fwd-boundary
Content-Type: text/plain; charset=utf-8

Forwarding for your review. Note the date in the original.

--fwd-boundary
Content-Type: message/rfc822
Content-Disposition: attachment; filename="original.eml"

Message-ID: <20260304171422.A1F9C@acme-manufacturing.example>
Date: Tue, 4 Mar 2026 09:14:22 -0800
From: John Smith <jsmith@acme-manufacturing.example>
To: Robert Jones <counsel@firm.example>
Subject: Delivery schedule
Content-Type: text/plain; charset=utf-8

Bob,

Confirming the dates we discussed on the call.

John

--fwd-boundary--
""")

# 7 ------------------------------------------------ large PDF attachment
def make_pdf(size_bytes):
    """A structurally valid one-page PDF padded with a comment to `size_bytes`."""
    head = (b"%PDF-1.4\n"
            b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
            b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
            b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n")
    tail = (b"trailer<</Root 1 0 R/Size 4>>\n%%EOF\n")
    pad = b"% " + b"A" * max(0, size_bytes - len(head) - len(tail) - 3) + b"\n"
    return head + pad + tail

# Large binary fixtures are generated, never committed — see the .gitignore entry
# for docs/fixtures/eml/07-*.eml. A static-site repository should not carry an
# 8 MB base64 blob that a script reproduces byte-for-byte in under a second.
pdf_bytes = make_pdf(6 * 1024 * 1024)
pdf_b64 = base64.b64encode(pdf_bytes).decode("ascii")
pdf_b64_wrapped = "\n".join(pdf_b64[i:i + 76] for i in range(0, len(pdf_b64), 76))
write("07-large-pdf-attachment.eml", f"""\
Message-ID: <20260310100000.A7B8C@acme-manufacturing.example>
Date: Mon, 10 Mar 2026 10:00:00 -0700
From: John Smith <jsmith@acme-manufacturing.example>
To: Robert Jones <counsel@firm.example>
Subject: Executed agreement
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="pdf-boundary"

--pdf-boundary
Content-Type: text/plain; charset=utf-8

Executed copy attached.

--pdf-boundary
Content-Type: application/pdf; name="executed-agreement.pdf"
Content-Transfer-Encoding: base64
Content-Disposition: attachment; filename="executed-agreement.pdf"

{pdf_b64_wrapped}

--pdf-boundary--
""")
print(f"  (attachment sha256 {hashlib.sha256(pdf_bytes).hexdigest()[:12]})")

# 8 --------------------------------------- outlook-style nested tables
write("08-outlook-tables.eml", """\
Message-ID: <20260311093000.B8C9D@acme-manufacturing.example>
Date: Tue, 11 Mar 2026 09:30:00 -0700
From: Accounts Payable <ap@acme-manufacturing.example>
To: Robert Jones <counsel@firm.example>
Subject: Invoice summary Q1
MIME-Version: 1.0
Content-Type: text/html; charset=utf-8

<html><head><style>.x { color: red; }</style></head><body>
<table border="1" cellpadding="4" style="border-collapse:collapse">
<tr><th>Invoice</th><th>Date</th><th>Amount</th><th>Status</th></tr>
<tr><td>INV-1041</td><td>2026-01-14</td><td>$12,400.00</td><td>Paid</td></tr>
<tr><td>INV-1055</td><td>2026-02-02</td><td>$8,115.50</td><td>Paid</td></tr>
<tr><td>INV-1092</td><td>2026-03-01</td><td>$41,980.25</td><td>
  <table><tr><td>Disputed</td></tr><tr><td>see counsel</td></tr></table>
</td></tr>
</table>
<p style="color:#888;font-size:11px">This message and any attachments are
confidential.</p>
</body></html>
""")

# 9 ----------------------------------- tracking pixel and remote images
write("09-remote-images.eml", """\
Message-ID: <20260312110000.C9DAE@marketing.example>
Date: Wed, 12 Mar 2026 11:00:00 -0700
From: Vendor Updates <news@marketing.example>
To: Robert Jones <counsel@firm.example>
Subject: Your March statement is ready
MIME-Version: 1.0
Content-Type: text/html; charset=utf-8

<html><body>
<img src="https://track.marketing.example/open?id=abc123" width="1" height="1">
<h1>March statement</h1>
<p><img src="https://cdn.marketing.example/banner.png" width="600" height="120"
   alt="March promotion banner"></p>
<p>Your statement is available. <a href="https://portal.marketing.example/s/9f2">
View statement</a>.</p>
<script>window.alert('should never run');</script>
</body></html>
""")

# 10 ------------------------------------------------- headers, no body
write("10-headers-only.eml", """\
Message-ID: <20260313070000.DAEBF@example.example>
Date: Thu, 13 Mar 2026 07:00:00 -0700
From: Automated Notice <noreply@example.example>
To: Robert Jones <counsel@firm.example>
Subject: Read receipt
MIME-Version: 1.0
Content-Type: text/plain; charset=utf-8

""")

# 11 ------------------------------- inline message/rfc822 (no disposition)
write("11-inline-forwarded.eml", """\
Message-ID: <20260314090000.EBFCA@firm.example>
Date: Sat, 14 Mar 2026 09:00:00 -0700
From: Robert Jones <counsel@firm.example>
To: Senior Partner <partner@firm.example>
Subject: Fwd: Delivery schedule (no disposition)
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="inline-fwd"

--inline-fwd
Content-Type: text/plain; charset=utf-8

Forwarding for your review.

--inline-fwd
Content-Type: message/rfc822

Message-ID: <20260304171422.A1F9C@acme-manufacturing.example>
Date: Tue, 4 Mar 2026 09:14:22 -0800
From: John Smith <jsmith@acme-manufacturing.example>
To: Robert Jones <counsel@firm.example>
Subject: Delivery schedule
Content-Type: text/plain; charset=utf-8

Inner body text.

--inline-fwd--
""")

print("done")
```

- [ ] **Step 2: Generate the corpus and confirm it is deterministic**

```bash
cd /home/ctibs/Projects/legal-tools
TMP=$(mktemp -d)
python3 docs/fixtures/eml/generate.py
sha256sum docs/fixtures/eml/*.eml > "$TMP/fixtures-1.txt"
python3 docs/fixtures/eml/generate.py
sha256sum docs/fixtures/eml/*.eml > "$TMP/fixtures-2.txt"
diff "$TMP/fixtures-1.txt" "$TMP/fixtures-2.txt" && echo "PASS: deterministic"
```

Expected: ten files listed, then `PASS: deterministic`.

- [ ] **Step 3: Make fixtures reachable from the test page**

Fixtures live in `docs/` and must never ship to production, but tests need to
fetch them at the same absolute paths the tool uses in production. `build.sh --dev`
(Task 1) stages them inside the served root for exactly this reason. Serve
`batesstamp/` as the web root, matching Cloudflare Pages:

```bash
cd /home/ctibs/Projects/legal-tools && bash build.sh --dev
cd batesstamp && python3 -m http.server 8788
```

Fixtures are then at `/fixtures/eml/01-plain-text.eml` and shared modules at
`/shared/eml/...` — identical in shape to production, so no path in any module or
page differs between dev and deploy. Tests reference fixtures through one constant:

```js
// shared/testing/fixtures.js
export const FIXTURE_BASE = '/fixtures/eml/';

export async function loadFixture(name) {
  const res = await fetch(FIXTURE_BASE + name);
  if (!res.ok) {
    throw new Error(
      'fixture ' + name + ' not found (' + res.status + ') — ' +
      'run `bash build.sh --dev` from the repository root, then serve batesstamp/'
    );
  }
  return new Uint8Array(await res.arrayBuffer());
}
```

The error message matters: a missing fixture otherwise surfaces as an opaque
parse failure, and the fix is non-obvious.

- [ ] **Step 4: Write the corpus README**

```markdown
# .eml fixture corpus

Generated by `generate.py` — edit the generator, never the `.eml` files.
Re-running produces byte-identical output so fixture changes are reviewable diffs.

| File | Exercises |
|---|---|
| `01-plain-text.eml` | text/plain path, `>` quote-level detection, Received header |
| `02-html-nested-quotes.eml` | HTML path, three blockquote levels, lists, inline styling |
| `03-inline-cid-image.eml` | `multipart/related`, `cid:` resolution against attachments |
| `04-broken-base64.eml` | decode failure → defect recorded, partial output still produced |
| `05-encoded-word-subject.eml` | RFC 2047 encoded-words, Cyrillic and CJK glyph coverage |
| `06-forwarded-message.eml` | `message/rfc822` recursion into nested records |
| `07-large-pdf-attachment.eml` | 6 MB attachment, hashing, PDF merge path |
| `08-outlook-tables.eml` | nested tables, `<style>` stripping, table pagination |
| `09-remote-images.eml` | tracking pixel and remote images blocked; `<script>` stripped |
| `10-headers-only.eml` | empty body, header-only rendering |
| `11-inline-forwarded.eml` | message/rfc822 with no Content-Disposition — the inline default |

No fixture contains a real person's data or a real domain; all use
`.example` reserved domains per RFC 2606.
```

- [ ] **Step 5: Commit**

Add to `.gitignore` first — fixture 07 is roughly 8 MB of base64 and is
regenerated deterministically by the script:

```
docs/fixtures/eml/07-large-pdf-attachment.eml
```

```bash
git add .gitignore docs/fixtures/eml/ shared/testing/fixtures.js
git status --short docs/fixtures/eml/   # confirm 07-* is NOT staged
git commit -m "test: .eml fixture corpus with deterministic generator"
```

---

## Task 3: Hashing and header slicing

Two small pure modules that everything downstream depends on. Header slicing is separated from MIME parsing because the raw header appendix must reproduce the bytes **as received**, not a re-serialization of parsed values — a re-serialized Received chain is no longer evidence of anything.

**Files:**
- Create: `shared/eml/hash.js`
- Create: `shared/eml/headers.js`
- Create: `shared/eml/headers.test.js`
- Modify: `batesstamp/email-to-pdf/tests.html`

**Interfaces:**
- Consumes: `test`, `assertEqual`, `assertDeepEqual` from `/shared/testing/harness.js`; `loadFixture` from `/shared/testing/fixtures.js`.
- Produces:
  - `sha256Hex(bytes: Uint8Array) => Promise<string>` (64 lowercase hex chars)
  - `shortHash(hex: string) => string` (first 12 chars)
  - `extractRawHeaderBlock(bytes: Uint8Array) => string`
  - `unfoldHeaders(block: string) => Array<{key: string, rawValue: string}>`
  - `rawHeaderValue(block: string, name: string) => string | null`

- [ ] **Step 1: Write the failing tests**

```js
// shared/eml/headers.test.js
import { test, assertEqual, assertDeepEqual } from '/shared/testing/harness.js';
import { loadFixture } from '/shared/testing/fixtures.js';
import { extractRawHeaderBlock, unfoldHeaders, rawHeaderValue } from './headers.js';
import { sha256Hex, shortHash } from './hash.js';

const enc = (s) => new TextEncoder().encode(s);

test('extractRawHeaderBlock stops at the CRLFCRLF separator', () => {
  const block = extractRawHeaderBlock(enc('A: 1\r\nB: 2\r\n\r\nbody text\r\n'));
  assertEqual(block, 'A: 1\r\nB: 2\r\n');
});

test('extractRawHeaderBlock tolerates bare LF separators', () => {
  const block = extractRawHeaderBlock(enc('A: 1\nB: 2\n\nbody'));
  assertEqual(block, 'A: 1\nB: 2\n');
});

test('extractRawHeaderBlock returns everything when there is no body', () => {
  const block = extractRawHeaderBlock(enc('A: 1\r\nB: 2\r\n'));
  assertEqual(block, 'A: 1\r\nB: 2\r\n');
});

test('unfoldHeaders joins continuation lines', () => {
  const rows = unfoldHeaders(
    'Received: from mail.example\r\n by mx.example\r\n for <a@example>;\r\nDate: Tue\r\n'
  );
  assertDeepEqual(rows, [
    { key: 'Received', rawValue: 'from mail.example by mx.example for <a@example>;' },
    { key: 'Date', rawValue: 'Tue' }
  ]);
});

test('rawHeaderValue is case-insensitive and returns the first occurrence', () => {
  const block = 'Received: one\r\nRECEIVED: two\r\nSubject: Hello\r\n';
  assertEqual(rawHeaderValue(block, 'received'), 'one');
  assertEqual(rawHeaderValue(block, 'SUBJECT'), 'Hello');
  assertEqual(rawHeaderValue(block, 'Absent'), null);
});

test('rawHeaderValue preserves the Date header verbatim, offset intact', async () => {
  const bytes = await loadFixture('01-plain-text.eml');
  const block = extractRawHeaderBlock(bytes);
  assertEqual(rawHeaderValue(block, 'Date'), 'Tue, 4 Mar 2026 09:14:22 -0800');
});

test('sha256Hex returns 64 lowercase hex characters', async () => {
  const hex = await sha256Hex(enc('abc'));
  assertEqual(hex, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assertEqual(shortHash(hex), 'ba7816bf8f01');
});

test('a continuation after a malformed line does not corrupt the previous header', () => {
  const rows = unfoldHeaders(
    'Good1: value1\r\nBadLineNoColon\r\n continuation of BadLine\r\nGood2: value2\r\n'
  );
  assertDeepEqual(rows, [
    { key: 'Good1', rawValue: 'value1' },
    { key: 'Good2', rawValue: 'value2' }
  ]);
});

test('a continuation line before any header is dropped, not crashed on', () => {
  assertDeepEqual(unfoldHeaders(' orphaned continuation\r\nSubject: Hello\r\n'), [
    { key: 'Subject', rawValue: 'Hello' }
  ]);
});
```

- [ ] **Step 2: Register the test module and run it to verify it fails**

In `batesstamp/email-to-pdf/tests.html`, replace the placeholder import line with:

```js
        await import('/shared/eml/headers.test.js');
```

Then:

```bash
cd /home/ctibs/Projects/legal-tools && bash build.sh --dev
cd batesstamp && python3 -m http.server 8788
```

Open `http://localhost:8788/email-to-pdf/tests.html`. Expected: the page fails to load its module and the browser console shows a 404 for `/shared/eml/headers.js`. That counts as the failing state; the tab title will not read PASS.

- [ ] **Step 3: Write the implementations**

```js
// shared/eml/hash.js
// SHA-256 over raw bytes. Requires a secure context: crypto.subtle is undefined
// over file://, so development must be served from http://localhost.

export async function sha256Hex(bytes) {
  if (!globalThis.crypto || !globalThis.crypto.subtle) {
    throw new Error(
      'crypto.subtle unavailable — this page must be served over https:// or http://localhost'
    );
  }
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// The footer carries a short digest for legibility; the certificate carries the
// full one. Twelve hex characters is 48 bits — ample to tie a loose page back to
// its source document, and short enough to sit in a footer without crowding it.
export function shortHash(hex) {
  return hex.slice(0, 12);
}
```

```js
// shared/eml/headers.js
// Raw header handling, kept separate from MIME parsing.
//
// The raw header appendix must reproduce the header block as received. Anything
// re-serialized from parsed values is no longer evidence of routing — a Received
// chain rebuilt from a parser's model proves nothing about what the mail servers
// actually wrote.

const MAX_HEADER_SCAN = 1024 * 1024; // 1 MB; no legitimate header block is larger

function decodeAscii(bytes) {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

/**
 * Return the verbatim header block: everything up to (not including) the blank
 * line that separates headers from body. Handles CRLFCRLF and bare LFLF.
 */
export function extractRawHeaderBlock(bytes) {
  const limit = Math.min(bytes.length, MAX_HEADER_SCAN);
  for (let i = 0; i + 1 < limit; i++) {
    if (bytes[i] === 13 && bytes[i + 1] === 10 &&
        bytes[i + 2] === 13 && bytes[i + 3] === 10) {
      return decodeAscii(bytes.subarray(0, i + 2));
    }
    if (bytes[i] === 10 && bytes[i + 1] === 10) {
      return decodeAscii(bytes.subarray(0, i + 1));
    }
  }
  return decodeAscii(bytes.subarray(0, limit));
}

/**
 * Split a raw header block into rows, joining RFC 5322 folded continuation
 * lines. Values are returned undecoded — encoded-words stay as written.
 */
export function unfoldHeaders(block) {
  const rows = [];
  let lastLineWasHeader = false;

  for (const line of block.split(/\r?\n/)) {
    if (line === '') continue;

    if (/^[ \t]/.test(line)) {
      // A folded line continues the line directly above it. If that line was
      // malformed and skipped, this continuation has no header to join —
      // appending it to the last *valid* row would silently corrupt an
      // unrelated header's value.
      if (lastLineWasHeader && rows.length) {
        rows[rows.length - 1].rawValue += ' ' + line.trim();
      }
      continue;
    }

    const idx = line.indexOf(':');
    if (idx === -1) {
      lastLineWasHeader = false; // malformed; the appendix still prints it verbatim
      continue;
    }

    rows.push({ key: line.slice(0, idx).trim(), rawValue: line.slice(idx + 1).trim() });
    lastLineWasHeader = true;
  }

  return rows;
}

/** First occurrence wins: the topmost Received line is the last hop. */
export function rawHeaderValue(block, name) {
  const wanted = name.toLowerCase();
  for (const row of unfoldHeaders(block)) {
    if (row.key.toLowerCase() === wanted) return row.rawValue;
  }
  return null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Reload `http://localhost:8788/email-to-pdf/tests.html`.
Expected: tab title `PASS 9/9`, green summary banner reading "all 9 passed".

- [ ] **Step 5: Commit**

```bash
git add shared/eml/hash.js shared/eml/headers.js shared/eml/headers.test.js \
        batesstamp/email-to-pdf/tests.html
git commit -m "feat(email-to-pdf): raw header slicing and SHA-256 hashing"
```

---

## Task 4: Vendor postal-mime and build the EmailRecord

**Files:**
- Create: `batesstamp/vendor/postal-mime/` (10 downloaded ESM files)
- Create: `batesstamp/vendor/README.md`
- Create: `shared/eml/parse.js`
- Create: `shared/eml/parse.test.js`
- Modify: `batesstamp/email-to-pdf/tests.html`

**Interfaces:**
- Consumes: `extractRawHeaderBlock`, `rawHeaderValue`, `unfoldHeaders` from `./headers.js`; `sha256Hex` from `./hash.js`.
- Produces: `parseEml(bytes: Uint8Array, opts?: {depth?: number, filename?: string}) => Promise<EmailRecord>`, with `EmailRecord` exactly as specified below. Every later task depends on these field names.

```js
/**
 * @typedef {Object} EmailRecord
 * @property {Uint8Array}  rawBytes        source bytes, retained for hashing
 * @property {string}      sourceFilename  the dropped file's name, '' when unknown
 * @property {string}      sourceSha256    64 hex chars
 * @property {string}      rawHeaderBlock  verbatim
 * @property {Array<{key: string, rawValue: string}>} rawHeaders
 * @property {{name: string, address: string}|null}   from
 * @property {Array<{name: string, address: string}>} to
 * @property {Array<{name: string, address: string}>} cc
 * @property {Array<{name: string, address: string}>} bcc
 * @property {{raw: string|null, parsed: Date|null}}  date
 * @property {string}      subject         decoded; '' when absent
 * @property {string|null} messageId
 * @property {string|null} bodyHtml
 * @property {string|null} bodyText
 * @property {'html'|'text'|'none'} bodyPartUsed
 * @property {Attachment[]} attachments
 * @property {Map<string, Attachment>} inlineImages  keyed by bare Content-ID
 * @property {EmailRecord[]} nested       message/rfc822 parts, parsed recursively
 * @property {Array<{code: string, detail: string}>} defects
 *
 * @typedef {Object} Attachment
 * @property {string} filename
 * @property {string} mimeType
 * @property {number} size
 * @property {Uint8Array} bytes
 * @property {string|null} contentId
 * @property {string} disposition   'attachment' | 'inline'
 * @property {string} sha256
 */
```

Defect codes used by this module, and by every later module that reads `defects`:
`BODY_DECODE_FAILED`, `NESTED_PARSE_FAILED`, `NEST_DEPTH_EXCEEDED`, `ATTACHMENT_UNREADABLE`.
(A file with zero parseable headers is not an email at all — it throws rather
than recording a defect, since the spec says such a file produces no PDF.)

- [ ] **Step 1: Vendor postal-mime**

postal-mime publishes **unbundled ES modules**: `src/postal-mime.js` imports five
sibling files, which in turn import others. There is no `dist/` bundle. So the
whole `src/` directory is vendored, and the relative imports resolve as they are.

```bash
cd /home/ctibs/Projects/legal-tools
mkdir -p batesstamp/vendor/postal-mime
BASE=https://cdn.jsdelivr.net/npm/postal-mime@3.0.0/src
for f in postal-mime.js mime-node.js text-format.js address-parser.js \
         decode-strings.js base64-encoder.js base64-decoder.js \
         qp-decoder.js pass-through-decoder.js html-entities.js; do
  curl -fL -o "batesstamp/vendor/postal-mime/$f" "$BASE/$f" || echo "MISSING: $f"
done
ls -la batesstamp/vendor/postal-mime/
sha256sum batesstamp/vendor/postal-mime/*.js
```

Expected: ten JavaScript files, no `MISSING` lines, and no file whose first bytes
are `<!DOCTYPE` (which would mean an error page was saved). Verify no import
escapes the vendored directory:

```bash
grep -rhoE "from '[^']+'" batesstamp/vendor/postal-mime/ | sort -u
```

Every path must start with `./`. If a new version adds an import of a file not in
the list above, add it and re-run — a missing sibling fails at page load with a
bare 404 in the console and no other symptom.

- [ ] **Step 2: Record the provenance of the vendored file**

```markdown
<!-- batesstamp/vendor/README.md -->
# Vendored dependencies

Committed rather than CDN-loaded. This site self-hosts its fonts so that
rendering a page contacts no third party (commit `58a5a5d`); a tool whose promise
is that confidential email never leaves the browser should not fetch its MIME
parser from someone else's server at page load either.

| File | Package | Version | Source | SHA-256 |
|---|---|---|---|---|
| `postal-mime/*.js` (10 files) | postal-mime | 3.0.0 | `https://cdn.jsdelivr.net/npm/postal-mime@3.0.0/src/` | *(paste the sha256sum output from Task 4 Step 1)* |
| `fontkit.umd.js` | @pdf-lib/fontkit | 1.1.1 | `https://unpkg.com/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js` | *(paste the sha256sum output from Task 8 Step 1)* |

postal-mime ships unbundled ES modules with relative sibling imports, so the whole
`src/` directory is vendored rather than a single file.

To update: download the new version, replace the directory, re-run the import
audit from Task 4 Step 1, record the new hashes here, and re-run
`/email-to-pdf/tests.html` in full before committing. The parser's return shape is
load-bearing for `shared/eml/parse.js`.
```

- [ ] **Step 3: Write the failing tests**

```js
// shared/eml/parse.test.js
import { test, assert, assertEqual } from '/shared/testing/harness.js';
import { loadFixture } from '/shared/testing/fixtures.js';
import { parseEml } from './parse.js';

test('parses addresses, subject and the verbatim date', async () => {
  const rec = await parseEml(await loadFixture('01-plain-text.eml'));
  assertEqual(rec.from.address, 'jsmith@acme-manufacturing.example');
  assertEqual(rec.from.name, 'John Smith');
  assertEqual(rec.to.length, 1);
  assertEqual(rec.to[0].address, 'counsel@firm.example');
  assertEqual(rec.subject, 'Delivery schedule');
  assertEqual(rec.date.raw, 'Tue, 4 Mar 2026 09:14:22 -0800');
  assertEqual(rec.bodyPartUsed, 'text');
  assert(rec.bodyHtml === null, 'no HTML part in this fixture');
});

test('hashes the source bytes and carries the source filename', async () => {
  const bytes = await loadFixture('01-plain-text.eml');
  const rec = await parseEml(bytes, { filename: '01-plain-text.eml' });
  assertEqual(rec.sourceSha256.length, 64);
  assert(/^[0-9a-f]+$/.test(rec.sourceSha256), 'hash is lowercase hex');
  assertEqual(rec.sourceFilename, '01-plain-text.eml');
});

test('prefers the HTML part when both are present', async () => {
  const rec = await parseEml(await loadFixture('02-html-nested-quotes.eml'));
  assertEqual(rec.bodyPartUsed, 'html');
  assert(rec.bodyHtml.includes('<blockquote>'), 'HTML body retained');
  assertEqual(rec.cc.length, 1);
  assertEqual(rec.cc[0].address, 'docket@firm.example');
});

test('indexes inline images by bare Content-ID', async () => {
  const rec = await parseEml(await loadFixture('03-inline-cid-image.eml'));
  assert(rec.inlineImages.has('markup001'), 'cid indexed without angle brackets');
  assertEqual(rec.inlineImages.get('markup001').mimeType, 'image/png');
});

test('decodes RFC 2047 encoded-word subjects', async () => {
  const rec = await parseEml(await loadFixture('05-encoded-word-subject.eml'));
  assertEqual(rec.subject, 'Перевод договора');
});

test('parses message/rfc822 attachments into nested records', async () => {
  const rec = await parseEml(await loadFixture('06-forwarded-message.eml'));
  assertEqual(rec.nested.length, 1);
  assertEqual(rec.nested[0].subject, 'Delivery schedule');
  assertEqual(rec.nested[0].date.raw, 'Tue, 4 Mar 2026 09:14:22 -0800');
});

test('hashes and sizes attachments', async () => {
  const rec = await parseEml(await loadFixture('07-large-pdf-attachment.eml'));
  const pdf = rec.attachments.find((a) => a.mimeType === 'application/pdf');
  assert(pdf, 'PDF attachment found');
  assertEqual(pdf.filename, 'executed-agreement.pdf');
  assertEqual(pdf.sha256.length, 64);
  assert(pdf.size > 5 * 1024 * 1024, 'attachment size is the decoded size');
});

test('a malformed body still yields intact headers rather than throwing', async () => {
  // Whether the library salvages the readable opening line is its business and
  // is deliberately not asserted. What this tool guarantees is that a lawyer
  // learns the message exists even when its body cannot be decoded.
  const rec = await parseEml(await loadFixture('04-broken-base64.eml'));
  assertEqual(rec.subject, 'Corrupted message');
  assertEqual(rec.date.raw, 'Fri, 7 Mar 2026 12:00:00 -0800');
});

test('an empty body is reported as such, not as a failure', async () => {
  const rec = await parseEml(await loadFixture('10-headers-only.eml'));
  assertEqual(rec.bodyPartUsed, 'none');
  assertEqual(rec.subject, 'Read receipt');
  assertEqual(rec.defects.length, 0);
});

test('a forwarded message with no Content-Disposition is still preserved as nested', async () => {
  const rec = await parseEml(await loadFixture('11-inline-forwarded.eml'),
    { filename: '11-inline-forwarded.eml' });
  assertEqual(rec.nested.length, 1);
  assertEqual(rec.nested[0].subject, 'Delivery schedule');
  // The forwarded message's own date, with its own offset, is the point.
  assertEqual(rec.nested[0].date.raw, 'Tue, 4 Mar 2026 09:14:22 -0800');
});
```

- [ ] **Step 4: Register and run to verify failure**

Add to `tests.html` after the headers test import:

```js
        await import('/shared/eml/parse.test.js');
```

Reload the test page. Expected: 404 for `/shared/eml/parse.js` in the console.

- [ ] **Step 5: Write the implementation**

```js
// shared/eml/parse.js
// postal-mime wrapper producing the EmailRecord shape the rest of the pipeline
// consumes. Swapping in a .msg parser later means writing a module that returns
// this same shape; nothing downstream changes.

import PostalMime from '/vendor/postal-mime/postal-mime.js';
import { sha256Hex } from './hash.js';
import { extractRawHeaderBlock, unfoldHeaders, rawHeaderValue } from './headers.js';

const MAX_NEST_DEPTH = 5;

function toAddressList(value) {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return list
    .filter((a) => a && (a.address || a.name))
    .map((a) => ({ name: a.name || '', address: a.address || '' }));
}

function bareContentId(cid) {
  if (!cid) return null;
  return cid.replace(/^</, '').replace(/>$/, '');
}

function toBytes(content) {
  if (content instanceof Uint8Array) return content;
  if (content instanceof ArrayBuffer) return new Uint8Array(content);
  // postal-mime may hand back a base64 string depending on part encoding.
  if (typeof content === 'string') {
    const bin = atob(content);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // Never fabricate an empty attachment: a 0-byte file with a valid hash reads
  // as genuine, and the reader has no way to tell the content was lost.
  throw new Error('unrecognized attachment content type: ' + Object.prototype.toString.call(content));
}

/**
 * @param {Uint8Array} bytes
 * @param {{depth?: number, filename?: string}} [opts]
 * @returns {Promise<EmailRecord>}
 */
export async function parseEml(bytes, opts = {}) {
  const depth = opts.depth || 0;
  const sourceFilename = opts.filename || '';
  const defects = [];

  const rawHeaderBlock = extractRawHeaderBlock(bytes);
  const rawHeaders = unfoldHeaders(rawHeaderBlock);
  if (rawHeaders.length === 0) {
    // Not a partial: a file with no parseable headers is not an email, and
    // producing a PDF for it would assert something untrue about its contents.
    throw new Error('No email headers found — this does not appear to be a .eml file');
  }

  let parsed;
  try {
    // Without this, postal-mime treats a message/rfc822 part with no
    // Content-Disposition as inline: it subparses the forwarded message and
    // merges its body into the parent's text, never surfacing it in
    // `attachments`. That silently drops the forwarded message's own
    // From/To/Subject and its own dated UTC offset — frequently the evidence
    // that matters. Forcing it to an attachment lets the recursion below fire.
    parsed = await new PostalMime({ forceRfc822Attachments: true }).parse(bytes);
  } catch (err) {
    defects.push({ code: 'BODY_DECODE_FAILED', detail: String(err && err.message || err) });
    parsed = { headers: [], attachments: [], html: null, text: null };
  }

  const attachments = [];
  const inlineImages = new Map();
  const nested = [];

  for (const att of parsed.attachments || []) {
    let attBytes;
    try {
      attBytes = toBytes(att.content);
    } catch (err) {
      defects.push({
        code: 'ATTACHMENT_UNREADABLE',
        detail: (att.filename || 'unnamed attachment') + ': ' + String(err && err.message || err)
      });
      continue;
    }

    const mimeType = att.mimeType || 'application/octet-stream';

    if (mimeType === 'message/rfc822') {
      if (depth >= MAX_NEST_DEPTH) {
        defects.push({
          code: 'NEST_DEPTH_EXCEEDED',
          detail: 'stopped at ' + MAX_NEST_DEPTH + ' levels of forwarded messages'
        });
      } else {
        try {
          nested.push(await parseEml(attBytes, {
            depth: depth + 1,
            filename: att.filename || 'forwarded-message.eml'
          }));
          continue; // rendered as a nested record, not listed as a file attachment
        } catch (err) {
          defects.push({
            code: 'NESTED_PARSE_FAILED',
            detail: String(err && err.message || err)
          });
        }
      }
    }

    const record = {
      filename: att.filename || 'unnamed',
      mimeType,
      size: attBytes.length,
      bytes: attBytes,
      contentId: bareContentId(att.contentId),
      disposition: att.disposition === 'inline' ? 'inline' : 'attachment',
      sha256: await sha256Hex(attBytes)
    };
    attachments.push(record);
    if (record.contentId) inlineImages.set(record.contentId, record);
  }

  const bodyHtml = parsed.html || null;
  const bodyText = parsed.text || null;
  const bodyPartUsed = bodyHtml ? 'html' : (bodyText && bodyText.trim() ? 'text' : 'none');

  const rawDate = rawHeaderValue(rawHeaderBlock, 'Date');
  let parsedDate = null;
  if (rawDate) {
    const d = new Date(rawDate);
    parsedDate = isNaN(d.getTime()) ? null : d;
  }

  return {
    rawBytes: bytes,
    sourceFilename,
    sourceSha256: await sha256Hex(bytes),
    rawHeaderBlock,
    rawHeaders,
    from: toAddressList(parsed.from)[0] || null,
    to: toAddressList(parsed.to),
    cc: toAddressList(parsed.cc),
    bcc: toAddressList(parsed.bcc),
    // The raw string is what renders. parsedDate exists only for sorting a batch
    // into chronological order and must never reach the page — converting to the
    // reviewer's local zone would silently alter the exhibit.
    date: { raw: rawDate, parsed: parsedDate },
    subject: parsed.subject || '',
    messageId: rawHeaderValue(rawHeaderBlock, 'Message-ID'),
    bodyHtml,
    bodyText,
    bodyPartUsed,
    attachments,
    inlineImages,
    nested,
    defects
  };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Reload `http://localhost:8788/email-to-pdf/tests.html`.
Expected: tab title `PASS 16/16`.

If the encoded-word or nested-message test fails, the vendored version's return shape differs from what this task assumes — fix `parse.js` to match the library, never the test to match the bug, and note the difference in `batesstamp/vendor/README.md`.

- [ ] **Step 7: Commit**

```bash
git add batesstamp/vendor/ shared/eml/parse.js shared/eml/parse.test.js \
        batesstamp/email-to-pdf/tests.html
git commit -m "feat(email-to-pdf): vendor postal-mime and normalize to EmailRecord"
```

---

## Task 5: Sanitization

The privacy boundary. Everything this module removes is removed for a stated reason, and everything it removes is counted so the certificate can say so.

**Files:**
- Create: `shared/eml/sanitize.js`
- Create: `shared/eml/sanitize.test.js`
- Modify: `batesstamp/email-to-pdf/tests.html`

**Interfaces:**
- Consumes: `EmailRecord.inlineImages` (a `Map<string, Attachment>`).
- Produces: `sanitizeHtml(html: string, inlineImages: Map) => {body: HTMLElement, stats: SanitizeStats}` where `SanitizeStats` is `{remoteImagesBlocked: number, trackingPixelsBlocked: number, activeContentRemoved: number, unresolvedCidImages: number}`.

`DOMParser.parseFromString(html, 'text/html')` produces an **inert** document: scripts do not execute and no subresource is fetched, because the document has no browsing context. That inertness is what makes it safe to parse hostile HTML here, and it is why the result must never be inserted into the live page before this module has run.

- [ ] **Step 1: Write the failing tests**

```js
// shared/eml/sanitize.test.js
import { test, assert, assertEqual } from '/shared/testing/harness.js';
import { loadFixture } from '/shared/testing/fixtures.js';
import { parseEml } from './parse.js';
import { sanitizeHtml } from './sanitize.js';

test('strips script and style elements and counts them', () => {
  const { body, stats } = sanitizeHtml(
    '<p>keep</p><script>evil()</script><style>.x{}</style>', new Map()
  );
  assertEqual(body.querySelector('script'), null);
  assertEqual(body.querySelector('style'), null);
  assertEqual(stats.activeContentRemoved, 2);
  assert(body.textContent.includes('keep'), 'visible content survives');
});

test('strips event handler attributes and javascript: hrefs', () => {
  const { body } = sanitizeHtml(
    '<a href="javascript:evil()" onclick="evil()">click</a>', new Map()
  );
  const a = body.querySelector('a');
  assertEqual(a.getAttribute('onclick'), null);
  assertEqual(a.getAttribute('href'), null);
});

test('blocks remote images and leaves a labeled placeholder', () => {
  const { body, stats } = sanitizeHtml(
    '<img src="https://cdn.example/banner.png" alt="Banner" width="600" height="120">',
    new Map()
  );
  assertEqual(body.querySelector('img'), null);
  const ph = body.querySelector('[data-blocked-image]');
  assert(ph, 'placeholder element inserted');
  assertEqual(ph.getAttribute('data-alt'), 'Banner');
  assertEqual(stats.remoteImagesBlocked, 1);
  assertEqual(stats.trackingPixelsBlocked, 0);
});

test('counts 1x1 remote images as tracking pixels separately', () => {
  const { stats } = sanitizeHtml(
    '<img src="https://track.example/o?id=1" width="1" height="1">', new Map()
  );
  assertEqual(stats.remoteImagesBlocked, 1);
  assertEqual(stats.trackingPixelsBlocked, 1);
});

test('resolves cid: images against the attachment map', () => {
  const inline = new Map([['markup001', { contentId: 'markup001', mimeType: 'image/png' }]]);
  const { body, stats } = sanitizeHtml(
    '<img src="cid:markup001" width="48" height="48">', inline
  );
  const img = body.querySelector('[data-cid-ref]');
  assertEqual(img.getAttribute('data-cid-ref'), 'markup001');
  assertEqual(stats.unresolvedCidImages, 0);
});

test('an unresolvable cid becomes a placeholder and is counted', () => {
  const { body, stats } = sanitizeHtml('<img src="cid:missing">', new Map());
  assertEqual(stats.unresolvedCidImages, 1);
  assert(body.querySelector('[data-blocked-image]'), 'placeholder inserted');
});

test('data: images are preserved', () => {
  const url = 'data:image/png;base64,iVBORw0KGgo=';
  const { body } = sanitizeHtml('<img src="' + url + '">', new Map());
  assertEqual(body.querySelector('[data-data-uri]').getAttribute('data-data-uri'), url);
});

test('a visible image at a tracker-ish URL still gets a placeholder', () => {
  const { body, stats } = sanitizeHtml(
    '<img src="https://ads.example/pixel/creative123.jpg" alt="Promo" width="600" height="120">',
    new Map()
  );
  assert(body.querySelector('[data-blocked-image]'), 'placeholder inserted, not deleted');
  assertEqual(stats.remoteImagesBlocked, 1);
  assertEqual(stats.trackingPixelsBlocked, 0, 'a URL keyword is not proof of a pixel');
});

test('an image with a relative or unknown-scheme src is disclosed, not dropped', () => {
  const { body, stats } = sanitizeHtml('<img src="logo.png" alt="Logo">', new Map());
  assert(body.querySelector('[data-blocked-image]'), 'placeholder inserted');
  assertEqual(stats.remoteImagesBlocked, 1);
});

test('the real marketing fixture loses its pixel, banner and script', async () => {
  const rec = await parseEml(await loadFixture('09-remote-images.eml'));
  const { body, stats } = sanitizeHtml(rec.bodyHtml, rec.inlineImages);
  assertEqual(stats.remoteImagesBlocked, 2);
  assertEqual(stats.trackingPixelsBlocked, 1);
  assertEqual(body.querySelector('script'), null);
  assert(body.querySelector('a[href^="https://portal"]'), 'link targets survive as text');
});
```

- [ ] **Step 2: Register and run to verify failure**

Add `await import('/shared/eml/sanitize.test.js');` to `tests.html`, reload, and confirm a 404 for `/shared/eml/sanitize.js`.

- [ ] **Step 3: Write the implementation**

```js
// shared/eml/sanitize.js
// Privacy and safety filtering, performed on a detached, inert document.
//
// The motivating threat is not script execution — DOMParser documents have no
// browsing context and never execute or fetch anything. It is the tracking pixel:
// loading a remote image tells the sender, with a timestamp and an IP address,
// that their email is being reviewed. For opposing counsel's correspondence that
// is an unacceptable disclosure, so no remote reference is ever resolved, and
// every removal is counted so the certificate can disclose it.

const ACTIVE_TAGS = [
  'script', 'style', 'iframe', 'object', 'embed', 'svg', 'link',
  'meta', 'base', 'form', 'input', 'button', 'textarea', 'select'
];

const SAFE_ATTRS = new Set([
  'href', 'alt', 'title', 'width', 'height', 'colspan', 'rowspan',
  'start', 'type', 'align', 'color', 'face', 'size',
  'data-cid-ref', 'data-data-uri', 'data-blocked-image', 'data-alt'
]);

function blockedPlaceholder(doc, alt, reason) {
  const el = doc.createElement('span');
  el.setAttribute('data-blocked-image', reason);
  el.setAttribute('data-alt', alt || '');
  return el;
}

/**
 * @param {string} html
 * @param {Map<string, Object>} inlineImages  keyed by bare Content-ID
 * @returns {{body: HTMLElement, stats: Object}}
 */
export function sanitizeHtml(html, inlineImages) {
  const stats = {
    remoteImagesBlocked: 0,
    trackingPixelsBlocked: 0,
    activeContentRemoved: 0,
    unresolvedCidImages: 0
  };

  const doc = new DOMParser().parseFromString(html || '', 'text/html');

  for (const tag of ACTIVE_TAGS) {
    for (const el of Array.from(doc.querySelectorAll(tag))) {
      stats.activeContentRemoved++;
      el.remove();
    }
  }

  for (const img of Array.from(doc.querySelectorAll('img'))) {
    const src = (img.getAttribute('src') || '').trim();
    const alt = img.getAttribute('alt') || '';
    const w = parseInt(img.getAttribute('width') || '0', 10);
    const h = parseInt(img.getAttribute('height') || '0', 10);

    if (/^cid:/i.test(src)) {
      const cid = src.slice(4).replace(/^</, '').replace(/>$/, '');
      if (inlineImages && inlineImages.has(cid)) {
        const keep = doc.createElement('span');
        keep.setAttribute('data-cid-ref', cid);
        if (w) keep.setAttribute('width', String(w));
        if (h) keep.setAttribute('height', String(h));
        keep.setAttribute('data-alt', alt);
        img.replaceWith(keep);
      } else {
        stats.unresolvedCidImages++;
        img.replaceWith(blockedPlaceholder(doc, alt, 'cid-not-found'));
      }
      continue;
    }

    if (/^data:image\//i.test(src)) {
      const keep = doc.createElement('span');
      keep.setAttribute('data-data-uri', src);
      if (w) keep.setAttribute('width', String(w));
      if (h) keep.setAttribute('height', String(h));
      keep.setAttribute('data-alt', alt);
      img.replaceWith(keep);
      continue;
    }

    if (/^https?:/i.test(src)) {
      stats.remoteImagesBlocked++;
      // Only declared 1x1 geometry proves an image had nothing to show. A URL
      // that merely looks tracker-ish ("/pixel/", "/track/") is a guess, and
      // guessing wrong deletes visible evidence with no mark on the page — so
      // anything else gets a placeholder, even if it is probably a beacon.
      if (w === 1 && h === 1) {
        stats.trackingPixelsBlocked++;
        img.remove();
      } else {
        img.replaceWith(blockedPlaceholder(doc, alt, 'remote'));
      }
      continue;
    }

    // Any other scheme — relative, protocol-relative, ftp:, empty. The reference
    // is unresolvable rather than merely unsafe, but the reader still needs to
    // know something was there.
    stats.remoteImagesBlocked++;
    img.replaceWith(blockedPlaceholder(doc, alt, 'remote'));
  }

  // Attribute scrub over everything that survived.
  for (const el of Array.from(doc.body.querySelectorAll('*'))) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) { el.removeAttribute(attr.name); continue; }
      if (name === 'href') {
        if (!/^(https?:|mailto:|tel:)/i.test(attr.value.trim())) el.removeAttribute('href');
        continue;
      }
      if (name === 'style') continue; // read by html-to-blocks, never applied as CSS
      if (!SAFE_ATTRS.has(name)) el.removeAttribute(attr.name);
    }
  }

  return { body: doc.body, stats };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Reload the test page. Expected: `PASS 29/29`.

- [ ] **Step 5: Commit**

```bash
git add shared/eml/sanitize.js shared/eml/sanitize.test.js batesstamp/email-to-pdf/tests.html
git commit -m "feat(email-to-pdf): sanitize email HTML and block remote image loads"
```

---

## Task 6: HTML to block IR

The module carrying the most interpretive risk, and the reason the pipeline has a pure middle stage at all.

**Files:**
- Create: `shared/eml/html-to-blocks.js`
- Create: `shared/eml/html-to-blocks.test.js`
- Modify: `batesstamp/email-to-pdf/tests.html`

**Interfaces:**
- Consumes: the `body` element from `sanitizeHtml`.
- Produces: `htmlToBlocks(bodyEl: HTMLElement) => Block[]`.

Block shapes — every later module reads these exact field names:

```js
{ type: 'paragraph',    runs: Run[] }
{ type: 'heading',      level: 1..6, runs: Run[] }
{ type: 'list',         ordered: boolean, depth: number, items: Block[][] }
{ type: 'blockquote',   depth: number, children: Block[] }
{ type: 'table',        rows: Cell[][] }
{ type: 'image',        ref: ImageRef, widthPx: number, heightPx: number, alt: string }
{ type: 'blockedImage', reason: 'remote'|'cid-not-found', alt: string }
{ type: 'preformatted', text: string }
{ type: 'rule' }

Run   = { text: string, bold: boolean, italic: boolean, underline: boolean,
          strike: boolean, color: string|null, sizeScale: number, href: string|null }
Cell  = { blocks: Block[], colspan: number, rowspan: number, header: boolean }
ImageRef = { kind: 'cid', contentId: string } | { kind: 'data', url: string }
```

- [ ] **Step 1: Write the failing tests**

```js
// shared/eml/html-to-blocks.test.js
import { test, assert, assertEqual } from '/shared/testing/harness.js';
import { loadFixture } from '/shared/testing/fixtures.js';
import { parseEml } from './parse.js';
import { sanitizeHtml } from './sanitize.js';
import { htmlToBlocks } from './html-to-blocks.js';

function blocks(html, inline) {
  const { body } = sanitizeHtml(html, inline || new Map());
  return htmlToBlocks(body);
}

const flat = (runs) => runs.map((r) => r.text).join('');

test('a paragraph becomes one paragraph block', () => {
  const out = blocks('<p>Hello there</p>');
  assertEqual(out.length, 1);
  assertEqual(out[0].type, 'paragraph');
  assertEqual(flat(out[0].runs), 'Hello there');
});

test('inline styling becomes run flags, not separate blocks', () => {
  const out = blocks('<p>plain <b>bold</b> and <i>italic</i></p>');
  assertEqual(out.length, 1);
  const bold = out[0].runs.find((r) => r.text === 'bold');
  const ital = out[0].runs.find((r) => r.text === 'italic');
  assertEqual(bold.bold, true);
  assertEqual(bold.italic, false);
  assertEqual(ital.italic, true);
});

test('nested emphasis combines flags', () => {
  const out = blocks('<p><b>bold <i>both</i></b></p>');
  const both = out[0].runs.find((r) => r.text === 'both');
  assertEqual(both.bold, true);
  assertEqual(both.italic, true);
});

test('links carry href on the run', () => {
  const out = blocks('<p>see <a href="https://example.test/x">this</a></p>');
  const link = out[0].runs.find((r) => r.text === 'this');
  assertEqual(link.href, 'https://example.test/x');
});

test('headings keep their level', () => {
  const out = blocks('<h2>March statement</h2>');
  assertEqual(out[0].type, 'heading');
  assertEqual(out[0].level, 2);
});

test('lists become list blocks with per-item blocks', () => {
  const out = blocks('<ul><li>one</li><li>two</li></ul>');
  assertEqual(out[0].type, 'list');
  assertEqual(out[0].ordered, false);
  assertEqual(out[0].items.length, 2);
  assertEqual(flat(out[0].items[0][0].runs), 'one');
});

test('ordered lists are marked ordered', () => {
  const out = blocks('<ol><li>first</li></ol>');
  assertEqual(out[0].ordered, true);
});

test('nested blockquotes carry increasing depth', () => {
  const out = blocks(
    '<blockquote><p>a</p><blockquote><p>b</p></blockquote></blockquote>'
  );
  assertEqual(out[0].type, 'blockquote');
  assertEqual(out[0].depth, 1);
  const inner = out[0].children.find((c) => c.type === 'blockquote');
  assertEqual(inner.depth, 2);
  assertEqual(flat(inner.children[0].runs), 'b');
});

test('tables preserve rows, cells and header flags', () => {
  const out = blocks(
    '<table><tr><th>H</th></tr><tr><td colspan="2">D</td></tr></table>'
  );
  assertEqual(out[0].type, 'table');
  assertEqual(out[0].rows.length, 2);
  assertEqual(out[0].rows[0][0].header, true);
  assertEqual(out[0].rows[1][0].colspan, 2);
});

test('a nested table becomes blocks inside the parent cell, never a lost table', () => {
  const out = blocks(
    '<table><tr><td><table><tr><td>inner</td></tr></table></td></tr></table>'
  );
  const cell = out[0].rows[0][0];
  const innerTable = cell.blocks.find((b) => b.type === 'table');
  assert(innerTable, 'inner table survives as a block inside the cell');
  assertEqual(flat(innerTable.rows[0][0].blocks[0].runs), 'inner');
});

test('a blocked image becomes a blockedImage block, never a silent gap', () => {
  const out = blocks('<img src="https://cdn.example/b.png" alt="Banner" width="600">');
  const img = out.find((b) => b.type === 'blockedImage');
  assertEqual(img.reason, 'remote');
  assertEqual(img.alt, 'Banner');
});

test('a resolvable cid image becomes an image block with a cid ref', () => {
  const inline = new Map([['c1', { contentId: 'c1', mimeType: 'image/png' }]]);
  const out = blocks('<img src="cid:c1" width="48" height="48">', inline);
  const img = out.find((b) => b.type === 'image');
  assertEqual(img.ref.kind, 'cid');
  assertEqual(img.ref.contentId, 'c1');
  assertEqual(img.widthPx, 48);
});

test('<br> breaks the line without starting a new block', () => {
  const out = blocks('<p>Robert Jones<br>Jones &amp; Associates</p>');
  assertEqual(out.length, 1);
  assertEqual(flat(out[0].runs), 'Robert Jones\nJones & Associates');
});

test('whitespace between block elements does not create empty paragraphs', () => {
  const out = blocks('<p>one</p>\n\n   \n<p>two</p>');
  assertEqual(out.length, 2);
  assertEqual(flat(out[0].runs), 'one');
  assertEqual(flat(out[1].runs), 'two');
});

test('an image wrapped in a link is preserved as a block, not dropped', () => {
  const out = blocks('<p><a href="https://x.example"><img src="https://cdn.example/b.png" alt="Banner" width="600" height="120"></a></p>');
  const img = out.find((b) => b.type === 'blockedImage');
  assert(img, 'blocked image emitted despite the inline wrapper');
  assertEqual(img.alt, 'Banner');
});

test('a tfoot row is kept, and ordered after the body rows', () => {
  const out = blocks('<table><tfoot><tr><td>TOTAL 99</td></tr></tfoot><tbody><tr><td>body</td></tr></tbody></table>');
  const table = out.find((b) => b.type === 'table');
  assertEqual(table.rows.length, 2);
  assertEqual(flat(table.rows[0][0].blocks[0].runs), 'body');
  assertEqual(flat(table.rows[1][0].blocks[0].runs), 'TOTAL 99');
});

test('a directly nested list keeps its items', () => {
  const out = blocks('<ul><ul><li>inner item</li></ul></ul>');
  assert(JSON.stringify(out).includes('inner item'), 'nested list content survives');
});

test('a table caption is emitted', () => {
  const out = blocks('<table><caption>Q3 figures</caption><tr><td>x</td></tr></table>');
  assert(JSON.stringify(out).includes('Q3 figures'), 'caption text survives');
});

test('a link wrapping block content keeps its href', () => {
  const out = blocks('<a href="https://keep.example"><div>Click here</div></a>');
  const hrefs = [];
  JSON.stringify(out, (k, v) => { if (k === 'href') hrefs.push(v); return v; });
  assert(hrefs.includes('https://keep.example'), 'href survives the block-child path');
});

test('a non-colour value in a style attribute is dropped, not carried through', () => {
  const out = blocks('<p style="color: url(https://tracker.example/x)">text</p>');
  assertEqual(out[0].runs[0].color, null);
});

test('a real colour in a style attribute is still read', () => {
  const out = blocks('<p style="color:#c00">text</p>');
  assertEqual(out[0].runs[0].color, '#c00');
});

test('the Outlook fixture yields a four-column table and keeps every row', async () => {
  const rec = await parseEml(await loadFixture('08-outlook-tables.eml'));
  const { body } = sanitizeHtml(rec.bodyHtml, rec.inlineImages);
  const out = htmlToBlocks(body);
  const table = out.find((b) => b.type === 'table');
  assertEqual(table.rows.length, 4);
  assertEqual(table.rows[0].length, 4);
});

test('the nested-quote fixture reaches depth three', async () => {
  const rec = await parseEml(await loadFixture('02-html-nested-quotes.eml'));
  const { body } = sanitizeHtml(rec.bodyHtml, rec.inlineImages);
  const out = htmlToBlocks(body);
  let node = out.find((b) => b.type === 'blockquote');
  let depth = node.depth;
  while (node) {
    node = (node.children || []).find((c) => c.type === 'blockquote');
    if (node) depth = node.depth;
  }
  assertEqual(depth, 3);
});
```

- [ ] **Step 2: Register and run to verify failure**

Add `await import('/shared/eml/html-to-blocks.test.js');` to `tests.html`, reload, confirm the 404.

- [ ] **Step 3: Write the implementation**

```js
// Sanitized DOM -> block IR. Pure: no I/O, no PDF knowledge, no live-DOM access.
//
// The IR is deliberately flat and small. Email HTML is written by thirty years of
// mail clients with no shared idea of correctness, so the goal is not to honour
// the markup but to recover the structure a reader would perceive: paragraphs,
// emphasis, lists, quote levels, tables, images.

const BLOCK_TAGS = new Set([
  'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI',
  'BLOCKQUOTE', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'PRE', 'HR', 'BR'
]);

const EMPTY_STYLE = {
  bold: false, italic: false, underline: false, strike: false,
  color: null, sizeScale: 1, href: null
};

const COLOR_OK = /^(#[0-9a-f]{3}|#[0-9a-f]{6}|rgba?\(\s*[\d.,\s%]+\)|[a-z]+)$/i;

function styleFor(el, inherited) {
  const s = Object.assign({}, inherited);
  const tag = el.tagName;
  if (tag === 'B' || tag === 'STRONG') s.bold = true;
  if (tag === 'I' || tag === 'EM') s.italic = true;
  if (tag === 'U' || tag === 'INS') s.underline = true;
  if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') s.strike = true;
  if (tag === 'A' && el.getAttribute('href')) s.href = el.getAttribute('href');
  if (tag === 'SMALL') s.sizeScale = 0.85;
  if (tag === 'BIG') s.sizeScale = 1.15;

  // The style attribute is read for colour and weight only. It is never applied
  // as CSS; the renderer has no cascade and pretending otherwise would produce
  // confident, wrong layout.
  const style = el.getAttribute && el.getAttribute('style');
  if (style) {
    const color = /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(style);
    if (color) {
      const value = color[1].trim();
      // Read for colour only: anything that is not a colour is dropped rather
      // than carried as free text out of the sanitization boundary.
      s.color = COLOR_OK.test(value) ? value : null;
    }
    if (/font-weight\s*:\s*(bold|[6-9]00)/i.test(style)) s.bold = true;
    if (/font-style\s*:\s*italic/i.test(style)) s.italic = true;
  }
  return s;
}

function collectRuns(node, style, runs) {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) { // text
      const text = child.nodeValue.replace(/\s+/g, ' ');
      if (text) runs.push(Object.assign({}, style, { text }));
      continue;
    }
    if (child.nodeType !== 1) continue;
    if (child.tagName === 'BR') {
      runs.push(Object.assign({}, style, { text: '\n' }));
      continue;
    }
    if (child.hasAttribute && child.hasAttribute('data-blocked-image')) continue;
    if (child.hasAttribute && (child.hasAttribute('data-cid-ref') ||
                               child.hasAttribute('data-data-uri'))) continue;
    collectRuns(child, styleFor(child, style), runs);
  }
}

function trimRuns(runs) {
  const out = runs.filter((r) => r.text !== '');
  if (out.length) out[0] = Object.assign({}, out[0], { text: out[0].text.replace(/^ +/, '') });
  const last = out.length - 1;
  if (last >= 0) out[last] = Object.assign({}, out[last], { text: out[last].text.replace(/ +$/, '') });
  return out.filter((r) => r.text !== '');
}

function imageBlockFrom(el) {
  const alt = el.getAttribute('data-alt') || '';
  const widthPx = parseInt(el.getAttribute('width') || '0', 10) || 0;
  const heightPx = parseInt(el.getAttribute('height') || '0', 10) || 0;
  if (el.hasAttribute('data-blocked-image')) {
    return { type: 'blockedImage', reason: el.getAttribute('data-blocked-image'), alt };
  }
  if (el.hasAttribute('data-cid-ref')) {
    return {
      type: 'image', alt, widthPx, heightPx,
      ref: { kind: 'cid', contentId: el.getAttribute('data-cid-ref') }
    };
  }
  return {
    type: 'image', alt, widthPx, heightPx,
    ref: { kind: 'data', url: el.getAttribute('data-data-uri') }
  };
}

function isImageish(el) {
  return el.nodeType === 1 && el.hasAttribute &&
    (el.hasAttribute('data-blocked-image') || el.hasAttribute('data-cid-ref') ||
     el.hasAttribute('data-data-uri'));
}

function hasBlockChild(el) {
  for (const c of Array.from(el.childNodes)) {
    if (c.nodeType === 1 && (BLOCK_TAGS.has(c.tagName) || isImageish(c)) && c.tagName !== 'BR') {
      return true;
    }
  }
  // An image marker nested inside an inline wrapper (<a><img></a> is the most
  // common image in email) must still escape to block level. Left inline, it is
  // skipped by collectRuns and disappears -- while sanitize has already counted
  // it, so the certificate would claim a blocked image the body never shows.
  // Losing the surrounding link styling is an acceptable price; losing the
  // image is not.
  return !!(el.querySelector &&
            el.querySelector('[data-blocked-image],[data-cid-ref],[data-data-uri]'));
}

/**
 * @param {HTMLElement} root  the body element returned by sanitizeHtml
 * @param {number} [quoteDepth]
 * @param {Object} [inherited]  style flags inherited from an enclosing inline
 *   wrapper (e.g. an <a> around block content), so a link target or emphasis
 *   applied above a block-child boundary is not lost when we recurse.
 * @returns {Array<Object>} block IR
 */
export function htmlToBlocks(root, quoteDepth = 0, inherited = EMPTY_STYLE) {
  const out = [];
  let pending = [];

  function flushPending() {
    const runs = trimRuns(pending);
    pending = [];
    if (runs.length) out.push({ type: 'paragraph', runs });
  }

  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === 3) {
      const text = node.nodeValue.replace(/\s+/g, ' ');
      if (text.trim()) pending.push(Object.assign({}, inherited, { text }));
      continue;
    }
    if (node.nodeType !== 1) continue;

    if (isImageish(node)) {
      flushPending();
      out.push(imageBlockFrom(node));
      continue;
    }

    const tag = node.tagName;

    if (tag === 'BR') { pending.push(Object.assign({}, inherited, { text: '\n' })); continue; }

    if (tag === 'HR') { flushPending(); out.push({ type: 'rule' }); continue; }

    if (tag === 'PRE') {
      flushPending();
      out.push({ type: 'preformatted', text: node.textContent });
      continue;
    }

    if (/^H[1-6]$/.test(tag)) {
      flushPending();
      const runs = [];
      collectRuns(node, inherited, runs);
      const trimmed = trimRuns(runs);
      if (trimmed.length) {
        out.push({ type: 'heading', level: parseInt(tag.slice(1), 10), runs: trimmed });
      }
      continue;
    }

    if (tag === 'UL' || tag === 'OL') {
      flushPending();
      const items = [];
      for (const child of Array.from(node.children)) {
        // A non-<li> child (a directly nested list, or a <div> some mail client
        // emitted) still carries content. Skipping it silently loses text.
        items.push(htmlToBlocks(child, quoteDepth, inherited));
      }
      if (items.length) {
        out.push({ type: 'list', ordered: tag === 'OL', depth: quoteDepth, items });
      }
      continue;
    }

    if (tag === 'BLOCKQUOTE') {
      flushPending();
      out.push({
        type: 'blockquote',
        depth: quoteDepth + 1,
        children: htmlToBlocks(node, quoteDepth + 1, inherited)
      });
      continue;
    }

    if (tag === 'TABLE') {
      flushPending();

      const caption = node.querySelector(':scope > caption');
      if (caption) {
        const capRuns = [];
        collectRuns(caption, inherited, capRuns);
        const trimmedCap = trimRuns(capRuns);
        if (trimmedCap.length) out.push({ type: 'paragraph', runs: trimmedCap });
      }

      // Gather rows by section explicitly, in visual order (head, then body,
      // then foot), rather than trusting querySelectorAll's document order --
      // a <tfoot> authored before <tbody> (legal, and required pre-HTML5)
      // would otherwise render above the body rows.
      const rowEls = [];
      for (const tr of Array.from(node.children)) {
        if (tr.tagName === 'TR') rowEls.push(tr);
      }
      for (const section of ['THEAD', 'TBODY', 'TFOOT']) {
        for (const sec of Array.from(node.children)) {
          if (sec.tagName !== section) continue;
          for (const tr of Array.from(sec.children)) {
            if (tr.tagName === 'TR') rowEls.push(tr);
          }
        }
      }

      const rows = [];
      for (const tr of rowEls) {
        const cells = [];
        for (const td of Array.from(tr.children)) {
          if (td.tagName !== 'TD' && td.tagName !== 'TH') continue;
          cells.push({
            blocks: htmlToBlocks(td, quoteDepth, inherited),
            colspan: parseInt(td.getAttribute('colspan') || '1', 10) || 1,
            rowspan: parseInt(td.getAttribute('rowspan') || '1', 10) || 1,
            header: td.tagName === 'TH'
          });
        }
        if (cells.length) rows.push(cells);
      }

      if (rows.length) {
        out.push({ type: 'table', rows });
      } else {
        // No conforming rows, but the element still held content (e.g. only a
        // caption, or markup too irregular to yield a row). Recurse the
        // element's children -- never the element itself, which would re-enter
        // this same TABLE branch and loop forever -- rather than drop it.
        for (const child of Array.from(node.children)) {
          if (child === caption) continue;
          out.push(...htmlToBlocks(child, quoteDepth, inherited));
        }
      }
      continue;
    }

    // DIV, P, SPAN, TD used loosely, and everything else: recurse when it holds
    // block-level children, otherwise treat it as inline content.
    if (hasBlockChild(node)) {
      flushPending();
      out.push(...htmlToBlocks(node, quoteDepth, styleFor(node, inherited)));
      continue;
    }

    const runs = [];
    collectRuns(node, styleFor(node, inherited), runs);
    if (tag === 'P' || tag === 'DIV') {
      flushPending();
      const trimmed = trimRuns(runs);
      if (trimmed.length) out.push({ type: 'paragraph', runs: trimmed });
    } else {
      pending.push(...runs);
    }
  }

  flushPending();
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Reload the test page. Expected: `PASS 52/52`.

- [ ] **Step 5: Commit**

```bash
git add shared/eml/html-to-blocks.js shared/eml/html-to-blocks.test.js \
        batesstamp/email-to-pdf/tests.html
git commit -m "feat(email-to-pdf): convert sanitized email HTML to block IR"
```

---

## Task 7: Plain text to block IR

**Files:**
- Create: `shared/eml/text-to-blocks.js`
- Create: `shared/eml/text-to-blocks.test.js`
- Modify: `batesstamp/email-to-pdf/tests.html`

**Interfaces:**
- Consumes: nothing.
- Produces: `textToBlocks(text: string) => Block[]` emitting the same block shapes as Task 6.

- [ ] **Step 1: Write the failing tests**

```js
// shared/eml/text-to-blocks.test.js
import { test, assert, assertEqual } from '/shared/testing/harness.js';
import { loadFixture } from '/shared/testing/fixtures.js';
import { parseEml } from './parse.js';
import { textToBlocks } from './text-to-blocks.js';

const flat = (runs) => runs.map((r) => r.text).join('');

test('blank lines separate paragraphs', () => {
  const out = textToBlocks('First para.\n\nSecond para.');
  assertEqual(out.length, 2);
  assertEqual(flat(out[0].runs), 'First para.');
});

test('single newlines are preserved inside a paragraph', () => {
  const out = textToBlocks('line one\nline two');
  assertEqual(out.length, 1);
  assert(flat(out[0].runs).includes('\n'), 'soft line break kept');
});

test('> prefixes become nested blockquote blocks', () => {
  const out = textToBlocks('reply\n\n> quoted one\n>> quoted two');
  const bq = out.find((b) => b.type === 'blockquote');
  assertEqual(bq.depth, 1);
  const inner = bq.children.find((c) => c.type === 'blockquote');
  assertEqual(inner.depth, 2);
  assertEqual(flat(inner.children[0].runs), 'quoted two');
});

test('quote markers are stripped from the rendered text', () => {
  const out = textToBlocks('> quoted');
  const bq = out.find((b) => b.type === 'blockquote');
  assertEqual(flat(bq.children[0].runs), 'quoted');
});

test('bare URLs become links', () => {
  const out = textToBlocks('See https://example.test/a?b=1 for details');
  const link = out[0].runs.find((r) => r.href);
  assertEqual(link.text, 'https://example.test/a?b=1');
  assertEqual(link.href, 'https://example.test/a?b=1');
});

test('the plain-text fixture yields two quote levels and keeps the list lines', async () => {
  const rec = await parseEml(await loadFixture('01-plain-text.eml'));
  const out = textToBlocks(rec.bodyText);
  const all = JSON.stringify(out);
  assert(all.includes('First shipment: March 18'), 'list line preserved verbatim');
  const bq = out.find((b) => b.type === 'blockquote');
  assertEqual(bq.depth, 1);
  assert(bq.children.some((c) => c.type === 'blockquote'), 'second level present');
});

test('a blank line inside a quote does not split it into two quotes', () => {
  const out = textToBlocks('> first para\n\n> second para');
  const quotes = out.filter((b) => b.type === 'blockquote');
  assertEqual(quotes.length, 1, 'one continuous quote, not two siblings');
  const rendered = JSON.stringify(quotes[0]);
  assert(rendered.includes('first para') && rendered.includes('second para'),
    'both paragraphs inside the one quote');
});

test('a blank line that ends a quote still ends it', () => {
  const out = textToBlocks('> quoted\n\nunquoted reply');
  assertEqual(out.filter((b) => b.type === 'blockquote').length, 1);
  assert(JSON.stringify(out.filter((b) => b.type === 'paragraph')).includes('unquoted reply'),
    'the unquoted paragraph is outside the quote');
});

test('ragged quote markers are all recognised and fully stripped', () => {
  const cases = [
    ['>text',        'text'],
    ['> > text',     'text'],
    ['>> text',      'text'],
    ['   > text',    'text']
  ];
  for (const [input, expected] of cases) {
    const out = textToBlocks(input);
    const bq = out.find((b) => b.type === 'blockquote');
    assert(bq, 'blockquote emitted for: ' + JSON.stringify(input));
    const rendered = JSON.stringify(bq);
    assert(rendered.includes(expected), 'text survives for: ' + JSON.stringify(input));
    assert(!rendered.includes('>'), 'no stray marker for: ' + JSON.stringify(input));
  }
});

test('a line that is only a quote marker does not crash or emit a stray marker', () => {
  const out = textToBlocks('> first\n>\n> second');
  const bq = out.find((b) => b.type === 'blockquote');
  assert(bq, 'blockquote emitted');
  assert(!JSON.stringify(bq).includes('>'), 'no stray marker');
});

test('a trailing sentence period is not swallowed into the link', () => {
  const out = textToBlocks('See https://example.test/a.');
  const link = out[0].runs.find((r) => r.href);
  assertEqual(link.href, 'https://example.test/a');
  assertEqual(link.text, 'https://example.test/a');
});

test('a URL in parentheses does not capture the closing paren', () => {
  const out = textToBlocks('(see https://example.test/a)');
  const link = out[0].runs.find((r) => r.href);
  assertEqual(link.href, 'https://example.test/a');
});

test('a bare scheme with no host is left as plain text, not linked', () => {
  const out = textToBlocks('the string http:// appears here');
  assertEqual(out[0].runs.filter((r) => r.href).length, 0);
});
```

- [ ] **Step 2: Register and run to verify failure**

Add `await import('/shared/eml/text-to-blocks.test.js');` to `tests.html`, reload, confirm the 404.

- [ ] **Step 3: Write the implementation**

```js
// shared/eml/text-to-blocks.js
// Plain-text bodies -> the same block IR the HTML path produces.
//
// Plain text carries real structure that a naive renderer throws away: '>' quote
// levels are the entire reply history of a thread. Indentation and alignment are
// preserved by keeping soft line breaks rather than reflowing, because a plain-text
// email that lines up columns with spaces means them to line up.

const URL_RE = /(https?:\/\/[^\s<>()]+[^\s<>().,;:!?])/g;

const EMPTY_STYLE = {
  bold: false, italic: false, underline: false, strike: false,
  color: null, sizeScale: 1, href: null
};

function runsWithLinks(text) {
  const runs = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    if (match.index > last) {
      runs.push(Object.assign({}, EMPTY_STYLE, { text: text.slice(last, match.index) }));
    }
    runs.push(Object.assign({}, EMPTY_STYLE, { text: match[0], href: match[0] }));
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    runs.push(Object.assign({}, EMPTY_STYLE, { text: text.slice(last) }));
  }
  return runs.length ? runs : [Object.assign({}, EMPTY_STYLE, { text })];
}

function quoteDepthOf(line) {
  const m = /^((?:\s*>)+)\s?/.exec(line);
  if (!m) return 0;
  return (m[1].match(/>/g) || []).length;
}

function stripQuoteMarkers(line, depth) {
  let out = line;
  for (let i = 0; i < depth; i++) out = out.replace(/^\s*>\s?/, '');
  return out;
}

function paragraphsFrom(lines) {
  const blocks = [];
  let buffer = [];
  const flush = () => {
    if (!buffer.length) return;
    const text = buffer.join('\n').replace(/\n+$/, '');
    if (text.trim()) blocks.push({ type: 'paragraph', runs: runsWithLinks(text) });
    buffer = [];
  };
  for (const line of lines) {
    if (line.trim() === '') flush();
    else buffer.push(line);
  }
  flush();
  return blocks;
}

/**
 * @param {string} text
 * @returns {Array<Object>} block IR
 */
export function textToBlocks(text) {
  const lines = (text || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const depth = quoteDepthOf(lines[i]);

    if (depth === 0) {
      const plain = [];
      while (i < lines.length && quoteDepthOf(lines[i]) === 0) plain.push(lines[i++]);
      out.push(...paragraphsFrom(plain));
      continue;
    }

    // Gather the whole quoted region at this depth or deeper, strip one level of
    // markers, and recurse — which yields nesting for free.
    const quoted = [];
    while (i < lines.length) {
      const d = quoteDepthOf(lines[i]);
      if (d >= depth) {
        quoted.push(stripQuoteMarkers(lines[i++], 1));
        continue;
      }
      if (lines[i].trim() === '') {
        // A bare blank line inside a quote is common in plain-text mail. Ending
        // the region here would split one quoted passage into two siblings and
        // misrepresent the reply chain. Only continue if the quote resumes.
        let j = i + 1;
        while (j < lines.length && lines[j].trim() === '') j++;
        if (j < lines.length && quoteDepthOf(lines[j]) >= depth) {
          quoted.push('');
          i++;
          continue;
        }
      }
      break;
    }

    // The recursive call sees markers one level shallower, so the blockquotes it
    // returns number their depths from 1. Rebase them onto the current depth or a
    // three-level reply chain would render as three separate first-level quotes.
    const children = rebaseDepth(textToBlocks(quoted.join('\n')), depth);
    out.push({ type: 'blockquote', depth, children });
  }

  return out;
}

function rebaseDepth(blocks, offset) {
  return blocks.map((b) => {
    if (b.type !== 'blockquote') return b;
    return {
      type: 'blockquote',
      depth: b.depth + offset,
      children: rebaseDepth(b.children, offset)
    };
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Reload the test page. Expected: `PASS 65/65` (6 original + 9 new text-to-blocks tests + 50 prior tests).

- [ ] **Step 5: Commit**

```bash
git add shared/eml/text-to-blocks.js shared/eml/text-to-blocks.test.js \
        batesstamp/email-to-pdf/tests.html
git commit -m "feat(email-to-pdf): convert plain-text bodies to block IR"

# After code review, fix blank line handling and add regression tests:
git add shared/eml/text-to-blocks.js shared/eml/text-to-blocks.test.js
git commit -m "fix(email-to-pdf): blank lines in quotes, URL edge cases, marker regression tests"
```

---

## Task 8: Fonts

**Files:**
- Create: `batesstamp/vendor/fontkit.umd.js` (downloaded)
- Create: `batesstamp/fonts/pdf/*.ttf` (copied from the system)
- Create: `batesstamp/fonts/pdf/LICENSES.md`
- Create: `shared/pdf/fonts.js`
- Create: `shared/pdf/fonts.test.js`
- Modify: `batesstamp/email-to-pdf/tests.html`, `batesstamp/vendor/README.md`

**Deviation from the spec, deliberate.** Spec §9 names DM Sans and Crimson Pro, the site's brand faces. This plan embeds **Liberation Sans / Serif / Mono** with **DejaVu Sans** as the Unicode fallback instead, because:

1. The brand faces ship here as *subsetted variable* `woff2`. fontkit cannot embed `woff2` at all, and a variable TTF embeds only its default instance — so there would be no real bold and no real italic, only synthetic slanting. An exhibit that cannot render `<b>` as bold is worse than one in a different typeface.
2. Liberation ships complete four-face sets (regular/bold/italic/bold-italic) with Latin, Greek and Cyrillic coverage; DejaVu covers the remainder. The Cyrillic fixture renders as text rather than as substitution boxes.
3. The PDF is an exhibit, not a web page. Type that matches the website is worth less here than type that renders the evidence.

The spec's substitution-and-count rule still applies as the floor for anything neither family covers — CJK, for instance, which will substitute and be disclosed.

**Interfaces:**
- Consumes: a `PDFDocument` from pdf-lib.
- Produces:
  - `loadFontSet(pdfDoc, {family: 'sans'|'serif'}) => Promise<FontSet>`
  - `FontSet.faceFor(style) => string` — maps a run's `{bold, italic}` to a face key
  - `FontSet.segment(text, faceKey) => Array<{text: string, faceKey: string}>`
  - `FontSet.font(faceKey) => PDFFont`
  - `FontSet.substitutions` — running count of characters no face could render

- [ ] **Step 1: Vendor fontkit and copy the font files**

```bash
cd /home/ctibs/Projects/legal-tools
curl -fL -o batesstamp/vendor/fontkit.umd.js \
  https://unpkg.com/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js
head -c 120 batesstamp/vendor/fontkit.umd.js

mkdir -p batesstamp/fonts/pdf
L=/usr/share/fonts/truetype/liberation
D=/usr/share/fonts/truetype/dejavu
cp $L/LiberationSans-Regular.ttf     batesstamp/fonts/pdf/
cp $L/LiberationSans-Bold.ttf        batesstamp/fonts/pdf/
cp $L/LiberationSans-Italic.ttf      batesstamp/fonts/pdf/
cp $L/LiberationSans-BoldItalic.ttf  batesstamp/fonts/pdf/
cp $L/LiberationSerif-Regular.ttf    batesstamp/fonts/pdf/
cp $L/LiberationSerif-Bold.ttf       batesstamp/fonts/pdf/
cp $L/LiberationSerif-Italic.ttf     batesstamp/fonts/pdf/
cp $L/LiberationSerif-BoldItalic.ttf batesstamp/fonts/pdf/
cp $L/LiberationMono-Regular.ttf     batesstamp/fonts/pdf/
cp $D/DejaVuSans.ttf                 batesstamp/fonts/pdf/
ls -la batesstamp/fonts/pdf/
```

Expected: ten TTF files, roughly 3–4 MB total. They are lazy-loaded on this tool page only, so no other page pays for them, and each is subsetted at embed time so the output PDF carries only the glyphs it uses.

- [ ] **Step 2: Record the font licences**

```markdown
<!-- batesstamp/fonts/pdf/LICENSES.md -->
# Fonts embedded in generated PDFs

Both families permit embedding and redistribution.

| Family | Licence | Upstream |
|---|---|---|
| Liberation Sans / Serif / Mono | SIL Open Font License 1.1 | https://github.com/liberationfonts/liberation-fonts |
| DejaVu Sans | Bitstream Vera + Arev licence (permissive, embedding allowed) | https://dejavu-fonts.github.io/ |

Copied from the Debian/Ubuntu packages `fonts-liberation` and `fonts-dejavu-core`.
Liberation carries the primary type; DejaVu is the fallback face for codepoints
Liberation lacks. Neither is the site's brand typeface — see Task 8 of
`docs/superpowers/plans/2026-09-11-email-to-pdf.md` for why.
```

- [ ] **Step 3: Write the failing tests**

```js
// shared/pdf/fonts.test.js
import { test, assert, assertEqual, assertThrows } from '/shared/testing/harness.js';
import { loadFontSet } from './fonts.js';

async function newDoc() {
  return await PDFLib.PDFDocument.create();
}

test('maps run styles onto face keys', async () => {
  const fs = await loadFontSet(await newDoc(), { family: 'sans' });
  assertEqual(fs.faceFor({ bold: false, italic: false }), 'regular');
  assertEqual(fs.faceFor({ bold: true, italic: false }), 'bold');
  assertEqual(fs.faceFor({ bold: false, italic: true }), 'italic');
  assertEqual(fs.faceFor({ bold: true, italic: true }), 'bolditalic');
});

test('Latin text stays on the primary face in one segment', async () => {
  const fs = await loadFontSet(await newDoc(), { family: 'sans' });
  const segs = fs.segment('Delivery schedule', 'regular');
  assertEqual(segs.length, 1);
  assertEqual(segs[0].faceKey, 'regular');
  assertEqual(fs.substitutions, 0);
});

test('Cyrillic renders rather than substituting', async () => {
  const fs = await loadFontSet(await newDoc(), { family: 'sans' });
  const segs = fs.segment('Перевод договора', 'regular');
  assert(segs.every((s) => s.faceKey !== 'fallback'), 'Cyrillic is covered by the primary face');
  assertEqual(fs.substitutions, 0);
});

test('mixed scripts split into segments without losing characters', async () => {
  const fs = await loadFontSet(await newDoc(), { family: 'sans' });
  const segs = fs.segment('Anna Иванова', 'regular');
  assertEqual(segs.map((s) => s.text).join(''), 'Anna Иванова');
});

test('uncovered codepoints substitute and are counted, never dropped', async () => {
  const fs = await loadFontSet(await newDoc(), { family: 'sans' });
  const segs = fs.segment('契約書', 'regular');
  assertEqual(fs.substitutions, 3);
  assertEqual(segs.map((s) => s.text).join('').length, 3, 'length preserved');
});

test('embedded fonts can measure text', async () => {
  const fs = await loadFontSet(await newDoc(), { family: 'serif' });
  const w = fs.font('regular').widthOfTextAtSize('Hello', 12);
  assert(w > 0, 'measured a positive width');
});

test('an unknown face key throws rather than silently drawing in another face', async () => {
  const fs = await loadFontSet(await newDoc(), { family: 'sans' });
  assertThrows(() => fs.font('no-such-face'), 'unknown key must throw');
});

test('the mono style maps to the monospace face', async () => {
  const fs = await loadFontSet(await newDoc(), { family: 'sans' });
  assertEqual(fs.faceFor({ mono: true }), 'mono');
  assert(fs.font('mono').widthOfTextAtSize('M', 12) > 0, 'mono face is embedded and measurable');
});

test('an astral-plane character counts as one substitution, not two', async () => {
  const fs = await loadFontSet(await newDoc(), { family: 'sans' });
  // U+20000 (CJK Extension B) is a single codepoint but two UTF-16 code units,
  // and is covered by neither Liberation nor DejaVu. Counting it twice would
  // overstate on the certificate what the conversion failed to render.
  // Do not use an emoji here: DejaVu ships real outlines for much of that range
  // (U+1F600 resolves to a genuine glyph, not .notdef), so an emoji probe tests
  // coverage rather than substitution.
  const segs = fs.segment('\u{20000}', 'regular');
  assertEqual(fs.substitutions, 1, 'one codepoint, one substitution');
  assertEqual(Array.from(segs.map((s) => s.text).join('')).length, 1,
    'one character out for one character in');
});

test('a covered astral character is rendered, not substituted', async () => {
  const fs = await loadFontSet(await newDoc(), { family: 'sans' });
  // The fallback face genuinely covers this one. Coverage must mean a real
  // glyph: if hasGlyphForCodePoint ever started reporting true for .notdef,
  // the certificate would under-report what could not be rendered.
  const segs = fs.segment('\u{1F600}', 'regular');
  assertEqual(fs.substitutions, 0, 'covered codepoint is not substituted');
  assertEqual(segs[0].faceKey, 'fallback', 'drawn by the fallback face');
});
```

Round-1 review note, superseded by round 2: the original astral test used
U+1F600 as the uncovered probe, but on this build machine DejaVu Sans 2.37
genuinely has real glyphs for U+1F600 and U+1F601 (verified with fontkit's
`hasGlyphForCodePoint` and a non-empty `glyphForCodePoint(...).path`, plus gid
5857/`u1F600` — not `.notdef`), so `substitutions` was honestly 0, not 1. The
test premise, not `segment()`, was wrong. Round 2 replaced the probe codepoint
with U+20000 (CJK Extension B, verified uncovered by both Liberation and
DejaVu and far more stable across font versions than an emoji, since emoji
coverage is exactly what font vendors keep adding) and added a second test
pinning the U+1F600 case explicitly: coverage must mean a real glyph, not a
`.notdef` false positive, and it is drawn by the `fallback` face.

- [ ] **Step 4: Load pdf-lib and fontkit on the test page, then run to verify failure**

Add to `tests.html` `<head>`, before the module script:

```html
    <script src="https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js" integrity="sha384-weMABwrltA6jWR8DDe9Jp5blk+tZQh7ugpCsF3JwSA53WZM9/14PjS5LAJNHNjAI" crossorigin="anonymous"></script>
    <script src="/vendor/fontkit.umd.js"></script>
```

and `await import('/shared/pdf/fonts.test.js');` to the module list. Reload; expect a 404 for `/shared/pdf/fonts.js`.

- [ ] **Step 5: Write the implementation**

```js
// shared/pdf/fonts.js
// TTF embedding, per-codepoint face resolution, and substitution accounting.
//
// Depends on globals `PDFLib` and `fontkit` from <script> tags on the page.
//
// Two families of four faces each carry the type; one fallback face covers
// codepoints they lack. Anything neither covers is substituted with U+FFFD and
// counted, so the certificate can say how many characters could not be rendered
// rather than letting them vanish.

const FONT_DIR = '/fonts/pdf/';

const FAMILY_FILES = {
  sans: {
    regular: 'LiberationSans-Regular.ttf',
    bold: 'LiberationSans-Bold.ttf',
    italic: 'LiberationSans-Italic.ttf',
    bolditalic: 'LiberationSans-BoldItalic.ttf'
  },
  serif: {
    regular: 'LiberationSerif-Regular.ttf',
    bold: 'LiberationSerif-Bold.ttf',
    italic: 'LiberationSerif-Italic.ttf',
    bolditalic: 'LiberationSerif-BoldItalic.ttf'
  }
};

const MONO_FILE = 'LiberationMono-Regular.ttf';
const FALLBACK_FILE = 'DejaVuSans.ttf';

const REPLACEMENT = '�';

const cache = new Map(); // filename -> Uint8Array, so a batch loads each face once

async function fetchFont(file) {
  if (cache.has(file)) return cache.get(file);
  const res = await fetch(FONT_DIR + file);
  if (!res.ok) throw new Error('Could not load font ' + file + ' (' + res.status + ')');
  const bytes = new Uint8Array(await res.arrayBuffer());
  cache.set(file, bytes);
  return bytes;
}

/**
 * @param {PDFDocument} pdfDoc
 * @param {{family?: 'sans'|'serif'}} [opts]
 */
export async function loadFontSet(pdfDoc, opts = {}) {
  const family = opts.family === 'serif' ? 'serif' : 'sans';
  pdfDoc.registerFontkit(fontkit);

  const files = Object.assign({}, FAMILY_FILES[family], {
    mono: MONO_FILE,
    fallback: FALLBACK_FILE
  });

  const faces = new Map();
  for (const [key, file] of Object.entries(files)) {
    const bytes = await fetchFont(file);
    faces.set(key, {
      // subset: true keeps only the glyphs actually drawn, so a one-page email
      // does not carry four megabytes of unused type.
      pdfFont: await pdfDoc.embedFont(bytes, { subset: true }),
      fk: fontkit.create(bytes)
    });
  }

  const state = { substitutions: 0 };

  function covers(faceKey, cp) {
    const face = faces.get(faceKey);
    return !!(face && face.fk.hasGlyphForCodePoint(cp));
  }

  return {
    get substitutions() { return state.substitutions; },

    faceFor(style) {
      if (style && style.mono) return 'mono';
      if (style && style.bold && style.italic) return 'bolditalic';
      if (style && style.bold) return 'bold';
      if (style && style.italic) return 'italic';
      return 'regular';
    },

    font(faceKey) {
      const face = faces.get(faceKey);
      // Every caller passes a key that segment() produced or a literal from this
      // module's own set, so a miss is a programming error. Falling back to the
      // regular face would draw the document in the wrong typeface and say nothing.
      if (!face) throw new Error('unknown font face key: ' + faceKey);
      return face.pdfFont;
    },

    /**
     * Split text into runs of consecutive characters drawable by one face.
     * Never drops a character: an uncovered codepoint becomes U+FFFD on the
     * fallback face and increments the substitution count.
     */
    segment(text, faceKey) {
      const segments = [];
      let current = null;

      for (const ch of String(text)) {
        const cp = ch.codePointAt(0);
        let useKey;
        let useText = ch;

        if (covers(faceKey, cp)) {
          useKey = faceKey;
        } else if (covers('fallback', cp)) {
          useKey = 'fallback';
        } else {
          state.substitutions++;
          useKey = 'fallback';
          useText = REPLACEMENT;
        }

        if (current && current.faceKey === useKey) current.text += useText;
        else { current = { text: useText, faceKey: useKey }; segments.push(current); }
      }

      return segments;
    }
  };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Reload. Expected: `PASS 52/52`.

The substitution test asserts exactly 3 for `契約書`. If Liberation or DejaVu on the build machine covers CJK, that count will differ — investigate which face covered it rather than loosening the assertion, because a silently-covered glyph today can become a substituted one on a different machine, and the certificate's honesty depends on this count being right.

- [ ] **Step 7: Commit**

```bash
git add batesstamp/vendor/fontkit.umd.js batesstamp/vendor/README.md \
        batesstamp/fonts/pdf/ shared/pdf/fonts.js shared/pdf/fonts.test.js \
        batesstamp/email-to-pdf/tests.html
git commit -m "feat(email-to-pdf): embed subsetted TTFs with Unicode fallback and substitution accounting"
```

---

## Task 9: Line breaking

Pure, with measurement injected — which is what makes the trickiest logic in the renderer testable without a PDF at all.

**Files:**
- Create: `shared/pdf/measure.js`
- Create: `shared/pdf/measure.test.js`
- Modify: `batesstamp/email-to-pdf/tests.html`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `tokenizeRuns(runs: Run[]) => Token[]` where `Token = {text, space: boolean, newline: boolean, style: Run}`
  - `wrapTokens(tokens: Token[], maxWidth: number, measure: (Token) => number) => Token[][]`

- [ ] **Step 1: Write the failing tests**

```js
// shared/pdf/measure.test.js
import { test, assert, assertEqual } from '/shared/testing/harness.js';
import { tokenizeRuns, wrapTokens } from './measure.js';

// One unit per character keeps the arithmetic obvious in assertions.
const measure = (tok) => tok.text.length;
const style = { bold: false, italic: false };
const lineText = (line) => line.map((t) => t.text).join('');

test('tokenizes runs into words and spaces, keeping style on each token', () => {
  const toks = tokenizeRuns([{ text: 'one two', ...style }]);
  assertEqual(toks.length, 3);
  assertEqual(toks[0].text, 'one');
  assertEqual(toks[1].space, true);
  assertEqual(toks[2].text, 'two');
});

test('newlines become their own tokens', () => {
  const toks = tokenizeRuns([{ text: 'a\nb', ...style }]);
  assert(toks.some((t) => t.newline), 'newline token emitted');
});

test('wraps at the width boundary', () => {
  const toks = tokenizeRuns([{ text: 'aaa bbb ccc', ...style }]);
  const lines = wrapTokens(toks, 7, measure);
  assertEqual(lines.length, 2);
  assertEqual(lineText(lines[0]), 'aaa bbb');
  assertEqual(lineText(lines[1]), 'ccc');
});

test('trailing spaces do not push a line over the boundary', () => {
  const toks = tokenizeRuns([{ text: 'aaa bbb', ...style }]);
  const lines = wrapTokens(toks, 7, measure);
  assertEqual(lines.length, 1);
  assertEqual(lineText(lines[0]), 'aaa bbb');
});

test('a newline token forces a break even mid-width', () => {
  const toks = tokenizeRuns([{ text: 'a\nb', ...style }]);
  const lines = wrapTokens(toks, 100, measure);
  assertEqual(lines.length, 2);
  assertEqual(lineText(lines[0]), 'a');
  assertEqual(lineText(lines[1]), 'b');
});

test('consecutive newlines produce empty lines rather than collapsing', () => {
  const toks = tokenizeRuns([{ text: 'a\n\nb', ...style }]);
  const lines = wrapTokens(toks, 100, measure);
  assertEqual(lines.length, 3);
  assertEqual(lineText(lines[1]), '');
});

test('a token longer than the line is hard-broken, never truncated', () => {
  const toks = tokenizeRuns([
    { text: 'https://example.test/a/very/long/path/that/never/wraps', ...style }
  ]);
  const lines = wrapTokens(toks, 10, measure);
  assert(lines.length > 1, 'broken across lines');
  assertEqual(
    lines.map(lineText).join(''),
    'https://example.test/a/very/long/path/that/never/wraps'
  );
  assert(lines.every((l) => measure({ text: lineText(l) }) <= 10), 'every line fits');
});

test('leading spaces on a wrapped line are dropped', () => {
  const toks = tokenizeRuns([{ text: 'aaaa bbbb', ...style }]);
  const lines = wrapTokens(toks, 5, measure);
  assertEqual(lineText(lines[1]), 'bbbb');
});

test('an empty run list yields no lines', () => {
  assertEqual(wrapTokens(tokenizeRuns([]), 50, measure).length, 0);
});
```

- [ ] **Step 2: Register and run to verify failure**

Add `await import('/shared/pdf/measure.test.js');` to `tests.html`; expect a 404 for `/shared/pdf/measure.js`.

- [ ] **Step 3: Write the implementation**

```js
// shared/pdf/measure.js
// Tokenizing and line breaking. Pure: measurement is injected, so this module is
// testable with a one-unit-per-character stub and has no font dependency.

/**
 * Split styled runs into word, space and newline tokens. Style travels with each
 * token so a line can mix bold and regular text without extra bookkeeping.
 */
export function tokenizeRuns(runs) {
  const tokens = [];
  for (const run of runs || []) {
    const parts = String(run.text).split(/(\n|[ \t]+)/);
    for (const part of parts) {
      if (part === '') continue;
      if (part === '\n') { tokens.push({ text: '', space: false, newline: true, style: run }); continue; }
      if (/^[ \t]+$/.test(part)) { tokens.push({ text: ' ', space: true, newline: false, style: run }); continue; }
      tokens.push({ text: part, space: false, newline: false, style: run });
    }
  }
  return tokens;
}

/** Split one over-long token (a URL, usually) into pieces that each fit. */
function hardBreak(token, maxWidth, measure) {
  const pieces = [];
  let buffer = '';
  for (const ch of token.text) {
    const candidate = buffer + ch;
    if (buffer && measure({ ...token, text: candidate }) > maxWidth) {
      pieces.push({ ...token, text: buffer });
      buffer = ch;
    } else {
      buffer = candidate;
    }
  }
  if (buffer) pieces.push({ ...token, text: buffer });
  return pieces;
}

/**
 * Greedy line breaking. Returns an array of lines, each an array of tokens.
 * Trailing spaces are trimmed from a line before it is measured, so a line whose
 * only overflow is a trailing space still fits.
 */
export function wrapTokens(tokens, maxWidth, measure) {
  const lines = [];
  let line = [];
  let width = 0;

  const trimTrailingSpaces = (arr) => {
    while (arr.length && arr[arr.length - 1].space) arr.pop();
    return arr;
  };

  const pushLine = () => {
    lines.push(trimTrailingSpaces(line));
    line = [];
    width = 0;
  };

  for (const token of tokens) {
    if (token.newline) { pushLine(); continue; }

    if (token.space) {
      if (line.length === 0) continue; // never start a line with a space
      line.push(token);
      width += measure(token);
      continue;
    }

    let w = measure(token);

    if (w > maxWidth) {
      if (line.length) pushLine();
      const pieces = hardBreak(token, maxWidth, measure);
      for (let i = 0; i < pieces.length; i++) {
        line = [pieces[i]];
        width = measure(pieces[i]);
        if (i < pieces.length - 1) pushLine();
      }
      continue;
    }

    if (width + w > maxWidth && line.length) {
      // Pull back the trailing space that would have preceded this word.
      trimTrailingSpaces(line);
      pushLine();
    }

    line.push(token);
    width += w;
  }

  if (line.length) pushLine();
  return lines;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Reload. Expected: `PASS 61/61`.

- [ ] **Step 5: Commit**

```bash
git add shared/pdf/measure.js shared/pdf/measure.test.js batesstamp/email-to-pdf/tests.html
git commit -m "feat(email-to-pdf): tokenizing and greedy line breaking with hard-break fallback"
```

---

## Task 10: PageWriter

The cursor, the pagination, the footers, the links. Everything that knows about pages but nothing that knows about email.

**Files:**
- Create: `shared/pdf/writer.js`
- Create: `shared/pdf/writer.test.js`
- Modify: `batesstamp/email-to-pdf/tests.html`

**Interfaces:**
- Consumes: `FontSet` (Task 8), `tokenizeRuns`/`wrapTokens` (Task 9), a `Theme` object (Task 11).
- Produces: `class PageWriter` with:
  - `new PageWriter({pdfDoc, theme, fontSet, footerLeft})`
  - `.contentWidth`, `.y`, `.page`, `.pageCount`
  - `.newPage()`, `.ensure(height)`, `.moveDown(dy)`
  - `.measureToken(token, size)`, `.lineHeight(size)`
  - `.drawLine(tokens, {x, size, color, underlineLinks})`
  - `.drawRule({x, width, color, thickness})`, `.drawRect({x, y, width, height, color})`
  - `.linkTo(url, rect)`, `.markDestination(name)`, `.linkToDestination(name, rect)`
  - `cssToRgb(value: string) => [r,g,b] | null` (module-level export)
  - `.finalize()` — stamps every page's footer with the final page count and attaches annotations

**Theme contract** (implemented in Task 11, depended on here). Colors are `[r, g, b]` with components 0–1 so themes never import pdf-lib:

```js
{
  id: 'mail-client', name: 'Mail client', family: 'sans',
  page: { width: 612, height: 792, margin: { top: 54, right: 54, bottom: 64, left: 54 } },
  size: { body: 10.5, small: 8.5, footer: 7.5, mono: 8, h1: 17, h2: 15, h3: 13, h4: 12, h5: 11, h6: 10.5 },
  leading: 1.38,
  color: { text: [0.1,0.1,0.12], muted: [0.42,0.44,0.48], rule: [0.85,0.86,0.88],
           quoteBar: [0.78,0.80,0.84], link: [0.11,0.29,0.55], band: [0.96,0.97,0.98],
           bandText: [0.12,0.16,0.24] },
  spacing: { paragraph: 6, block: 10, listIndent: 18, quoteIndent: 14, quoteBarGap: 8 },
  drawHeaderBlock(writer, record) { /* Task 11 */ }
}
```

- [ ] **Step 1: Write the failing tests**

```js
// shared/pdf/writer.test.js
import { test, assert, assertEqual, assertDeepEqual } from '/shared/testing/harness.js';
import { loadFontSet } from './fonts.js';
import { PageWriter, cssToRgb } from './writer.js';
import { tokenizeRuns } from './measure.js';
import { THEMES } from '/shared/eml/themes.js';

async function newWriter() {
  const pdfDoc = await PDFLib.PDFDocument.create();
  const theme = THEMES['mail-client'];
  const fontSet = await loadFontSet(pdfDoc, { family: theme.family });
  return { pdfDoc, writer: new PageWriter({ pdfDoc, theme, fontSet, footerLeft: 'test.eml · abc123def456' }) };
}

const style = { bold: false, italic: false, color: null, sizeScale: 1, href: null };

test('starts with one page and a cursor below the top margin', async () => {
  const { writer } = await newWriter();
  assertEqual(writer.pageCount, 1);
  assert(writer.y < 792 - 50, 'cursor starts inside the top margin');
});

test('contentWidth is the page minus both side margins', async () => {
  const { writer } = await newWriter();
  assertEqual(writer.contentWidth, 612 - 54 - 54);
});

test('ensure() adds a page when the requested height does not fit', async () => {
  const { writer } = await newWriter();
  writer.moveDown(650);
  writer.ensure(120);
  assertEqual(writer.pageCount, 2);
});

test('ensure() does not add a page when the height fits', async () => {
  const { writer } = await newWriter();
  writer.ensure(40);
  assertEqual(writer.pageCount, 1);
});

test('drawLine advances the cursor by the line height', async () => {
  const { writer } = await newWriter();
  const before = writer.y;
  const toks = tokenizeRuns([{ text: 'Hello there', ...style }]);
  writer.drawLine(toks, { x: 54, size: 10.5 });
  assertEqual(Math.round(before - writer.y), Math.round(writer.lineHeight(10.5)));
});

test('measureToken returns a positive width that scales with size', async () => {
  const { writer } = await newWriter();
  const tok = { text: 'Hello', space: false, newline: false, style };
  const small = writer.measureToken(tok, 8);
  const large = writer.measureToken(tok, 16);
  assert(small > 0, 'positive width');
  assert(large > small, 'width scales with font size');
});

test('cssToRgb handles hex, rgb() and named colours, and rejects the rest', () => {
  assertDeepEqual(cssToRgb('#ff0000'), [1, 0, 0]);
  assertDeepEqual(cssToRgb('#f00'), [1, 0, 0]);
  assertDeepEqual(cssToRgb('rgb(0, 0, 255)'), [0, 0, 1]);
  assertDeepEqual(cssToRgb('black'), [0, 0, 0]);
  assertEqual(cssToRgb('hsl(20 100% 50%)'), null);
  assertEqual(cssToRgb(''), null);
});

test('finalize stamps a footer on every page and produces a loadable PDF', async () => {
  const { pdfDoc, writer } = await newWriter();
  writer.newPage();
  writer.newPage();
  writer.finalize();
  assertEqual(writer.pageCount, 3);
  const bytes = await pdfDoc.save();
  const reloaded = await PDFLib.PDFDocument.load(bytes);
  assertEqual(reloaded.getPageCount(), 3);
});

test('link annotations survive a save/load round trip', async () => {
  const { pdfDoc, writer } = await newWriter();
  writer.linkTo('https://example.test/x', { x: 54, y: 700, width: 100, height: 12 });
  writer.finalize();
  const bytes = await pdfDoc.save();
  const text = new TextDecoder().decode(bytes);
  assert(text.includes('example.test'), 'URI action written into the file');
});
```

- [ ] **Step 2: Register and run to verify failure**

Add `await import('/shared/pdf/writer.test.js');` to `tests.html`. Expect 404s for both `/shared/pdf/writer.js` and `/shared/eml/themes.js` — Task 11 supplies the second, and these two tasks are verified together at the end of Task 11.

- [ ] **Step 3: Write the implementation**

```js
// shared/pdf/writer.js
// Page cursor, pagination, footers and annotations. Knows about pages; knows
// nothing about email.
//
// Footers are stamped in finalize() rather than as each page is created, because
// "page 3 of 17" cannot be written until the seventeenth page exists.

const { rgb, PDFName, PDFString, PDFArray } = PDFLib;

const NAMED_COLORS = {
  black: [0, 0, 0], white: [1, 1, 1], red: [0.8, 0.1, 0.1], green: [0.1, 0.5, 0.2],
  blue: [0.1, 0.2, 0.7], gray: [0.5, 0.5, 0.5], grey: [0.5, 0.5, 0.5],
  navy: [0.05, 0.1, 0.4], maroon: [0.5, 0.1, 0.1], silver: [0.75, 0.75, 0.75]
};

/**
 * Convert a CSS colour from an email's style attribute into an rgb triple.
 * Runs carry `color` as whatever string the sender's mail client wrote, so the
 * conversion belongs here rather than in the pure block-IR layer. Anything
 * unrecognised returns null and the caller falls back to the theme's text
 * colour — an unreadable colour is worse than an unfaithful one.
 */
export function cssToRgb(value) {
  if (!value) return null;
  const str = String(value).trim().toLowerCase();

  if (NAMED_COLORS[str]) return NAMED_COLORS[str];

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(str);
  if (hex) {
    const h = hex[1].length === 3
      ? hex[1].split('').map((c) => c + c).join('')
      : hex[1];
    return [
      parseInt(h.slice(0, 2), 16) / 255,
      parseInt(h.slice(2, 4), 16) / 255,
      parseInt(h.slice(4, 6), 16) / 255
    ];
  }

  const fn = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(str);
  if (fn) {
    return [
      Math.min(255, parseInt(fn[1], 10)) / 255,
      Math.min(255, parseInt(fn[2], 10)) / 255,
      Math.min(255, parseInt(fn[3], 10)) / 255
    ];
  }

  return null;
}

export class PageWriter {
  constructor({ pdfDoc, theme, fontSet, footerLeft }) {
    this.pdfDoc = pdfDoc;
    this.theme = theme;
    this.fontSet = fontSet;
    this.footerLeft = footerLeft || '';
    this.pages = [];
    this.annots = new Map();      // page index -> array of annotation refs
    this.destinations = new Map(); // name -> {pageIndex, y}
    this.page = null;
    this.y = 0;
    this.newPage();
  }

  get pageCount() { return this.pages.length; }

  get contentWidth() {
    const m = this.theme.page.margin;
    return this.theme.page.width - m.left - m.right;
  }

  get left() { return this.theme.page.margin.left; }

  newPage() {
    this.page = this.pdfDoc.addPage([this.theme.page.width, this.theme.page.height]);
    this.pages.push(this.page);
    this.y = this.theme.page.height - this.theme.page.margin.top;
    return this.page;
  }

  get bottomLimit() { return this.theme.page.margin.bottom; }

  /** Start a new page if `height` will not fit below the cursor. */
  ensure(height) {
    if (this.y - height < this.bottomLimit) this.newPage();
    return this.page;
  }

  moveDown(dy) { this.y -= dy; }

  lineHeight(size) { return size * this.theme.leading; }

  measureToken(token, size) {
    const scale = (token.style && token.style.sizeScale) || 1;
    const effective = size * scale;
    const faceKey = this.fontSet.faceFor(token.style || {});
    let width = 0;
    for (const seg of this.fontSet.segment(token.text, faceKey)) {
      width += this.fontSet.font(seg.faceKey).widthOfTextAtSize(seg.text, effective);
    }
    return width;
  }

  /**
   * Draw one already-wrapped line of tokens. Returns the height consumed.
   * Link runs are drawn in the link colour and underlined, and get a clickable
   * annotation covering exactly the drawn extent.
   */
  drawLine(tokens, opts = {}) {
    const size = opts.size || this.theme.size.body;
    const x0 = opts.x != null ? opts.x : this.left;
    const baseColor = opts.color || this.theme.color.text;
    const height = this.lineHeight(size);

    this.ensure(height);
    const baseline = this.y - size;
    let x = x0;

    for (const token of tokens) {
      const style = token.style || {};
      const scale = style.sizeScale || 1;
      const effective = size * scale;
      const faceKey = this.fontSet.faceFor(style);
      const isLink = !!style.href;
      const colorArr = isLink
        ? this.theme.color.link
        : (cssToRgb(style.color) || baseColor);
      const tokenStartX = x;

      for (const seg of this.fontSet.segment(token.text, faceKey)) {
        const font = this.fontSet.font(seg.faceKey);
        this.page.drawText(seg.text, {
          x, y: baseline, size: effective, font,
          color: rgb(colorArr[0], colorArr[1], colorArr[2])
        });
        x += font.widthOfTextAtSize(seg.text, effective);
      }

      if (isLink && x > tokenStartX) {
        this.page.drawLine({
          start: { x: tokenStartX, y: baseline - 1.5 },
          end: { x, y: baseline - 1.5 },
          thickness: 0.5,
          color: rgb(colorArr[0], colorArr[1], colorArr[2])
        });
        this.linkTo(style.href, {
          x: tokenStartX, y: baseline - 2,
          width: x - tokenStartX, height: effective + 3
        });
      }

      if (style.underline && !isLink && x > tokenStartX) {
        this.page.drawLine({
          start: { x: tokenStartX, y: baseline - 1.5 },
          end: { x, y: baseline - 1.5 },
          thickness: 0.5,
          color: rgb(colorArr[0], colorArr[1], colorArr[2])
        });
      }

      if (style.strike && x > tokenStartX) {
        this.page.drawLine({
          start: { x: tokenStartX, y: baseline + effective * 0.28 },
          end: { x, y: baseline + effective * 0.28 },
          thickness: 0.5,
          color: rgb(colorArr[0], colorArr[1], colorArr[2])
        });
      }
    }

    this.y -= height;
    return height;
  }

  drawRule({ x, width, color, thickness } = {}) {
    const c = color || this.theme.color.rule;
    this.ensure(4);
    this.page.drawLine({
      start: { x: x != null ? x : this.left, y: this.y },
      end: { x: (x != null ? x : this.left) + (width || this.contentWidth), y: this.y },
      thickness: thickness || 0.5,
      color: rgb(c[0], c[1], c[2])
    });
  }

  drawRect({ x, y, width, height, color }) {
    const c = color || this.theme.color.band;
    this.page.drawRectangle({
      x, y, width, height, color: rgb(c[0], c[1], c[2])
    });
  }

  _annotsFor(pageIndex) {
    if (!this.annots.has(pageIndex)) this.annots.set(pageIndex, []);
    return this.annots.get(pageIndex);
  }

  linkTo(url, rect) {
    const ref = this.pdfDoc.context.register(
      this.pdfDoc.context.obj({
        Type: 'Annot',
        Subtype: 'Link',
        Rect: [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height],
        Border: [0, 0, 0],
        A: this.pdfDoc.context.obj({ Type: 'Action', S: 'URI', URI: PDFString.of(url) })
      })
    );
    this._annotsFor(this.pages.length - 1).push(ref);
  }

  /** Record the current position as a named target for a table-of-contents link. */
  markDestination(name) {
    this.destinations.set(name, { pageIndex: this.pages.length - 1, y: this.y });
  }

  linkToDestination(name, rect) {
    const target = this.destinations.get(name);
    if (!target) return; // destination not yet written; caller orders TOC last
    const ref = this.pdfDoc.context.register(
      this.pdfDoc.context.obj({
        Type: 'Annot',
        Subtype: 'Link',
        Rect: [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height],
        Border: [0, 0, 0],
        Dest: [this.pages[target.pageIndex].ref, PDFName.of('XYZ'), 0, target.y, null]
      })
    );
    this._annotsFor(this.pages.length - 1).push(ref);
  }

  /**
   * Stamp footers and attach annotations. Call exactly once, after all content.
   *
   * Footers go on every page, including pages copied in from an attached PDF.
   * That is deliberate: continuous "page n of N" numbering across the whole
   * exhibit is what lets a single loose page be placed back in the document. The
   * cost is that a footer may overprint content sitting in an attachment page's
   * bottom margin. Task 18's checklist looks for this on the 6 MB PDF fixture.
   */
  finalize() {
    const total = this.pages.length;
    const size = this.theme.size.footer;
    const font = this.fontSet.font('regular');
    const c = this.theme.color.muted;

    this.pages.forEach((page, i) => {
      const y = this.theme.page.margin.bottom * 0.55;
      page.drawText(this.footerLeft, {
        x: this.left, y, size, font, color: rgb(c[0], c[1], c[2])
      });
      const right = 'page ' + (i + 1) + ' of ' + total;
      const w = font.widthOfTextAtSize(right, size);
      page.drawText(right, {
        x: this.theme.page.width - this.theme.page.margin.right - w,
        y, size, font, color: rgb(c[0], c[1], c[2])
      });

      const refs = this.annots.get(i);
      if (refs && refs.length) {
        const arr = PDFArray.withContext(this.pdfDoc.context);
        for (const ref of refs) arr.push(ref);
        page.node.set(PDFName.of('Annots'), arr);
      }
    });
  }
}
```

- [ ] **Step 4: Commit (tests run at the end of Task 11)**

```bash
git add shared/pdf/writer.js shared/pdf/writer.test.js batesstamp/email-to-pdf/tests.html
git commit -m "feat(email-to-pdf): PageWriter with pagination, footers and link annotations"
```

---

## Task 11: Themes

**Files:**
- Create: `shared/eml/themes.js`
- Create: `shared/eml/themes.test.js`
- Modify: `batesstamp/email-to-pdf/tests.html`

**Interfaces:**
- Consumes: `PageWriter` (Task 10).
- Produces: `THEMES` — an object keyed `'mail-client'`, `'exhibit'`, `'minimal'`, each matching the Theme contract in Task 10, and `THEME_ORDER` (array of keys, default first).

- [ ] **Step 1: Write the failing tests**

```js
// shared/eml/themes.test.js
import { test, assert, assertEqual } from '/shared/testing/harness.js';
import { THEMES, THEME_ORDER } from './themes.js';

test('three themes, mail-client first', () => {
  assertEqual(THEME_ORDER.length, 3);
  assertEqual(THEME_ORDER[0], 'mail-client');
  for (const key of THEME_ORDER) assert(THEMES[key], 'theme ' + key + ' exists');
});

test('every theme defines the full contract', () => {
  for (const key of THEME_ORDER) {
    const t = THEMES[key];
    assertEqual(t.id, key);
    assert(t.page.width > 0 && t.page.height > 0, key + ' page size');
    assert(t.page.margin.top > 0, key + ' margins');
    assert(t.size.body > 0 && t.size.footer > 0 && t.size.mono > 0, key + ' sizes');
    assert(t.leading > 1, key + ' leading');
    for (const c of ['text', 'muted', 'rule', 'quoteBar', 'link', 'band', 'bandText']) {
      assert(Array.isArray(t.color[c]) && t.color[c].length === 3, key + ' color ' + c);
    }
    assert(typeof t.drawHeaderBlock === 'function', key + ' header renderer');
    assert(t.family === 'sans' || t.family === 'serif', key + ' family');
  }
});

test('colour components are all in 0..1, not 0..255', () => {
  for (const key of THEME_ORDER) {
    for (const arr of Object.values(THEMES[key].color)) {
      for (const v of arr) assert(v >= 0 && v <= 1, key + ' component out of range: ' + v);
    }
  }
});

test('US Letter portrait for every theme', () => {
  for (const key of THEME_ORDER) {
    assertEqual(THEMES[key].page.width, 612);
    assertEqual(THEMES[key].page.height, 792);
  }
});
```

- [ ] **Step 2: Register and run to verify failure**

Add `await import('/shared/eml/themes.test.js');` to `tests.html`; expect the 404.

- [ ] **Step 3: Write the implementation**

```js
// shared/eml/themes.js
// Three presentations of the same content. A theme owns the type system, the
// colour set, and the header block; it owns nothing structural, so the manifest,
// appendix and certificate look the same in all three.

import { tokenizeRuns, wrapTokens } from '/shared/pdf/measure.js';

const LETTER = { width: 612, height: 792 };

function run(text, extra) {
  return Object.assign({
    text, bold: false, italic: false, underline: false, strike: false,
    color: null, sizeScale: 1, href: null
  }, extra || {});
}

function addressLine(list) {
  return (list || [])
    .map((a) => (a.name ? a.name + ' <' + a.address + '>' : a.address))
    .join(', ');
}

/** Wrap and draw a single logical line of runs, paginating if it is long. */
function drawWrapped(writer, runs, { x, size, color, indent }) {
  const startX = x != null ? x : writer.left;
  const width = writer.contentWidth - (startX - writer.left) - (indent || 0);
  const tokens = tokenizeRuns(runs);
  const lines = wrapTokens(tokens, width, (t) => writer.measureToken(t, size));
  for (const line of lines) {
    writer.drawLine(line, { x: startX, size, color });
  }
  if (!lines.length) writer.moveDown(writer.lineHeight(size));
}

// ---------------------------------------------------------------------------
// mail-client — echoes how the message looked on screen
// ---------------------------------------------------------------------------

function drawMailClientHeader(writer, record) {
  const t = writer.theme;
  const bandLeft = t.page.margin.left - 12;
  const bandWidth = writer.contentWidth + 24;

  // Estimate the band's height before drawing it: the tint has to be painted
  // first so the text sits on top, but it must be as tall as the text it holds.
  const subject = record.subject || '(no subject)';
  const fromName = record.from ? (record.from.name || record.from.address) : '(unknown sender)';
  const fromAddr = record.from ? record.from.address : '';
  const toLine = 'to ' + (addressLine(record.to) || '(undisclosed recipients)');
  const ccLine = record.cc.length ? 'cc ' + addressLine(record.cc) : null;
  const lineCount = 3 + (ccLine ? 1 : 0);
  const estimate = t.size.h2 * t.leading + lineCount * t.size.small * t.leading + 26;

  writer.ensure(estimate + 20);
  writer.drawRect({
    x: bandLeft, y: writer.y + 14 - estimate, width: bandWidth, height: estimate,
    color: t.color.band
  });

  writer.moveDown(4);
  drawWrapped(writer, [run(subject, { bold: true })],
    { size: t.size.h2, color: t.color.bandText });
  writer.moveDown(4);
  drawWrapped(writer, [run(fromName, { bold: true })],
    { size: t.size.body, color: t.color.bandText });
  if (fromAddr && fromAddr !== fromName) {
    drawWrapped(writer, [run(fromAddr)], { size: t.size.small, color: t.color.muted });
  }
  drawWrapped(writer, [run(toLine)], { size: t.size.small, color: t.color.muted });
  if (ccLine) drawWrapped(writer, [run(ccLine)], { size: t.size.small, color: t.color.muted });
  // The date prints exactly as received, offset intact — never localised.
  drawWrapped(writer, [run(record.date.raw || '(no date header)')],
    { size: t.size.small, color: t.color.muted });
  writer.moveDown(16);
}

// ---------------------------------------------------------------------------
// exhibit — formal, ruled, photocopies cleanly
// ---------------------------------------------------------------------------

function drawExhibitHeader(writer, record) {
  const t = writer.theme;
  writer.ensure(150);

  drawWrapped(writer, [run('ELECTRONIC MAIL RECORD', { bold: true })],
    { size: t.size.h3, color: t.color.text });
  writer.moveDown(6);
  writer.drawRule({ thickness: 1 });
  writer.moveDown(10);

  const fields = [
    ['FROM', record.from ? addressLine([record.from]) : '(unknown sender)'],
    ['TO', addressLine(record.to) || '(undisclosed recipients)']
  ];
  if (record.cc.length) fields.push(['CC', addressLine(record.cc)]);
  if (record.bcc.length) fields.push(['BCC', addressLine(record.bcc)]);
  fields.push(['DATE', record.date.raw || '(no date header)']);
  fields.push(['SUBJECT', record.subject || '(no subject)']);
  if (record.messageId) fields.push(['MESSAGE-ID', record.messageId]);

  const labelWidth = 78;
  for (const [label, value] of fields) {
    const before = writer.y;
    drawWrapped(writer, [run(value)],
      { x: writer.left + labelWidth, size: t.size.body, color: t.color.text });
    // Draw the label after the value so it aligns with the value's first line.
    writer.page.drawText(label, {
      x: writer.left,
      y: before - t.size.body,
      size: t.size.small,
      font: writer.fontSet.font('bold'),
      color: PDFLib.rgb(t.color.muted[0], t.color.muted[1], t.color.muted[2])
    });
    writer.moveDown(3);
    writer.drawRule({ color: t.color.rule, thickness: 0.4 });
    writer.moveDown(7);
  }
  writer.moveDown(8);
}

// ---------------------------------------------------------------------------
// minimal — typography and whitespace only
// ---------------------------------------------------------------------------

function drawMinimalHeader(writer, record) {
  const t = writer.theme;
  writer.ensure(130);

  const fields = [
    ['from', record.from ? addressLine([record.from]) : '(unknown sender)'],
    ['to', addressLine(record.to) || '(undisclosed recipients)']
  ];
  if (record.cc.length) fields.push(['cc', addressLine(record.cc)]);
  fields.push(['date', record.date.raw || '(no date header)']);

  const labelWidth = 52;
  for (const [label, value] of fields) {
    const before = writer.y;
    drawWrapped(writer, [run(value)],
      { x: writer.left + labelWidth, size: t.size.body, color: t.color.text });
    writer.page.drawText(label, {
      x: writer.left,
      y: before - t.size.body,
      size: t.size.small,
      font: writer.fontSet.font('regular'),
      color: PDFLib.rgb(t.color.muted[0], t.color.muted[1], t.color.muted[2])
    });
    writer.moveDown(5);
  }

  writer.moveDown(12);
  drawWrapped(writer, [run(record.subject || '(no subject)', { bold: true })],
    { size: t.size.h3, color: t.color.text });
  writer.moveDown(4);
  writer.drawRule({ width: writer.contentWidth * 0.35 });
  writer.moveDown(16);
}

export const THEMES = {
  'mail-client': {
    id: 'mail-client',
    name: 'Mail client',
    description: 'Reads like the message did on screen',
    family: 'sans',
    page: { ...LETTER, margin: { top: 54, right: 54, bottom: 64, left: 54 } },
    size: { body: 10.5, small: 8.5, footer: 7.5, mono: 8,
            h1: 17, h2: 15, h3: 13, h4: 12, h5: 11, h6: 10.5 },
    leading: 1.38,
    color: {
      text: [0.10, 0.10, 0.12], muted: [0.42, 0.44, 0.48], rule: [0.85, 0.86, 0.88],
      quoteBar: [0.78, 0.80, 0.84], link: [0.11, 0.29, 0.55],
      band: [0.96, 0.97, 0.98], bandText: [0.12, 0.16, 0.24]
    },
    spacing: { paragraph: 6, block: 10, listIndent: 18, quoteIndent: 14, quoteBarGap: 8 },
    drawHeaderBlock: drawMailClientHeader
  },

  exhibit: {
    id: 'exhibit',
    name: 'Court exhibit',
    description: 'Formal, ruled, photocopies cleanly',
    family: 'serif',
    page: { ...LETTER, margin: { top: 64, right: 68, bottom: 70, left: 68 } },
    size: { body: 10.5, small: 8, footer: 7.5, mono: 8,
            h1: 16, h2: 14, h3: 12.5, h4: 11.5, h5: 11, h6: 10.5 },
    leading: 1.45,
    color: {
      text: [0.07, 0.07, 0.09], muted: [0.38, 0.40, 0.44], rule: [0.55, 0.57, 0.60],
      quoteBar: [0.62, 0.64, 0.68], link: [0.10, 0.22, 0.42],
      band: [1, 1, 1], bandText: [0.07, 0.07, 0.09]
    },
    spacing: { paragraph: 7, block: 12, listIndent: 20, quoteIndent: 16, quoteBarGap: 9 },
    drawHeaderBlock: drawExhibitHeader
  },

  minimal: {
    id: 'minimal',
    name: 'Minimal',
    description: 'Typography and whitespace, no rules or bands',
    family: 'sans',
    page: { ...LETTER, margin: { top: 72, right: 80, bottom: 72, left: 80 } },
    size: { body: 10, small: 8, footer: 7, mono: 8,
            h1: 16, h2: 14, h3: 12, h4: 11, h5: 10.5, h6: 10 },
    leading: 1.5,
    color: {
      text: [0.13, 0.13, 0.14], muted: [0.55, 0.56, 0.58], rule: [0.80, 0.81, 0.83],
      quoteBar: [0.84, 0.85, 0.87], link: [0.20, 0.30, 0.45],
      band: [1, 1, 1], bandText: [0.13, 0.13, 0.14]
    },
    spacing: { paragraph: 8, block: 14, listIndent: 20, quoteIndent: 18, quoteBarGap: 10 },
    drawHeaderBlock: drawMinimalHeader
  }
};

export const THEME_ORDER = ['mail-client', 'exhibit', 'minimal'];
```

- [ ] **Step 4: Run the tests to verify Tasks 10 and 11 both pass**

Reload. Expected: `PASS 74/74` — the four theme tests plus the nine writer tests that were blocked on `themes.js`.

- [ ] **Step 5: Commit**

```bash
git add shared/eml/themes.js shared/eml/themes.test.js batesstamp/email-to-pdf/tests.html
git commit -m "feat(email-to-pdf): three output themes with their header-block renderers"
```

---

## Task 12: Drawing the block IR

**Files:**
- Create: `shared/pdf/draw-blocks.js`
- Create: `shared/pdf/draw-blocks.test.js`
- Modify: `batesstamp/email-to-pdf/tests.html`

**Interfaces:**
- Consumes: `PageWriter`, `tokenizeRuns`, `wrapTokens`, a theme, and an image resolver.
- Produces: `drawBlocks(writer, blocks, ctx) => Promise<void>` where
  `ctx = {indent: number, quoteDepth: number, images: Map<string, Attachment>, embedCache: Map}`.

Assertions here are structural — page counts, "does it terminate", "does content survive" — because pixel positions are not meaningfully assertable without rendering. Visual correctness is Task 18's checklist. What these tests *do* catch is the class of bug that actually bites: infinite loops, content silently dropped, and pagination that never advances.

- [ ] **Step 1: Write the failing tests**

```js
// shared/pdf/draw-blocks.test.js
import { test, assert, assertEqual } from '/shared/testing/harness.js';
import { loadFontSet } from './fonts.js';
import { PageWriter } from './writer.js';
import { drawBlocks } from './draw-blocks.js';
import { THEMES } from '/shared/eml/themes.js';
import { loadFixture } from '/shared/testing/fixtures.js';
import { parseEml } from '/shared/eml/parse.js';
import { sanitizeHtml } from '/shared/eml/sanitize.js';
import { htmlToBlocks } from '/shared/eml/html-to-blocks.js';

async function harness(themeKey = 'mail-client') {
  const pdfDoc = await PDFLib.PDFDocument.create();
  const theme = THEMES[themeKey];
  const fontSet = await loadFontSet(pdfDoc, { family: theme.family });
  const writer = new PageWriter({ pdfDoc, theme, fontSet, footerLeft: 'x.eml · abc' });
  return { pdfDoc, writer, ctx: { indent: 0, quoteDepth: 0, images: new Map(), embedCache: new Map() } };
}

const p = (text) => ({
  type: 'paragraph',
  runs: [{ text, bold: false, italic: false, underline: false, strike: false,
           color: null, sizeScale: 1, href: null }]
});

test('a short paragraph fits on one page', async () => {
  const { writer, ctx } = await harness();
  await drawBlocks(writer, [p('Hello there')], ctx);
  assertEqual(writer.pageCount, 1);
});

test('long content paginates rather than overflowing', async () => {
  const { writer, ctx } = await harness();
  const many = [];
  for (let i = 0; i < 120; i++) many.push(p('Paragraph number ' + i + ' of the body text.'));
  await drawBlocks(writer, many, ctx);
  assert(writer.pageCount > 1, 'paginated');
  assert(writer.pageCount < 40, 'did not run away: ' + writer.pageCount);
});

test('a table taller than a page splits and repeats its header row', async () => {
  const { writer, ctx } = await harness();
  const rows = [[{ blocks: [p('Invoice')], colspan: 1, rowspan: 1, header: true },
                 { blocks: [p('Amount')], colspan: 1, rowspan: 1, header: true }]];
  for (let i = 0; i < 90; i++) {
    rows.push([
      { blocks: [p('INV-' + (1000 + i))], colspan: 1, rowspan: 1, header: false },
      { blocks: [p('$' + (i * 37) + '.00')], colspan: 1, rowspan: 1, header: false }
    ]);
  }
  await drawBlocks(writer, [{ type: 'table', rows }], ctx);
  assert(writer.pageCount > 1, 'table split across pages');
});

test('a single cell taller than the page does not overprint the next row', async () => {
  const { writer, ctx } = await harness();
  const tall = [];
  for (let i = 0; i < 80; i++) tall.push(p('Overflowing cell line ' + i));
  const rows = [
    [{ blocks: tall, colspan: 1, rowspan: 1, header: false },
     { blocks: [p('short')], colspan: 1, rowspan: 1, header: false }],
    [{ blocks: [p('next row')], colspan: 1, rowspan: 1, header: false },
     { blocks: [p('next row b')], colspan: 1, rowspan: 1, header: false }]
  ];
  await drawBlocks(writer, [{ type: 'table', rows }], ctx);
  // The cursor must end on the page it is actually drawing on, below the top
  // margin — not restored to a y captured before the overflow.
  assert(writer.y <= 792 - writer.theme.page.margin.top, 'cursor is on the live page');
  assert(writer.y > 0, 'cursor did not run off the bottom of the page');
});

test('nested blockquotes terminate and consume vertical space', async () => {
  const { writer, ctx } = await harness();
  const deep = { type: 'blockquote', depth: 1, children: [
    p('level one'),
    { type: 'blockquote', depth: 2, children: [
      p('level two'),
      { type: 'blockquote', depth: 3, children: [p('level three')] }
    ] }
  ] };
  const before = writer.y;
  await drawBlocks(writer, [deep], ctx);
  assert(writer.y < before, 'cursor advanced');
});

test('a blocked image draws a visible labeled placeholder, not a gap', async () => {
  const { writer, ctx } = await harness();
  const before = writer.y;
  await drawBlocks(writer, [{ type: 'blockedImage', reason: 'remote', alt: 'Banner' }], ctx);
  assert(before - writer.y > 10, 'placeholder occupies real space');
});

test('an empty block list is a no-op', async () => {
  const { writer, ctx } = await harness();
  const before = writer.y;
  await drawBlocks(writer, [], ctx);
  assertEqual(writer.y, before);
  assertEqual(writer.pageCount, 1);
});

test('the Outlook fixture renders to a saveable PDF in every theme', async () => {
  const rec = await parseEml(await loadFixture('08-outlook-tables.eml'));
  for (const key of ['mail-client', 'exhibit', 'minimal']) {
    const { pdfDoc, writer, ctx } = await harness(key);
    const { body } = sanitizeHtml(rec.bodyHtml, rec.inlineImages);
    await drawBlocks(writer, htmlToBlocks(body), ctx);
    writer.finalize();
    const bytes = await pdfDoc.save();
    assert(bytes.length > 1000, key + ' produced a real PDF');
  }
});
```

- [ ] **Step 2: Register and run to verify failure**

Add `await import('/shared/pdf/draw-blocks.test.js');` to `tests.html`; expect the 404.

- [ ] **Step 3: Write the implementation**

```js
// shared/pdf/draw-blocks.js
// Block IR -> drawing calls. The only module that knows both the IR and the page.

import { tokenizeRuns, wrapTokens } from './measure.js';

const BULLETS = ['•', '◦', '▪'];

function sizeForHeading(theme, level) {
  return theme.size['h' + Math.min(6, Math.max(1, level))] || theme.size.body;
}

function drawRuns(writer, runs, { x, width, size, color, bold }) {
  const effective = bold
    ? runs.map((r) => Object.assign({}, r, { bold: true }))
    : runs;
  const lines = wrapTokens(
    tokenizeRuns(effective), width, (t) => writer.measureToken(t, size)
  );
  for (const line of lines) writer.drawLine(line, { x, size, color });
  if (!lines.length) writer.moveDown(writer.lineHeight(size));
  return lines.length;
}

async function embedImage(writer, ref, ctx) {
  const key = ref.kind === 'cid' ? 'cid:' + ref.contentId : ref.url;
  if (ctx.embedCache.has(key)) return ctx.embedCache.get(key);

  let bytes = null;
  let mime = '';

  if (ref.kind === 'cid') {
    const att = ctx.images.get(ref.contentId);
    if (!att) return null;
    bytes = att.bytes;
    mime = att.mimeType;
  } else {
    const match = /^data:([^;,]+)[^,]*,(.*)$/i.exec(ref.url || '');
    if (!match) return null;
    mime = match[1];
    try {
      const bin = atob(match[2]);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } catch (err) {
      return null;
    }
  }

  let embedded = null;
  try {
    if (/png/i.test(mime)) embedded = await writer.pdfDoc.embedPng(bytes);
    else if (/jpe?g/i.test(mime)) embedded = await writer.pdfDoc.embedJpg(bytes);
  } catch (err) {
    embedded = null; // unsupported or corrupt; caller draws a placeholder
  }

  ctx.embedCache.set(key, embedded);
  return embedded;
}

function drawPlaceholder(writer, label) {
  const t = writer.theme;
  const height = 30;
  writer.ensure(height + 6);
  const top = writer.y;
  writer.page.drawRectangle({
    x: writer.left, y: top - height, width: Math.min(260, writer.contentWidth),
    height, borderWidth: 0.5,
    borderColor: PDFLib.rgb(t.color.rule[0], t.color.rule[1], t.color.rule[2]),
    color: PDFLib.rgb(1, 1, 1)
  });
  writer.page.drawText(label, {
    x: writer.left + 8, y: top - height / 2 - t.size.small / 2 + 1,
    size: t.size.small, font: writer.fontSet.font('italic'),
    color: PDFLib.rgb(t.color.muted[0], t.color.muted[1], t.color.muted[2])
  });
  writer.moveDown(height + 6);
}

/**
 * @param {PageWriter} writer
 * @param {Array<Object>} blocks
 * @param {{indent: number, quoteDepth: number, images: Map, embedCache: Map}} ctx
 */
export async function drawBlocks(writer, blocks, ctx) {
  const t = writer.theme;
  const x = writer.left + (ctx.indent || 0);
  const width = writer.contentWidth - (ctx.indent || 0);

  for (const block of blocks || []) {
    switch (block.type) {
      case 'paragraph':
        drawRuns(writer, block.runs, { x, width, size: t.size.body, color: t.color.text });
        writer.moveDown(t.spacing.paragraph);
        break;

      case 'heading': {
        const size = sizeForHeading(t, block.level);
        writer.ensure(writer.lineHeight(size) + t.spacing.block);
        drawRuns(writer, block.runs, { x, width, size, color: t.color.text, bold: true });
        writer.moveDown(t.spacing.paragraph);
        break;
      }

      case 'rule':
        writer.moveDown(t.spacing.paragraph);
        writer.drawRule({ x, width });
        writer.moveDown(t.spacing.block);
        break;

      case 'preformatted': {
        const lines = String(block.text).replace(/\r\n/g, '\n').split('\n');
        for (const line of lines) {
          const runs = [{ text: line || ' ', bold: false, italic: false, underline: false,
                          strike: false, color: null, sizeScale: 1, href: null, mono: true }];
          drawRuns(writer, runs, { x, width, size: t.size.mono, color: t.color.text });
        }
        writer.moveDown(t.spacing.paragraph);
        break;
      }

      case 'list': {
        let index = 1;
        for (const itemBlocks of block.items) {
          const marker = block.ordered
            ? index + '.'
            : BULLETS[Math.min(BULLETS.length - 1, ctx.quoteDepth || 0)];
          writer.ensure(writer.lineHeight(t.size.body));
          const markerY = writer.y - t.size.body;
          writer.page.drawText(marker, {
            x, y: markerY, size: t.size.body, font: writer.fontSet.font('regular'),
            color: PDFLib.rgb(t.color.text[0], t.color.text[1], t.color.text[2])
          });
          await drawBlocks(writer, itemBlocks, {
            ...ctx, indent: (ctx.indent || 0) + t.spacing.listIndent
          });
          index++;
        }
        writer.moveDown(t.spacing.paragraph);
        break;
      }

      case 'blockquote': {
        const barX = x + 2;
        const topY = writer.y;
        const startPage = writer.pageCount;
        await drawBlocks(writer, block.children, {
          ...ctx,
          indent: (ctx.indent || 0) + t.spacing.quoteIndent,
          quoteDepth: (ctx.quoteDepth || 0) + 1
        });
        // The indent rail is drawn after the children so its length is known.
        // It is only drawn when the quote did not cross a page boundary; a rail
        // spanning pages would have to be drawn per page, and a missing rail is
        // cosmetic while a misplaced one is misleading.
        if (writer.pageCount === startPage) {
          writer.page.drawLine({
            start: { x: barX, y: topY }, end: { x: barX, y: writer.y + 2 },
            thickness: 1.5,
            color: PDFLib.rgb(t.color.quoteBar[0], t.color.quoteBar[1], t.color.quoteBar[2])
          });
        }
        writer.moveDown(t.spacing.paragraph);
        break;
      }

      case 'image': {
        const embedded = await embedImage(writer, block.ref, ctx);
        if (!embedded) {
          drawPlaceholder(writer, 'image could not be rendered' +
            (block.alt ? ' — ' + block.alt : ''));
          break;
        }
        const natural = embedded.scale(1);
        const targetW = Math.min(block.widthPx || natural.width, width);
        const scale = targetW / natural.width;
        const targetH = natural.height * scale;
        // An image taller than the printable area is scaled to fit rather than
        // cropped: cropping an exhibit removes evidence.
        const maxH = t.page.height - t.page.margin.top - t.page.margin.bottom;
        const finalScale = targetH > maxH ? (maxH / targetH) : 1;
        const w = targetW * finalScale;
        const h = targetH * finalScale;
        writer.ensure(h + 6);
        writer.page.drawImage(embedded, { x, y: writer.y - h, width: w, height: h });
        writer.moveDown(h + t.spacing.paragraph);
        break;
      }

      case 'blockedImage':
        drawPlaceholder(
          writer,
          block.reason === 'cid-not-found'
            ? 'embedded image missing from message' + (block.alt ? ' — ' + block.alt : '')
            : 'remote image not loaded' + (block.alt ? ' — ' + block.alt : '')
        );
        break;

      case 'table':
        await drawTable(writer, block, ctx, x, width);
        break;

      default:
        break; // unknown block types are skipped rather than throwing
    }
  }
}

async function drawTable(writer, block, ctx, x, width) {
  const t = writer.theme;
  const rows = block.rows || [];
  if (!rows.length) return;

  const columnCount = Math.max(...rows.map((r) =>
    r.reduce((sum, c) => sum + (c.colspan || 1), 0)));
  const colWidth = width / Math.max(1, columnCount);
  const padding = 4;

  const headerRow = rows[0] && rows[0].some((c) => c.header) ? rows[0] : null;

  async function drawRow(row, isHeader) {
    // Each cell is drawn from the same starting y; the deepest result sets the
    // row height. But a cell whose content overflows the page starts a new one,
    // and restoring a y measured on the previous page would then place the next
    // row's text on top of this row's. So track whether the page changed: if it
    // did, the row ends wherever the last cell left the cursor, and the columns
    // after the break are accepted as misaligned rather than overprinted.
    const startY = writer.y;
    const startPage = writer.pageCount;
    let deepest = startY;
    let cx = x;
    let brokePage = false;

    for (const cell of row) {
      const span = cell.colspan || 1;
      if (!brokePage) writer.y = startY;
      const pageBefore = writer.pageCount;
      await drawBlocks(writer, cell.blocks, {
        ...ctx,
        indent: (cx - writer.left) + padding
      });
      if (writer.pageCount !== pageBefore) brokePage = true;
      if (!brokePage && writer.y < deepest) deepest = writer.y;
      cx += colWidth * span;
    }

    if (!brokePage && writer.pageCount === startPage) writer.y = deepest;
    writer.moveDown(2);
    writer.drawRule({ x, width, thickness: isHeader ? 0.8 : 0.3 });
    writer.moveDown(4);
  }

  for (let i = 0; i < rows.length; i++) {
    const estimate = writer.lineHeight(t.size.body) * 2 + 10;
    if (writer.y - estimate < writer.bottomLimit) {
      writer.newPage();
      // A table continuing onto a new page repeats its header row, so a reader
      // looking at page nine knows what the columns mean.
      if (headerRow && i > 0) await drawRow(headerRow, true);
    }
    await drawRow(rows[i], rows[i] === headerRow);
  }

  writer.moveDown(t.spacing.block);
}
```

Note on cell width: cells are laid out by indenting into a column position, which gives correct column starts and correct wrapping within the remaining width, but does not clip a cell to its own column. For email tables — which are overwhelmingly two to five columns of short values — this reads correctly. A cell whose content is wider than its column will run into the next column rather than being truncated, and that is the right trade under the no-truncation rule. Task 18's checklist inspects the Outlook fixture specifically for this.

- [ ] **Step 4: Run the tests to verify they pass**

Reload. Expected: `PASS 81/81`.

- [ ] **Step 5: Commit**

```bash
git add shared/pdf/draw-blocks.js shared/pdf/draw-blocks.test.js batesstamp/email-to-pdf/tests.html
git commit -m "feat(email-to-pdf): draw block IR to PDF pages with table and quote handling"
```

---

## Task 13: Manifest, certificate, appendix and filenames

The evidence apparatus. All four are pure block builders, so they are tested without touching a PDF.

**Files:**
- Create: `shared/eml/manifest.js`
- Create: `shared/eml/certificate.js`
- Create: `shared/eml/filename.js`
- Create: `shared/eml/evidence.test.js`
- Modify: `batesstamp/email-to-pdf/tests.html`

**Interfaces:**
- Consumes: `EmailRecord` (Task 4), `EML_TOOL_VERSION` (Task 1), `shortHash` (Task 3).
- Produces:
  - `dispositionFor(att, options) => 'appended'|'zip-only'|'unreadable'`
  - `manifestBlocks(record, dispositions) => Block[]`
  - `rawHeaderBlocks(record) => Block[]`
  - `certificateBlocks(record, summary) => Block[]` where
    `summary = {pageCount, bodyPartUsed, sanitizeStats, substitutions, dispositions, defects, generatedAtUtc}`
  - `outputFilename(record, taken: Set<string>) => string`

- [ ] **Step 1: Write the failing tests**

```js
// shared/eml/evidence.test.js
import { test, assert, assertEqual } from '/shared/testing/harness.js';
import { dispositionFor, manifestBlocks } from './manifest.js';
import { certificateBlocks, rawHeaderBlocks } from './certificate.js';
import { outputFilename } from './filename.js';
import { loadFixture } from '/shared/testing/fixtures.js';
import { parseEml } from './parse.js';

const textOf = (blocks) => JSON.stringify(blocks);

const OPTS = { appendAttachments: true };

test('PDFs and images are appended; other types are zip-only', () => {
  assertEqual(dispositionFor({ mimeType: 'application/pdf' }, OPTS), 'appended');
  assertEqual(dispositionFor({ mimeType: 'image/png' }, OPTS), 'appended');
  assertEqual(dispositionFor({ mimeType: 'image/jpeg' }, OPTS), 'appended');
  assertEqual(dispositionFor({ mimeType: 'application/vnd.ms-excel' }, OPTS), 'zip-only');
  assertEqual(dispositionFor({ mimeType: 'application/zip' }, OPTS), 'zip-only');
});

test('nothing is appended when the option is off', () => {
  assertEqual(dispositionFor({ mimeType: 'application/pdf' }, { appendAttachments: false }),
    'zip-only');
});

test('an attachment carrying a read error is unreadable regardless of type', () => {
  assertEqual(dispositionFor({ mimeType: 'application/pdf', error: 'bad' }, OPTS), 'unreadable');
});

test('the manifest lists every attachment with size, type and full hash', async () => {
  const rec = await parseEml(await loadFixture('07-large-pdf-attachment.eml'));
  const dispositions = new Map(rec.attachments.map((a) => [a.sha256, 'appended']));
  const out = textOf(manifestBlocks(rec, dispositions));
  assert(out.includes('executed-agreement.pdf'), 'filename listed');
  assert(out.includes('application/pdf'), 'MIME type listed');
  assert(out.includes(rec.attachments[0].sha256), 'full hash listed');
});

test('the manifest is empty when there are no attachments', async () => {
  const rec = await parseEml(await loadFixture('01-plain-text.eml'));
  assertEqual(manifestBlocks(rec, new Map()).length, 0);
});

test('the raw header appendix reproduces Received lines verbatim', async () => {
  const rec = await parseEml(await loadFixture('01-plain-text.eml'));
  const out = textOf(rawHeaderBlocks(rec));
  assert(out.includes('Authentication-Results'), 'auth results present');
  assert(out.includes('203.0.113.24'), 'received chain IP present');
});

test('the certificate states blocked images, substitutions and the body part used', async () => {
  const rec = await parseEml(await loadFixture('09-remote-images.eml'));
  const out = textOf(certificateBlocks(rec, {
    pageCount: 2,
    bodyPartUsed: 'html',
    sanitizeStats: { remoteImagesBlocked: 2, trackingPixelsBlocked: 1,
                     activeContentRemoved: 1, unresolvedCidImages: 0 },
    substitutions: 3,
    dispositions: new Map(),
    defects: [],
    generatedAtUtc: '2026-09-11T12:00:00Z'
  }));
  assert(out.includes('2'), 'blocked image count present');
  assert(out.toLowerCase().includes('tracking'), 'tracking pixels disclosed');
  assert(out.includes('3'), 'substitution count present');
  assert(out.includes(rec.sourceSha256), 'full source hash present');
  assert(out.toLowerCase().includes('html'), 'body part disclosed');
});

test('the certificate discloses parse defects', async () => {
  const rec = await parseEml(await loadFixture('01-plain-text.eml'));
  const out = textOf(certificateBlocks(rec, {
    pageCount: 1, bodyPartUsed: 'text',
    sanitizeStats: { remoteImagesBlocked: 0, trackingPixelsBlocked: 0,
                     activeContentRemoved: 0, unresolvedCidImages: 0 },
    substitutions: 0, dispositions: new Map(),
    defects: [{ code: 'BODY_DECODE_FAILED', detail: 'base64 error at byte 412' }],
    generatedAtUtc: '2026-09-11T12:00:00Z'
  }));
  assert(out.includes('BODY_DECODE_FAILED'), 'defect code disclosed');
  assert(out.includes('base64 error at byte 412'), 'defect detail disclosed');
});

test('filenames combine date and subject and are filesystem-safe', async () => {
  const rec = await parseEml(await loadFixture('02-html-nested-quotes.eml'));
  const name = outputFilename(rec, new Set());
  assertEqual(name, '2026-03-05_RE-Delivery-schedule.pdf');
});

test('duplicate filenames get a numeric suffix rather than overwriting', async () => {
  const rec = await parseEml(await loadFixture('02-html-nested-quotes.eml'));
  const taken = new Set(['2026-03-05_RE-Delivery-schedule.pdf']);
  assertEqual(outputFilename(rec, taken), '2026-03-05_RE-Delivery-schedule-2.pdf');
});

test('a missing date and subject still yield a usable filename', () => {
  const rec = { date: { raw: null, parsed: null }, subject: '' };
  assertEqual(outputFilename(rec, new Set()), 'undated_no-subject.pdf');
});
```

- [ ] **Step 2: Register and run to verify failure**

Add `await import('/shared/eml/evidence.test.js');` to `tests.html`; expect the 404.

- [ ] **Step 3: Write `manifest.js`**

```js
// shared/eml/manifest.js
// Attachment manifest: what came with the message, and what this PDF did with it.

const APPENDABLE = [/^application\/pdf$/i, /^image\/(png|jpe?g)$/i];

function styleRun(text, extra) {
  return Object.assign({
    text, bold: false, italic: false, underline: false, strike: false,
    color: null, sizeScale: 1, href: null
  }, extra || {});
}

export function dispositionFor(att, options) {
  if (att.error) return 'unreadable';
  if (!options || !options.appendAttachments) return 'zip-only';
  return APPENDABLE.some((re) => re.test(att.mimeType || '')) ? 'appended' : 'zip-only';
}

function humanSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

const DISPOSITION_TEXT = {
  appended: 'appended to this PDF',
  'zip-only': 'not appended — provided in the attachment ZIP',
  unreadable: 'could not be read'
};

/**
 * @param {EmailRecord} record
 * @param {Map<string,string>} dispositions  sha256 -> disposition
 * @returns {Array<Object>} block IR
 */
export function manifestBlocks(record, dispositions) {
  if (!record.attachments || record.attachments.length === 0) return [];

  const blocks = [
    { type: 'rule' },
    { type: 'heading', level: 3,
      runs: [styleRun('Attachments (' + record.attachments.length + ')')] }
  ];

  const rows = [[
    { blocks: [{ type: 'paragraph', runs: [styleRun('#')] }], colspan: 1, rowspan: 1, header: true },
    { blocks: [{ type: 'paragraph', runs: [styleRun('File')] }], colspan: 1, rowspan: 1, header: true },
    { blocks: [{ type: 'paragraph', runs: [styleRun('Type / size')] }], colspan: 1, rowspan: 1, header: true },
    { blocks: [{ type: 'paragraph', runs: [styleRun('Disposition')] }], colspan: 1, rowspan: 1, header: true }
  ]];

  record.attachments.forEach((att, i) => {
    const disposition = dispositions.get(att.sha256) || 'zip-only';
    rows.push([
      { blocks: [{ type: 'paragraph', runs: [styleRun(String(i + 1))] }],
        colspan: 1, rowspan: 1, header: false },
      { blocks: [
          { type: 'paragraph', runs: [styleRun(att.filename, { bold: true })] },
          { type: 'paragraph', runs: [styleRun('SHA-256 ' + att.sha256, { sizeScale: 0.8 })] }
        ], colspan: 1, rowspan: 1, header: false },
      { blocks: [{ type: 'paragraph',
          runs: [styleRun(att.mimeType + '\n' + humanSize(att.size))] }],
        colspan: 1, rowspan: 1, header: false },
      { blocks: [{ type: 'paragraph',
          runs: [styleRun(DISPOSITION_TEXT[disposition] +
            (att.error ? ' (' + att.error + ')' : ''))] }],
        colspan: 1, rowspan: 1, header: false }
    ]);
  });

  blocks.push({ type: 'table', rows });
  return blocks;
}
```

- [ ] **Step 4: Write `certificate.js`**

```js
// shared/eml/certificate.js
// The certificate of conversion and the raw header appendix.
//
// The certificate is a factual record of what this tool did. It asserts nothing
// about the underlying email — not that it is genuine, not that it is complete as
// sent — only what was converted, from what bytes, and what the conversion could
// not reproduce. Keeping it on that side of the line is what makes it usable.

import { EML_TOOL_VERSION } from './version.js';

function styleRun(text, extra) {
  return Object.assign({
    text, bold: false, italic: false, underline: false, strike: false,
    color: null, sizeScale: 1, href: null
  }, extra || {});
}

const para = (text, extra) => ({ type: 'paragraph', runs: [styleRun(text, extra)] });

function field(label, value) {
  return { type: 'paragraph', runs: [
    styleRun(label + '  ', { bold: true }),
    styleRun(value)
  ] };
}

export function rawHeaderBlocks(record) {
  return [
    { type: 'heading', level: 3, runs: [styleRun('Appendix: full message headers')] },
    para('Reproduced verbatim from the source file. Lines too long for the page ' +
         'are wrapped with a leading marker; a wrapped line is a continuation of ' +
         'the line above it, not a separate header.', { italic: true, sizeScale: 0.9 }),
    { type: 'rule' },
    // Preformatted keeps the monospace face and every original line break, which
    // is what makes a Received chain readable as a chain.
    { type: 'preformatted', text: record.rawHeaderBlock.replace(/\r\n/g, '\n') }
  ];
}

/**
 * @param {EmailRecord} record
 * @param {Object} summary
 */
export function certificateBlocks(record, summary) {
  const limitations = [];
  const s = summary.sanitizeStats || {};

  if (s.remoteImagesBlocked) {
    limitations.push(
      s.remoteImagesBlocked + ' remote image(s) were not loaded' +
      (s.trackingPixelsBlocked
        ? ', of which ' + s.trackingPixelsBlocked + ' were tracking pixels'
        : '') +
      '. Remote content is never fetched, so that converting this message does ' +
      'not notify its sender.'
    );
  }
  if (s.unresolvedCidImages) {
    limitations.push(s.unresolvedCidImages +
      ' inline image(s) referenced by the message body were absent from the file.');
  }
  if (s.activeContentRemoved) {
    limitations.push(s.activeContentRemoved +
      ' script or style element(s) were removed. Style sheets are not applied; ' +
      'the layout of the body is a reconstruction, not a screenshot.');
  } else {
    limitations.push('Style sheets are not applied; the layout of the body is a ' +
      'reconstruction of the message, not a screenshot of it.');
  }
  if (summary.substitutions) {
    limitations.push(summary.substitutions +
      ' character(s) could not be rendered in any embedded font and appear as ' +
      'the replacement character «�».');
  }

  const notAppended = [];
  for (const att of record.attachments || []) {
    const d = summary.dispositions.get(att.sha256);
    if (d !== 'appended') notAppended.push(att.filename + ' (' + (d || 'zip-only') + ')');
  }
  if (notAppended.length) {
    limitations.push('Attachment(s) not appended to this PDF: ' + notAppended.join('; ') + '.');
  }

  for (const defect of summary.defects || []) {
    limitations.push(defect.code + ': ' + defect.detail);
  }

  const blocks = [
    { type: 'heading', level: 3, runs: [styleRun('Certificate of conversion')] },
    { type: 'rule' },
    field('Tool', 'BatesStamp.com Email to PDF, version ' + EML_TOOL_VERSION),
    field('Converted at', summary.generatedAtUtc + ' (UTC)'),
    field('Source file', record.sourceFilename || '(unnamed)'),
    field('Source SHA-256', record.sourceSha256),
    field('Message-ID', record.messageId || '(none present)'),
    field('Date header', record.date.raw || '(none present)'),
    field('Pages', String(summary.pageCount)),
    field('Attachments', String((record.attachments || []).length)),
    field('Body rendered from', summary.bodyPartUsed === 'html'
      ? 'the message’s HTML part'
      : summary.bodyPartUsed === 'text'
        ? 'the message’s plain-text part'
        : 'no body part — the message had none'),
    { type: 'rule' },
    { type: 'heading', level: 4, runs: [styleRun('Limitations of this conversion')] },
    {
      type: 'list', ordered: false, depth: 0,
      items: limitations.map((text) => [para(text)])
    },
    { type: 'rule' },
    para('The statements above describe this conversion only. They are not a ' +
         'representation about the authenticity, completeness, or contents of the ' +
         'underlying message.', { italic: true, sizeScale: 0.9 }),
    para(' '),
    para(' '),
    para('Signature: ____________________________________    Date: ______________'),
    para(' '),
    para('Printed name: _________________________________')
  ];

  return blocks;
}
```

- [ ] **Step 5: Write `filename.js`**

```js
// shared/eml/filename.js
// Output filenames: sortable by date, recognisable by subject, safe everywhere.

function sanitizeSegment(text) {
  return String(text)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function isoDate(record) {
  const d = record.date && record.date.parsed;
  if (!d) return 'undated';
  // Uses the parsed date purely to sort and name the file. The date *shown* in
  // the document is always the raw header — see themes.js.
  const pad = (n) => String(n).padStart(2, '0');
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
}

/**
 * @param {EmailRecord} record
 * @param {Set<string>} taken  filenames already used in this batch
 */
export function outputFilename(record, taken) {
  const subject = sanitizeSegment(record.subject || '') || 'no-subject';
  const base = isoDate(record) + '_' + subject;
  let candidate = base + '.pdf';
  let n = 2;
  while (taken.has(candidate)) {
    candidate = base + '-' + n + '.pdf';
    n++;
  }
  taken.add(candidate);
  return candidate;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Reload. Expected: `PASS 93/93`.

The filename test expects `2026-03-05_RE-Delivery-schedule.pdf`: the date comes from the parsed `Date` header in UTC, and `RE: Delivery schedule` sanitizes to `RE-Delivery-schedule`.

- [ ] **Step 7: Commit**

```bash
git add shared/eml/manifest.js shared/eml/certificate.js shared/eml/filename.js \
        shared/eml/evidence.test.js batesstamp/email-to-pdf/tests.html
git commit -m "feat(email-to-pdf): attachment manifest, certificate of conversion and filenames"
```

---

## Task 14: Assembly — the first real PDF

The orchestration task. At its end the pipeline produces a complete, openable, evidence-bearing PDF from a `.eml` file.

**Files:**
- Create: `shared/eml/assemble.js`
- Create: `shared/eml/assemble.test.js`
- Modify: `batesstamp/email-to-pdf/tests.html`

**Interfaces:**
- Consumes: everything from Tasks 3–13.
- Produces: `convertEmail(record, options) => Promise<{bytes: Uint8Array, pageCount: number, summary: Object, zipFiles: Array<{name, bytes}>}>`

`options`, with the spec's defaults:

```js
{
  theme: 'mail-client',
  appendAttachments: true,      // PDFs merged, images as pages
  zipOtherAttachments: true,
  certificate: true,
  rawHeaderAppendix: true,
  hashes: true,
  embedSource: false
}
```

- [ ] **Step 1: Write the failing tests**

```js
// shared/eml/assemble.test.js
import { test, assert, assertEqual } from '/shared/testing/harness.js';
import { loadFixture } from '/shared/testing/fixtures.js';
import { parseEml } from './parse.js';
import { convertEmail, DEFAULT_OPTIONS } from './assemble.js';

async function convertFixture(name, overrides) {
  const rec = await parseEml(await loadFixture(name), { filename: name });
  return convertEmail(rec, Object.assign({}, DEFAULT_OPTIONS, overrides || {}));
}

test('produces a loadable PDF from a plain-text email', async () => {
  const out = await convertFixture('01-plain-text.eml');
  const doc = await PDFLib.PDFDocument.load(out.bytes);
  assert(doc.getPageCount() >= 2, 'body plus certificate and appendix');
  assertEqual(doc.getPageCount(), out.pageCount);
});

test('turning off the appendix and certificate makes a shorter document', async () => {
  const withAll = await convertFixture('01-plain-text.eml');
  const bare = await convertFixture('01-plain-text.eml',
    { certificate: false, rawHeaderAppendix: false });
  assert(bare.pageCount < withAll.pageCount, 'options actually remove pages');
});

test('every theme produces a valid document', async () => {
  for (const theme of ['mail-client', 'exhibit', 'minimal']) {
    const out = await convertFixture('02-html-nested-quotes.eml', { theme });
    const doc = await PDFLib.PDFDocument.load(out.bytes);
    assert(doc.getPageCount() >= 1, theme + ' produced pages');
  }
});

test('an attached PDF is merged into the output', async () => {
  const withAppend = await convertFixture('07-large-pdf-attachment.eml');
  const without = await convertFixture('07-large-pdf-attachment.eml',
    { appendAttachments: false });
  assert(withAppend.pageCount > without.pageCount, 'merged attachment added pages');
  assertEqual(withAppend.summary.dispositions.get(
    (await parseEml(await loadFixture('07-large-pdf-attachment.eml'))).attachments[0].sha256
  ), 'appended');
});

test('non-appendable attachments land in the ZIP list', async () => {
  const out = await convertFixture('07-large-pdf-attachment.eml',
    { appendAttachments: false });
  assertEqual(out.zipFiles.length, 1);
  assertEqual(out.zipFiles[0].name, 'executed-agreement.pdf');
});

test('an inline cid image is embedded rather than placeheld', async () => {
  const out = await convertFixture('03-inline-cid-image.eml');
  assertEqual(out.summary.sanitizeStats.unresolvedCidImages, 0);
  assert(out.bytes.length > 2000, 'produced a real document');
});

test('blocked remote images are counted into the summary', async () => {
  const out = await convertFixture('09-remote-images.eml');
  assertEqual(out.summary.sanitizeStats.remoteImagesBlocked, 2);
  assertEqual(out.summary.sanitizeStats.trackingPixelsBlocked, 1);
});

test('embedSource attaches the original .eml to the PDF', async () => {
  const off = await convertFixture('01-plain-text.eml', { embedSource: false });
  const on = await convertFixture('01-plain-text.eml', { embedSource: true });
  assert(on.bytes.length > off.bytes.length, 'embedding grew the file');
  const text = new TextDecoder('latin1').decode(on.bytes);
  assert(text.includes('EmbeddedFile'), 'embedded file stream present');
});

test('a message whose body failed to decode says so, rather than "no body text"', async () => {
  const rec = await parseEml(await loadFixture('04-broken-base64.eml'),
    { filename: '04-broken-base64.eml' });
  // Only meaningful when the parser actually reported a decode failure; when the
  // library salvages the body there is nothing to disclose.
  if (!rec.defects.some((d) => d.code === 'BODY_DECODE_FAILED')) return;
  const out = await convertEmail(rec, DEFAULT_OPTIONS);
  const text = new TextDecoder('latin1').decode(out.bytes);
  assert(!text.includes('contained no body text'), 'does not claim the body was empty');
});

test('a headers-only email still converts', async () => {
  const out = await convertFixture('10-headers-only.eml');
  assert(out.pageCount >= 1, 'produced at least one page');
  assertEqual(out.summary.bodyPartUsed, 'none');
});

test('a forwarded message renders its nested record', async () => {
  const out = await convertFixture('06-forwarded-message.eml');
  assert(out.pageCount >= 1, 'produced pages');
  assert(out.bytes.length > 2000, 'nested content rendered');
});

test('the summary carries everything the certificate needs', async () => {
  const out = await convertFixture('09-remote-images.eml');
  for (const key of ['pageCount', 'bodyPartUsed', 'sanitizeStats', 'substitutions',
                     'dispositions', 'defects', 'generatedAtUtc']) {
    assert(out.summary[key] !== undefined, 'summary.' + key + ' present');
  }
});
```

- [ ] **Step 2: Register and run to verify failure**

Add `await import('/shared/eml/assemble.test.js');` to `tests.html`; expect the 404.

- [ ] **Step 3: Write the implementation**

```js
// shared/eml/assemble.js
// EmailRecord + options -> finished PDF bytes.
//
// Order is fixed and load-bearing: header, body, manifest, appended attachments,
// header appendix, certificate. The certificate is last because it reports the
// page count, and the page count is not known until everything before it is drawn.

import { loadFontSet } from '/shared/pdf/fonts.js';
import { PageWriter } from '/shared/pdf/writer.js';
import { drawBlocks } from '/shared/pdf/draw-blocks.js';
import { THEMES } from './themes.js';
import { sanitizeHtml } from './sanitize.js';
import { htmlToBlocks } from './html-to-blocks.js';
import { textToBlocks } from './text-to-blocks.js';
import { dispositionFor, manifestBlocks } from './manifest.js';
import { certificateBlocks, rawHeaderBlocks } from './certificate.js';
import { shortHash } from './hash.js';

export const DEFAULT_OPTIONS = {
  theme: 'mail-client',
  appendAttachments: true,
  zipOtherAttachments: true,
  certificate: true,
  rawHeaderAppendix: true,
  hashes: true,
  embedSource: false
};

const EMPTY_STATS = {
  remoteImagesBlocked: 0, trackingPixelsBlocked: 0,
  activeContentRemoved: 0, unresolvedCidImages: 0
};

function styleRun(text, extra) {
  return Object.assign({
    text, bold: false, italic: false, underline: false, strike: false,
    color: null, sizeScale: 1, href: null
  }, extra || {});
}

function bodyBlocksFor(record) {
  if (record.bodyPartUsed === 'html') {
    const { body, stats } = sanitizeHtml(record.bodyHtml, record.inlineImages);
    return { blocks: htmlToBlocks(body), stats };
  }
  if (record.bodyPartUsed === 'text') {
    return { blocks: textToBlocks(record.bodyText), stats: Object.assign({}, EMPTY_STATS) };
  }
  // A message that simply had no body and a message whose body could not be
  // decoded are different facts, and saying the first when the second is true
  // would misstate the evidence. Spec §7: a lawyer must learn the message exists
  // even when its body is unreadable.
  const decodeFailure = (record.defects || [])
    .find((d) => d.code === 'BODY_DECODE_FAILED');

  if (decodeFailure) {
    return {
      blocks: [{
        type: 'paragraph',
        runs: [styleRun(
          'The body of this message could not be decoded (' + decodeFailure.detail +
          '). The headers above are reproduced from the source file and are intact.',
          { italic: true }
        )]
      }],
      stats: Object.assign({}, EMPTY_STATS)
    };
  }

  return {
    blocks: [{
      type: 'paragraph',
      runs: [styleRun('This message contained no body text.', { italic: true })]
    }],
    stats: Object.assign({}, EMPTY_STATS)
  };
}

function mergeStats(into, from) {
  for (const key of Object.keys(EMPTY_STATS)) into[key] += (from[key] || 0);
  return into;
}

/** Draw one record's header and body. Used for the message and for nested ones. */
async function drawRecord(writer, record, ctx, stats) {
  writer.theme.drawHeaderBlock(writer, record);
  const { blocks, stats: bodyStats } = bodyBlocksFor(record);
  mergeStats(stats, bodyStats);
  await drawBlocks(writer, blocks, Object.assign({}, ctx, { images: record.inlineImages }));

  for (const nested of record.nested || []) {
    writer.moveDown(writer.theme.spacing.block);
    writer.drawRule();
    writer.moveDown(6);
    await drawBlocks(writer, [{
      type: 'paragraph',
      runs: [styleRun('Forwarded message, reproduced from the attached original:',
        { italic: true, sizeScale: 0.9 })]
    }], ctx);
    // A forwarded message is indented as a unit so a reader can see at a glance
    // where the outer message ends and the quoted original begins.
    const nestedCtx = Object.assign({}, ctx, {
      indent: (ctx.indent || 0) + writer.theme.spacing.quoteIndent
    });
    await drawRecord(writer, nested, nestedCtx, stats);
  }
}

/**
 * @param {EmailRecord} record
 * @param {Object} options
 */
export async function convertEmail(record, options = {}) {
  const opts = Object.assign({}, DEFAULT_OPTIONS, options);
  const theme = THEMES[opts.theme] || THEMES['mail-client'];

  const pdfDoc = await PDFLib.PDFDocument.create();
  pdfDoc.setTitle(record.subject || '(no subject)');
  pdfDoc.setProducer('BatesStamp.com Email to PDF');
  // No author or creator: those fields would carry the reviewer's identity into
  // a document that may be produced to the other side.

  const fontSet = await loadFontSet(pdfDoc, { family: theme.family });

  const footerLeft = opts.hashes
    ? (record.sourceFilename || 'message') + ' · ' + shortHash(record.sourceSha256)
    : (record.sourceFilename || 'message');

  const writer = new PageWriter({ pdfDoc, theme, fontSet, footerLeft });
  const ctx = { indent: 0, quoteDepth: 0, images: record.inlineImages, embedCache: new Map() };
  const stats = Object.assign({}, EMPTY_STATS);

  await drawRecord(writer, record, ctx, stats);

  // Dispositions are decided before the manifest is drawn, because the manifest
  // states them and the certificate repeats them. One decision, three readers.
  const dispositions = new Map();
  for (const att of record.attachments || []) {
    dispositions.set(att.sha256, dispositionFor(att, opts));
  }

  const manifest = manifestBlocks(record, dispositions);
  if (manifest.length) {
    writer.moveDown(theme.spacing.block);
    await drawBlocks(writer, manifest, ctx);
  }

  // Appended attachments.
  const zipFiles = [];
  for (const att of record.attachments || []) {
    const disposition = dispositions.get(att.sha256);
    if (disposition !== 'appended') {
      if (opts.zipOtherAttachments && !att.error) {
        zipFiles.push({ name: att.filename, bytes: att.bytes });
      }
      continue;
    }

    if (/^application\/pdf$/i.test(att.mimeType)) {
      try {
        writer.newPage();
        await drawBlocks(writer, [
          { type: 'heading', level: 4, runs: [styleRun('Attachment: ' + att.filename)] },
          { type: 'paragraph', runs: [styleRun('SHA-256 ' + att.sha256, { sizeScale: 0.8 })] }
        ], ctx);
        const src = await PDFLib.PDFDocument.load(att.bytes, { ignoreEncryption: true });
        const pages = await pdfDoc.copyPages(src, src.getPageIndices());
        for (const page of pages) pdfDoc.addPage(page);
        // Copied pages bypass the writer's cursor, so resynchronise it.
        writer.pages = pdfDoc.getPages();
        writer.newPage();
      } catch (err) {
        dispositions.set(att.sha256, 'unreadable');
        att.error = 'could not be merged: ' + String(err && err.message || err);
        record.defects.push({
          code: 'ATTACHMENT_UNREADABLE',
          detail: att.filename + ' — ' + att.error
        });
        if (opts.zipOtherAttachments) zipFiles.push({ name: att.filename, bytes: att.bytes });
      }
      continue;
    }

    // Images become their own page.
    writer.newPage();
    await drawBlocks(writer, [
      { type: 'heading', level: 4, runs: [styleRun('Attachment: ' + att.filename)] },
      { type: 'image', alt: att.filename, widthPx: 0, heightPx: 0,
        ref: { kind: 'cid', contentId: att.contentId || att.sha256 } }
    ], Object.assign({}, ctx, {
      images: new Map([[att.contentId || att.sha256, att]])
    }));
  }

  if (opts.rawHeaderAppendix) {
    writer.newPage();
    await drawBlocks(writer, rawHeaderBlocks(record), ctx);
  }

  const generatedAtUtc = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  if (opts.certificate) {
    writer.newPage();
    // The page count includes this page, which is being written now — so count
    // the pages that exist plus nothing, and let finalize() stamp the real total.
    await drawBlocks(writer, certificateBlocks(record, {
      pageCount: writer.pageCount,
      bodyPartUsed: record.bodyPartUsed,
      sanitizeStats: stats,
      substitutions: fontSet.substitutions,
      dispositions,
      defects: record.defects,
      generatedAtUtc
    }), ctx);
  }

  if (opts.embedSource) {
    await pdfDoc.attach(record.rawBytes, record.sourceFilename || 'source.eml', {
      mimeType: 'message/rfc822',
      description: 'Original email source file, SHA-256 ' + record.sourceSha256
    });
  }

  writer.finalize();
  const bytes = await pdfDoc.save();

  // Spec §9: retaining the source bytes doubles peak memory per file. The hash is
  // computed at parse time and the certificate has already been drawn, so unless
  // the source is being embedded the reference can go before the next file in a
  // batch is read.
  if (!opts.embedSource) record.rawBytes = null;

  return {
    bytes,
    pageCount: pdfDoc.getPageCount(),
    zipFiles,
    summary: {
      pageCount: pdfDoc.getPageCount(),
      bodyPartUsed: record.bodyPartUsed,
      sanitizeStats: stats,
      substitutions: fontSet.substitutions,
      dispositions,
      defects: record.defects,
      generatedAtUtc
    }
  };
}
```

**On the certificate's page count:** the certificate reports the count of pages that exist when it is drawn, which excludes any page the certificate itself spills onto. The footer's "page *n* of *N*" is always exact because `finalize()` runs last. If the checklist in Task 18 finds the certificate's count disagreeing with the footer total by more than the certificate's own length, treat it as a bug and compute the count after drawing by re-rendering the certificate's page-count field — do not leave the two disagreeing, since a certificate that miscounts its own document undermines everything else on it.

- [ ] **Step 4: Run the tests to verify they pass**

Reload. Expected: `PASS 104/104`.

- [ ] **Step 5: Manual spot check — look at an actual PDF**

Tests assert structure; this step is the first time a human sees the output.

```js
// Paste into the browser console on the tests page:
const { parseEml } = await import('/shared/eml/parse.js');
const { convertEmail, DEFAULT_OPTIONS } = await import('/shared/eml/assemble.js');
const { loadFixture } = await import('/shared/testing/fixtures.js');
for (const f of ['01-plain-text.eml', '02-html-nested-quotes.eml', '08-outlook-tables.eml']) {
  const rec = await parseEml(await loadFixture(f), { filename: f });
  const out = await convertEmail(rec, DEFAULT_OPTIONS);
  const url = URL.createObjectURL(new Blob([out.bytes], { type: 'application/pdf' }));
  window.open(url, '_blank');
}
```

Confirm before continuing: the header block renders, the body is selectable text (try `Ctrl-F` for a word in the body), quoted replies are indented with a rail, the footer shows the filename, hash and page numbers, the appendix shows the Received chain, and the certificate lists limitations. Anything wrong here is much cheaper to fix now than after the UI exists.

- [ ] **Step 6: Commit**

```bash
git add shared/eml/assemble.js shared/eml/assemble.test.js batesstamp/email-to-pdf/tests.html
git commit -m "feat(email-to-pdf): assemble complete evidence-grade PDFs from parsed email"
```

---

## Task 15: The tool page and live preview

**Files:**
- Create: `shared/eml/blocks-to-html.js`
- Create: `shared/eml/blocks-to-html.test.js`
- Create: `batesstamp/email-to-pdf/index.html`
- Modify: `batesstamp/styles.css`, `batesstamp/email-to-pdf/tests.html`

**Interfaces:**
- Consumes: block IR (Tasks 6–7), `THEMES`, `convertEmail`.
- Produces: `blocksToHtml(blocks: Block[], opts: {images: Map}) => string` (escaped HTML string).

- [ ] **Step 1: Write the failing tests for the preview renderer**

```js
// shared/eml/blocks-to-html.test.js
import { test, assert, assertEqual } from '/shared/testing/harness.js';
import { blocksToHtml } from './blocks-to-html.js';

const run = (text, extra) => Object.assign({
  text, bold: false, italic: false, underline: false, strike: false,
  color: null, sizeScale: 1, href: null
}, extra || {});

test('escapes HTML in email text so a preview cannot inject markup', () => {
  const html = blocksToHtml([{ type: 'paragraph', runs: [run('<script>alert(1)</script>')] }],
    { images: new Map() });
  assert(!html.includes('<script>'), 'script tag escaped');
  assert(html.includes('&lt;script&gt;'), 'rendered as visible text');
});

test('bold and italic runs become semantic elements', () => {
  const html = blocksToHtml([{ type: 'paragraph',
    runs: [run('a', { bold: true }), run('b', { italic: true })] }], { images: new Map() });
  assert(html.includes('<strong>'), 'bold rendered');
  assert(html.includes('<em>'), 'italic rendered');
});

test('links are rendered inert — no href the reviewer can click through', () => {
  const html = blocksToHtml([{ type: 'paragraph',
    runs: [run('click', { href: 'https://tracker.example/x' })] }], { images: new Map() });
  assert(!html.includes('href='), 'no live href in the preview');
  assert(html.includes('tracker.example'), 'target shown as text');
});

test('blocked images render a visible labeled placeholder', () => {
  const html = blocksToHtml([{ type: 'blockedImage', reason: 'remote', alt: 'Banner' }],
    { images: new Map() });
  assert(html.includes('remote image not loaded'), 'label present');
  assert(html.includes('Banner'), 'alt text preserved');
});

test('nested blockquotes nest in the output', () => {
  const html = blocksToHtml([{ type: 'blockquote', depth: 1, children: [
    { type: 'blockquote', depth: 2, children: [
      { type: 'paragraph', runs: [run('deep')] }] }] }], { images: new Map() });
  assertEqual((html.match(/<blockquote/g) || []).length, 2);
});

test('tables render as tables with header cells', () => {
  const html = blocksToHtml([{ type: 'table', rows: [[
    { blocks: [{ type: 'paragraph', runs: [run('H')] }], colspan: 1, rowspan: 1, header: true }
  ]] }], { images: new Map() });
  assert(html.includes('<th'), 'header cell rendered');
});
```

- [ ] **Step 2: Register and run to verify failure**

Add `await import('/shared/eml/blocks-to-html.test.js');` to `tests.html`; expect the 404.

- [ ] **Step 3: Write the preview renderer**

```js
// shared/eml/blocks-to-html.js
// Block IR -> HTML, for the in-page preview only.
//
// Everything here is escaped and inert. The preview shows the reviewer what the
// PDF will contain; it must not become a second, unguarded path by which hostile
// email markup reaches the live DOM, and no link in it may be clickable — a
// reviewer who clicks a link in an opposing party's email has told that party
// their message is being reviewed.

function esc(text) {
  return String(text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function runsToHtml(runs) {
  return (runs || []).map((r) => {
    let html = esc(r.text).replace(/\n/g, '<br>');
    if (r.bold) html = '<strong>' + html + '</strong>';
    if (r.italic) html = '<em>' + html + '</em>';
    if (r.underline) html = '<u>' + html + '</u>';
    if (r.strike) html = '<s>' + html + '</s>';
    if (r.href) {
      // Deliberately not an <a>: the target is shown, never followed.
      html = '<span class="eml-link" title="' + esc(r.href) + '">' + html + '</span>';
    }
    return html;
  }).join('');
}

export function blocksToHtml(blocks, opts = {}) {
  const images = opts.images || new Map();
  const out = [];

  for (const block of blocks || []) {
    switch (block.type) {
      case 'paragraph':
        out.push('<p>' + runsToHtml(block.runs) + '</p>');
        break;
      case 'heading':
        out.push('<h' + block.level + ' class="eml-h">' + runsToHtml(block.runs) +
                 '</h' + block.level + '>');
        break;
      case 'rule':
        out.push('<hr>');
        break;
      case 'preformatted':
        out.push('<pre>' + esc(block.text) + '</pre>');
        break;
      case 'list': {
        const tag = block.ordered ? 'ol' : 'ul';
        out.push('<' + tag + '>' + block.items
          .map((item) => '<li>' + blocksToHtml(item, opts) + '</li>').join('') +
          '</' + tag + '>');
        break;
      }
      case 'blockquote':
        out.push('<blockquote>' + blocksToHtml(block.children, opts) + '</blockquote>');
        break;
      case 'table':
        out.push('<table class="eml-table">' + block.rows.map((row) =>
          '<tr>' + row.map((cell) => {
            const tag = cell.header ? 'th' : 'td';
            const span = cell.colspan > 1 ? ' colspan="' + cell.colspan + '"' : '';
            return '<' + tag + span + '>' + blocksToHtml(cell.blocks, opts) + '</' + tag + '>';
          }).join('') + '</tr>').join('') + '</table>');
        break;
      case 'blockedImage':
        out.push('<div class="eml-blocked">' +
          (block.reason === 'cid-not-found'
            ? 'embedded image missing from message'
            : 'remote image not loaded') +
          (block.alt ? ' — ' + esc(block.alt) : '') + '</div>');
        break;
      case 'image': {
        if (block.ref.kind === 'data') {
          out.push('<img class="eml-img" alt="' + esc(block.alt) + '" src="' +
            esc(block.ref.url) + '">');
          break;
        }
        const att = images.get(block.ref.contentId);
        if (!att) { out.push('<div class="eml-blocked">inline image missing</div>'); break; }
        const blob = new Blob([att.bytes], { type: att.mimeType });
        out.push('<img class="eml-img" alt="' + esc(block.alt) + '" src="' +
          URL.createObjectURL(blob) + '">');
        break;
      }
      default:
        break;
    }
  }

  return out.join('');
}
```

- [ ] **Step 4: Run the preview tests**

Reload. Expected: `PASS 110/110`.

- [ ] **Step 5: Add the page styles**

Append to `batesstamp/styles.css`:

```css
/* ---------- Email to PDF ---------- */
.eml-preview {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: #fff;
    padding: 20px 24px;
    max-height: 460px;
    overflow-y: auto;
    font-size: 0.92rem;
    line-height: 1.55;
}
.eml-preview-header {
    background: var(--color-gray-50, #f7f8fa);
    border-bottom: 1px solid var(--color-border);
    margin: -20px -24px 18px;
    padding: 16px 24px;
}
.eml-preview-subject { font-weight: 600; font-size: 1.05rem; margin-bottom: 10px; }
.eml-preview-from { font-weight: 600; }
.eml-preview-meta { color: var(--color-gray-600, #667); font-size: 0.85rem; }
.eml-preview blockquote {
    border-left: 3px solid var(--color-border);
    margin: 10px 0 10px 2px;
    padding-left: 14px;
    color: var(--color-gray-700, #445);
}
.eml-preview .eml-table { border-collapse: collapse; margin: 10px 0; width: 100%; }
.eml-preview .eml-table th,
.eml-preview .eml-table td {
    border: 1px solid var(--color-border);
    padding: 5px 8px;
    text-align: left;
    vertical-align: top;
}
.eml-preview .eml-img { max-width: 100%; height: auto; }
.eml-preview .eml-link { color: var(--color-navy, #1e3a5f); text-decoration: underline dotted; }
.eml-blocked {
    display: inline-block;
    border: 1px dashed var(--color-border);
    color: var(--color-gray-600, #667);
    font-size: 0.82rem;
    font-style: italic;
    padding: 8px 12px;
    margin: 6px 0;
    border-radius: 3px;
}
.eml-results { margin-top: 18px; }
.eml-result-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 12px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm, 4px);
    margin-bottom: 7px;
    font-size: 0.9rem;
}
.eml-result-row.is-error { border-color: #d98a8a; background: #fdf6f6; }
.eml-result-row.is-defect { border-color: #d9bd8a; background: #fdfaf4; }
.eml-result-name { flex: 1; font-weight: 500; }
.eml-result-note { color: var(--color-gray-600, #667); font-size: 0.84rem; }
.eml-evidence-group { margin-top: 10px; }
.eml-evidence-group summary { cursor: pointer; font-weight: 600; padding: 6px 0; }
.eml-evidence-group label { display: block; margin: 7px 0 7px 4px; font-size: 0.92rem; }
.eml-evidence-group .hint {
    display: block; margin-left: 24px; color: var(--color-gray-600, #667);
    font-size: 0.82rem;
}
```

- [ ] **Step 6: Write the tool page**

Copy the head block of `batesstamp/compressor/index.html` as the structural model — Umami script, meta tags, canonical, Open Graph, Twitter, JSON-LD, favicons, fonts, `brand.css`, `styles.css` — changing the content to this tool. Exact values:

- `<title>`: `Free EML to PDF Converter | Email to PDF for Evidence | BatesStamp.com`
- `meta description`: `Convert .eml email files to searchable, evidence-grade PDFs with full headers, attachment manifest, and a certificate of conversion. Free, browser-based — your files never leave your device.`
- canonical / og:url / twitter:url: `https://batesstamp.com/email-to-pdf/`
- JSON-LD `WebApplication` with `name` `Email to PDF`, `featureList`: `Converts .eml email files to searchable PDF`, `Preserves full RFC 822 headers including the Received chain`, `SHA-256 hashing of source and attachments`, `Certificate of conversion`, `Blocks remote images and tracking pixels`, `Batch conversion`, `Client-side processing`
- FAQ JSON-LD with these four questions and answers:
  - *How do I convert an email to PDF for court?* — `Drop the .eml file into this tool. It renders the message as searchable PDF text with the full header block, lists every attachment with its SHA-256 hash, and appends a certificate of conversion recording what was converted and what could not be reproduced. Everything happens in your browser; the file is never uploaded.`
  - *Does this preserve email headers?* — `Yes. The complete RFC 822 header block — the Received chain, Message-ID, DKIM-Signature and Authentication-Results — is reproduced verbatim in an appendix. Printing an email from a mail client discards this information, which is what authenticates the message's origin if it is ever challenged.`
  - *Why are images missing from my converted email?* — `Remote images are never downloaded. Loading them would notify the sender, with a timestamp, that their email is being reviewed — which matters when the email came from an opposing party. Each blocked image leaves a labeled placeholder, and the certificate records how many were blocked.`
  - *Is the converted PDF searchable?* — `Yes. The email body is rendered as real PDF text, not as a screenshot, so it is searchable and selectable and can be Bates stamped without an OCR step.`

Body markup:

```html
<body>
    <a href="#main-content" class="skip-link">Skip to main content</a>
    <div class="container">
        <header id="site-header"></header>
        <nav id="site-nav" aria-label="Main navigation"></nav>

        <main id="main-content">
            <noscript><p style="text-align:center;padding:20px;color:#c53030;">This tool requires JavaScript to function. Please enable JavaScript in your browser.</p></noscript>

            <p class="intro-text">Convert <code>.eml</code> email files into searchable PDFs suitable for use as evidence — with the full header chain, an attachment manifest, and a certificate of conversion. All processing happens in your browser; your files never leave your device.</p>

            <!-- 1. Files -->
            <div class="section">
                <h2 class="section-title">1. Select Email Files</h2>
                <div class="control-group">
                    <div class="file-drop-zone" id="dropZone">
                        <input type="file" id="fileInput" accept=".eml" multiple aria-label="Choose .eml files">
                        <div class="drop-zone-icon">
                            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 6 10-6"/></svg>
                        </div>
                        <div class="drop-zone-text">Choose .eml files or drag them here</div>
                        <div class="drop-zone-hint">Your email never leaves your browser.</div>
                    </div>
                </div>
            </div>

            <!-- 2. Style -->
            <div class="section">
                <h2 class="section-title">2. Style</h2>
                <div class="control-group">
                    <fieldset style="border:none;padding:0;margin:0;" aria-label="Output style">
                        <legend class="visually-hidden">Choose the output style</legend>
                        <label class="compression-option">
                            <input type="radio" name="theme" value="mail-client" checked>
                            <div class="compression-option-content">
                                <span class="compression-option-label">Mail client</span>
                                <span class="compression-option-desc">Reads like the message did on screen</span>
                            </div>
                        </label>
                        <label class="compression-option">
                            <input type="radio" name="theme" value="exhibit">
                            <div class="compression-option-content">
                                <span class="compression-option-label">Court exhibit</span>
                                <span class="compression-option-desc">Formal and ruled; photocopies cleanly</span>
                            </div>
                        </label>
                        <label class="compression-option">
                            <input type="radio" name="theme" value="minimal">
                            <div class="compression-option-content">
                                <span class="compression-option-label">Minimal</span>
                                <span class="compression-option-desc">Typography and whitespace, no rules or bands</span>
                            </div>
                        </label>
                    </fieldset>
                </div>
            </div>

            <!-- 3. Output -->
            <div class="section">
                <h2 class="section-title">3. Output</h2>
                <div class="control-group">
                    <label><input type="radio" name="output" value="separate" checked> One PDF per email</label>
                    <label><input type="radio" name="output" value="combined"> Single combined PDF, oldest first, with a table of contents</label>

                    <label><input type="checkbox" id="optAppend" checked> Append attached PDFs and images to the PDF</label>
                    <label><input type="checkbox" id="optZip" checked> Download other attachments as a ZIP</label>

                    <details class="eml-evidence-group">
                        <summary>Evidence options</summary>
                        <label><input type="checkbox" id="optCertificate" checked> Certificate of conversion
                            <span class="hint">A final page recording what was converted, from what file, and what the conversion could not reproduce.</span></label>
                        <label><input type="checkbox" id="optHeaders" checked> Full header appendix
                            <span class="hint">The complete Received chain, DKIM and Authentication-Results, reproduced verbatim.</span></label>
                        <label><input type="checkbox" id="optHashes" checked> SHA-256 of source and attachments
                            <span class="hint">Ties the PDF back to the exact file it came from.</span></label>
                        <label><input type="checkbox" id="optEmbed"> Embed the original .eml inside the PDF
                            <span class="hint">Keeps the native file with the production copy. Roughly doubles file size, and some e-filing portals reject PDFs containing embedded files.</span></label>
                    </details>
                </div>
            </div>

            <!-- Preview -->
            <div class="section hidden" id="previewSection">
                <h2 class="section-title">Preview</h2>
                <p class="eml-result-note" id="previewNote"></p>
                <div class="eml-preview" id="preview"></div>
            </div>

            <button class="button" id="convertBtn" data-umami-event="convert-email" disabled>Convert to PDF</button>

            <div class="progress-container hidden" id="progressContainer">
                <div class="progress-bar" id="progressBar" style="width: 0%"></div>
                <span class="progress-text" id="progressText">Converting...</span>
            </div>

            <div id="status" class="status" role="status" aria-live="polite">
                Select one or more .eml files to begin
            </div>

            <div class="eml-results hidden" id="resultsSection"></div>
        </main>
    </div>
</body>
```

The SEO `<section id="about" class="seo-content">` block follows the same shape as the compressor's, covering: why printing from Outlook loses the header chain; what a certificate of conversion is for; why remote images are blocked; and that output is searchable and Bates-ready.

- [ ] **Step 7: Write the page driver (single-file path)**

Batch and combined output come in Task 16; this step gets one file working end to end.

```html
    <!-- Libraries -->
    <script src="https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js" integrity="sha384-weMABwrltA6jWR8DDe9Jp5blk+tZQh7ugpCsF3JwSA53WZM9/14PjS5LAJNHNjAI" crossorigin="anonymous"></script>
    <script src="https://unpkg.com/jszip@3.10.1/dist/jszip.min.js"></script>
    <script src="/vendor/fontkit.umd.js"></script>

    <!-- Shared classic scripts -->
    <script src="/shared/tools.js"></script>
    <script src="/shared/nav.js"></script>
    <script src="/shared/file-handler.js"></script>
    <script src="/shared/session-files.js"></script>
    <script>initNav({ title: 'Email to PDF', subtitle: 'Convert .eml files to evidence-grade PDF', currentPath: '/email-to-pdf/' });</script>

    <script type="module">
        import { parseEml } from '/shared/eml/parse.js';
        import { convertEmail, DEFAULT_OPTIONS } from '/shared/eml/assemble.js';
        import { sanitizeHtml } from '/shared/eml/sanitize.js';
        import { htmlToBlocks } from '/shared/eml/html-to-blocks.js';
        import { textToBlocks } from '/shared/eml/text-to-blocks.js';
        import { blocksToHtml } from '/shared/eml/blocks-to-html.js';
        import { outputFilename } from '/shared/eml/filename.js';

        const MAX_WARN_MB = 25;
        const MAX_HARD_MB = 100;

        const statusEl = document.getElementById('status');
        const convertBtn = document.getElementById('convertBtn');
        const resultsEl = document.getElementById('resultsSection');
        const progressContainer = document.getElementById('progressContainer');
        const progressBar = document.getElementById('progressBar');
        const progressText = document.getElementById('progressText');

        let selectedFiles = [];
        let previewRecord = null;

        function readOptions() {
            return Object.assign({}, DEFAULT_OPTIONS, {
                theme: document.querySelector('input[name="theme"]:checked').value,
                appendAttachments: document.getElementById('optAppend').checked,
                zipOtherAttachments: document.getElementById('optZip').checked,
                certificate: document.getElementById('optCertificate').checked,
                rawHeaderAppendix: document.getElementById('optHeaders').checked,
                hashes: document.getElementById('optHashes').checked,
                embedSource: document.getElementById('optEmbed').checked
            });
        }

        function escapeHtml(s) {
            return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
                .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        }

        function renderPreview(record) {
            const source = record.bodyPartUsed === 'html'
                ? htmlToBlocks(sanitizeHtml(record.bodyHtml, record.inlineImages).body)
                : record.bodyPartUsed === 'text'
                    ? textToBlocks(record.bodyText)
                    : [];

            const addr = (list) => (list || [])
                .map((a) => a.name ? a.name + ' <' + a.address + '>' : a.address).join(', ');

            const header =
                '<div class="eml-preview-header">' +
                  '<div class="eml-preview-subject">' +
                    escapeHtml(record.subject || '(no subject)') + '</div>' +
                  '<div class="eml-preview-from">' +
                    escapeHtml(record.from ? (record.from.name || record.from.address)
                                           : '(unknown sender)') + '</div>' +
                  '<div class="eml-preview-meta">' +
                    escapeHtml(record.from ? record.from.address : '') + '</div>' +
                  '<div class="eml-preview-meta">to ' +
                    escapeHtml(addr(record.to) || '(undisclosed recipients)') + '</div>' +
                  (record.cc.length
                    ? '<div class="eml-preview-meta">cc ' + escapeHtml(addr(record.cc)) + '</div>'
                    : '') +
                  '<div class="eml-preview-meta">' +
                    escapeHtml(record.date.raw || '(no date header)') + '</div>' +
                '</div>';

            document.getElementById('preview').innerHTML =
                header + blocksToHtml(source, { images: record.inlineImages });
            document.getElementById('previewNote').textContent =
                selectedFiles.length > 1
                    ? 'Showing the first of ' + selectedFiles.length + ' emails.'
                    : '';
            document.getElementById('previewSection').classList.remove('hidden');
        }

        async function onFilesSelected(files) {
            selectedFiles = Array.from(files);
            convertBtn.disabled = selectedFiles.length === 0;
            resultsEl.classList.add('hidden');
            resultsEl.innerHTML = '';

            const oversize = selectedFiles.filter((f) => f.size > MAX_HARD_MB * 1024 * 1024);
            if (oversize.length) {
                statusEl.className = 'status status-error';
                statusEl.textContent = oversize.length + ' file(s) exceed the ' +
                    MAX_HARD_MB + ' MB limit and cannot be converted in a browser tab.';
                selectedFiles = selectedFiles.filter((f) => f.size <= MAX_HARD_MB * 1024 * 1024);
                convertBtn.disabled = selectedFiles.length === 0;
            }

            if (!selectedFiles.length) return;

            try {
                const first = selectedFiles[0];
                const bytes = new Uint8Array(await first.arrayBuffer());
                previewRecord = await parseEml(bytes, { filename: first.name });
                renderPreview(previewRecord);
                statusEl.className = 'status';
                statusEl.textContent = selectedFiles.length === 1
                    ? 'Ready to convert 1 email.'
                    : 'Ready to convert ' + selectedFiles.length + ' emails.';
            } catch (err) {
                statusEl.className = 'status status-error';
                statusEl.textContent = 'Could not read that file: ' + err.message;
            }
        }

        // Re-render the preview when the style changes so the choice is visible
        // before committing to a conversion.
        for (const radio of document.querySelectorAll('input[name="theme"]')) {
            radio.addEventListener('change', () => { if (previewRecord) renderPreview(previewRecord); });
        }

        initFileDropZone('dropZone', {
            accept: ['.eml'],
            multiple: true,
            maxSizeMB: MAX_HARD_MB,
            onFiles: onFilesSelected
        });

        function addResultRow({ name, note, state }) {
            const row = document.createElement('div');
            row.className = 'eml-result-row' +
                (state === 'error' ? ' is-error' : state === 'defect' ? ' is-defect' : '');
            row.innerHTML = '<span class="eml-result-name">' + escapeHtml(name) + '</span>' +
                            '<span class="eml-result-note">' + escapeHtml(note) + '</span>';
            resultsEl.appendChild(row);
            resultsEl.classList.remove('hidden');
        }

        convertBtn.addEventListener('click', async () => {
            const options = readOptions();
            convertBtn.disabled = true;
            resultsEl.innerHTML = '';
            progressContainer.classList.remove('hidden');
            progressBar.style.width = '0%';

            const taken = new Set();
            const zipEntries = [];
            const pdfEntries = [];

            for (let i = 0; i < selectedFiles.length; i++) {
                const file = selectedFiles[i];
                progressText.textContent = 'Converting ' + (i + 1) + ' of ' + selectedFiles.length;
                progressBar.style.width = Math.round((i / selectedFiles.length) * 100) + '%';

                try {
                    const bytes = new Uint8Array(await file.arrayBuffer());
                    const record = await parseEml(bytes, { filename: file.name });
                    const out = await convertEmail(record, options);
                    const name = outputFilename(record, taken);

                    // Browsers block a page that starts several downloads in a
                    // row, so a batch is delivered as one ZIP. A single file
                    // downloads directly, which is what a one-off conversion wants.
                    if (selectedFiles.length === 1) {
                        downloadPdf(out.bytes, name);
                    } else {
                        pdfEntries.push({ name, bytes: out.bytes });
                    }
                    if (typeof sessionFiles !== 'undefined') {
                        sessionFiles.add(name,
                            new Blob([out.bytes], { type: 'application/pdf' }), 'email-to-pdf');
                    }

                    for (const entry of out.zipFiles) {
                        zipEntries.push({ name: name.replace(/\.pdf$/, '') + '/' + entry.name,
                                          bytes: entry.bytes });
                    }

                    const defectCount = out.summary.defects.length;
                    addResultRow({
                        name,
                        note: out.pageCount + ' pages' +
                              (defectCount ? ' · ' + defectCount + ' defect(s) noted on the certificate' : ''),
                        state: defectCount ? 'defect' : 'ok'
                    });
                } catch (err) {
                    // One bad file never stops the batch.
                    addResultRow({ name: file.name, note: 'failed — ' + err.message, state: 'error' });
                }
            }

            if (pdfEntries.length) {
                const zip = new JSZip();
                for (const entry of pdfEntries) zip.file(entry.name, entry.bytes);
                const blob = await zip.generateAsync({ type: 'blob' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'converted-emails.zip';
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
                addResultRow({ name: 'converted-emails.zip',
                               note: pdfEntries.length + ' PDF(s)', state: 'ok' });
            }

            if (options.zipOtherAttachments && zipEntries.length) {
                const zip = new JSZip();
                for (const entry of zipEntries) zip.file(entry.name, entry.bytes);
                const blob = await zip.generateAsync({ type: 'blob' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'email-attachments.zip';
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
                addResultRow({ name: 'email-attachments.zip',
                               note: zipEntries.length + ' attachment(s)', state: 'ok' });
            }

            progressBar.style.width = '100%';
            progressText.textContent = 'Done';
            statusEl.className = 'status status-success';
            statusEl.textContent = 'Conversion complete.';
            showPipelineSuggestions('email-to-pdf');
            convertBtn.disabled = false;
        });
    </script>
```

- [ ] **Step 8: Verify the page end to end by hand**

```bash
cd /home/ctibs/Projects/legal-tools && bash build.sh --dev
cd batesstamp && python3 -m http.server 8788
```

Open `http://localhost:8788/email-to-pdf/`, drop `docs/fixtures/eml/02-html-nested-quotes.eml`, and confirm: the preview renders with the header band; switching the style radio re-renders it; Convert downloads a PDF; the PDF's body text is selectable; the footer shows filename, hash and page numbers. Then drop `09-remote-images.eml` and confirm the preview shows *remote image not loaded* placeholders rather than gaps, and that the certificate page reports two blocked images including one tracking pixel.

- [ ] **Step 9: Commit**

```bash
git add shared/eml/blocks-to-html.js shared/eml/blocks-to-html.test.js \
        batesstamp/email-to-pdf/index.html batesstamp/styles.css \
        batesstamp/email-to-pdf/tests.html
git commit -m "feat(email-to-pdf): tool page with live preview and single-file conversion"
```

---

## Task 16: Combined output with a table of contents

**Files:**
- Modify: `shared/pdf/writer.js` (add `useExistingPage`, `reservePages`)
- Modify: `shared/eml/assemble.js` (add `convertBatchCombined`)
- Modify: `shared/pdf/writer.test.js`, `shared/eml/assemble.test.js`
- Modify: `batesstamp/email-to-pdf/index.html`

**Interfaces:**
- Produces:
  - `PageWriter.reservePages(count) => number[]` — appends blank pages and returns their indices
  - `PageWriter.useExistingPage(index) => void` — points the cursor at an existing page, at the top margin
  - `convertBatchCombined(records, options) => Promise<{bytes, pageCount, perEmail: Array, zipFiles: Array}>`

**Why the table of contents is pre-allocated rather than prepended.** A TOC cannot be written until every email's start page is known, but it belongs at the front. Reordering pages after the fact invalidates the footer numbering and the annotation-to-page mapping, both of which are keyed by position — a class of bug that produces a document whose page numbers lie. Instead the entry count fixes the TOC's length in advance, those pages are reserved up front, and they are filled in at the end. Deterministic, and nothing moves.

- [ ] **Step 1: Write the failing tests**

Append to `shared/pdf/writer.test.js`:

```js
test('reservePages appends blank pages and returns their indices', async () => {
  const { writer } = await newWriter();
  const indices = writer.reservePages(3);
  assertEqual(indices.length, 3);
  assertEqual(writer.pageCount, 4);
  assertEqual(indices[0], 1);
});

test('useExistingPage moves the cursor without adding a page', async () => {
  const { writer } = await newWriter();
  const [first] = writer.reservePages(1);
  writer.newPage();
  const countBefore = writer.pageCount;
  writer.useExistingPage(first);
  assertEqual(writer.pageCount, countBefore);
  assertEqual(writer.y, 792 - writer.theme.page.margin.top);
});

test('drawing into a reserved page does not append pages', async () => {
  const { writer } = await newWriter();
  const [reserved] = writer.reservePages(1);
  writer.newPage();
  const before = writer.pageCount;
  writer.useExistingPage(reserved);
  writer.drawLine(tokenizeRuns([{ text: 'Contents', ...style }]), { x: 54, size: 12 });
  assertEqual(writer.pageCount, before);
});
```

Append to `shared/eml/assemble.test.js`:

```js
import { convertBatchCombined } from './assemble.js';

test('a combined PDF contains every email and starts with a table of contents', async () => {
  const names = ['01-plain-text.eml', '02-html-nested-quotes.eml', '10-headers-only.eml'];
  const records = [];
  for (const n of names) records.push(await parseEml(await loadFixture(n), { filename: n }));
  const out = await convertBatchCombined(records, DEFAULT_OPTIONS);
  const doc = await PDFLib.PDFDocument.load(out.bytes);
  assert(doc.getPageCount() > names.length, 'more pages than emails');
  assertEqual(out.perEmail.length, 3);
  assert(out.perEmail.every((e) => e.startPage >= 1), 'every email has a start page');
});

test('combined output orders emails oldest first regardless of input order', async () => {
  const later = await parseEml(await loadFixture('02-html-nested-quotes.eml'),
    { filename: 'b.eml' });
  const earlier = await parseEml(await loadFixture('01-plain-text.eml'),
    { filename: 'a.eml' });
  const out = await convertBatchCombined([later, earlier], DEFAULT_OPTIONS);
  assertEqual(out.perEmail[0].subject, 'Delivery schedule');
  assertEqual(out.perEmail[1].subject, 'RE: Delivery schedule');
});

test('an email with no date sorts last rather than crashing the sort', async () => {
  const dated = await parseEml(await loadFixture('01-plain-text.eml'), { filename: 'a.eml' });
  const undated = await parseEml(await loadFixture('01-plain-text.eml'), { filename: 'b.eml' });
  undated.date = { raw: null, parsed: null };
  const out = await convertBatchCombined([undated, dated], DEFAULT_OPTIONS);
  assertEqual(out.perEmail.length, 2);
  assertEqual(out.perEmail[1].sourceFilename, 'b.eml');
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Reload. Expected: failures naming `writer.reservePages is not a function` and `convertBatchCombined is not exported`.

- [ ] **Step 3: Extend `PageWriter`**

Add to the class in `shared/pdf/writer.js`:

```js
  /**
   * Append `count` blank pages and return their indices. Used to hold space for
   * a table of contents that cannot be written until everything after it exists.
   */
  reservePages(count) {
    const indices = [];
    for (let i = 0; i < count; i++) {
      const page = this.pdfDoc.addPage([this.theme.page.width, this.theme.page.height]);
      this.pages.push(page);
      indices.push(this.pages.length - 1);
    }
    // The cursor stays on whatever page it was on; reserving does not move it.
    this.page = this.pages[this.pages.length - 1];
    this.y = this.theme.page.height - this.theme.page.margin.top;
    return indices;
  }

  /** Point the cursor at an existing page, at the top margin. */
  useExistingPage(index) {
    if (index < 0 || index >= this.pages.length) throw new Error('no such page: ' + index);
    this.page = this.pages[index];
    this.y = this.theme.page.height - this.theme.page.margin.top;
  }
```

`linkTo` and `linkToDestination` attach annotations to `this.pages.length - 1`, which is wrong once the cursor can sit on an earlier page. Change both to resolve the current page's index:

```js
  get currentPageIndex() {
    return this.pages.indexOf(this.page);
  }
```

and replace both `this._annotsFor(this.pages.length - 1)` calls with `this._annotsFor(this.currentPageIndex)`.

- [ ] **Step 4: Add `convertBatchCombined` to `shared/eml/assemble.js`**

```js
const TOC_TITLE = 'Contents';

function sortChronologically(records) {
  // Undated messages sort last, in the order given, rather than being dropped or
  // forced to an invented date.
  return records.slice().sort((a, b) => {
    const at = a.date.parsed ? a.date.parsed.getTime() : Infinity;
    const bt = b.date.parsed ? b.date.parsed.getTime() : Infinity;
    return at - bt;
  });
}

/**
 * @param {EmailRecord[]} records
 * @param {Object} options
 */
export async function convertBatchCombined(records, options = {}) {
  const opts = Object.assign({}, DEFAULT_OPTIONS, options);
  const theme = THEMES[opts.theme] || THEMES['mail-client'];
  const ordered = sortChronologically(records);

  const pdfDoc = await PDFLib.PDFDocument.create();
  pdfDoc.setTitle(ordered.length + ' email messages');
  pdfDoc.setProducer('BatesStamp.com Email to PDF');

  const fontSet = await loadFontSet(pdfDoc, { family: theme.family });
  const writer = new PageWriter({
    pdfDoc, theme, fontSet,
    footerLeft: ordered.length + ' messages · combined'
  });

  // Page 1 already exists and becomes the first TOC page. Two lines per entry
  // plus the heading, rounded up.
  const usable = theme.page.height - theme.page.margin.top - theme.page.margin.bottom;
  const perPage = Math.max(1, Math.floor(usable / (writer.lineHeight(theme.size.body) * 2.4)) - 2);
  // Reserve one spare page. Under-reserving is not a cosmetic error: entries that
  // run past the last reserved page would call ensure(), which appends a page at
  // the END of the document — a table of contents continuing after the exhibits.
  const tocPageCount = Math.max(1, Math.ceil(ordered.length / perPage)) + 1;
  const tocIndices = [0].concat(tocPageCount > 1 ? writer.reservePages(tocPageCount - 1) : []);

  const perEmail = [];
  const zipFiles = [];
  const allStats = Object.assign({}, EMPTY_STATS);

  for (const record of ordered) {
    writer.newPage();
    const startPage = writer.currentPageIndex + 1;
    writer.markDestination('email-' + perEmail.length);

    const ctx = { indent: 0, quoteDepth: 0, images: record.inlineImages, embedCache: new Map() };
    await drawRecord(writer, record, ctx, allStats);

    const dispositions = new Map();
    for (const att of record.attachments || []) {
      dispositions.set(att.sha256, dispositionFor(att, opts));
      if (dispositions.get(att.sha256) !== 'appended' && opts.zipOtherAttachments && !att.error) {
        zipFiles.push({ name: att.filename, bytes: att.bytes });
      }
    }

    const manifest = manifestBlocks(record, dispositions);
    if (manifest.length) {
      writer.moveDown(theme.spacing.block);
      await drawBlocks(writer, manifest, ctx);
    }

    if (opts.rawHeaderAppendix) {
      writer.newPage();
      await drawBlocks(writer, rawHeaderBlocks(record), ctx);
    }

    if (opts.certificate) {
      writer.newPage();
      await drawBlocks(writer, certificateBlocks(record, {
        pageCount: writer.pageCount,
        bodyPartUsed: record.bodyPartUsed,
        sanitizeStats: allStats,
        substitutions: fontSet.substitutions,
        dispositions,
        defects: record.defects,
        generatedAtUtc: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
      }), ctx);
    }

    perEmail.push({
      subject: record.subject || '(no subject)',
      from: record.from ? (record.from.name || record.from.address) : '(unknown sender)',
      dateRaw: record.date.raw || '(no date header)',
      sourceFilename: record.sourceFilename,
      startPage
    });
  }

  // Fill the reserved table of contents now that every start page is known.
  let tocCursor = 0;
  writer.useExistingPage(tocIndices[0]);
  await drawBlocks(writer, [
    { type: 'heading', level: 2, runs: [styleRun(TOC_TITLE)] },
    { type: 'rule' }
  ], { indent: 0, quoteDepth: 0, images: new Map(), embedCache: new Map() });

  for (let i = 0; i < perEmail.length; i++) {
    const entry = perEmail[i];
    const needed = writer.lineHeight(theme.size.body) * 2.4;
    if (writer.y - needed < writer.bottomLimit) {
      if (tocCursor + 1 < tocIndices.length) {
        tocCursor++;
        writer.useExistingPage(tocIndices[tocCursor]);
      } else {
        // Out of reserved space. Stop rather than spill the contents list to the
        // back of the document, and say so once — an incomplete list that admits
        // it is incomplete is recoverable; one that silently stops is not.
        writer.drawLine(
          tokenizeRunsForToc({ meta: 'Contents continue — ' +
            (perEmail.length - i) + ' further message(s) are not listed here.' }),
          { x: writer.left, size: theme.size.small, color: theme.color.muted }
        );
        break;
      }
    }
    const top = writer.y;
    writer.drawLine(
      tokenizeRunsForToc(entry),
      { x: writer.left, size: theme.size.body }
    );
    writer.drawLine(
      tokenizeRunsForToc({ meta: entry.from + ' · ' + entry.dateRaw }),
      { x: writer.left, size: theme.size.small, color: theme.color.muted }
    );
    writer.linkToDestination('email-' + i, {
      x: writer.left, y: writer.y, width: writer.contentWidth, height: top - writer.y
    });
    writer.moveDown(4);
  }

  writer.finalize();
  const bytes = await pdfDoc.save();
  return { bytes, pageCount: pdfDoc.getPageCount(), perEmail, zipFiles };
}

function tokenizeRunsForToc(entry) {
  const text = entry.meta != null
    ? entry.meta
    : entry.startPage + '.  ' + entry.subject;
  return tokenizeRuns([styleRun(text, entry.meta != null ? {} : { bold: true })]);
}
```

Add the imports this needs at the top of `assemble.js`:

```js
import { tokenizeRuns } from '/shared/pdf/measure.js';
```

- [ ] **Step 5: Run the tests to verify they pass**

Reload. Expected: `PASS 119/119`.

- [ ] **Step 6: Wire combined output into the page**

In `batesstamp/email-to-pdf/index.html`, import `convertBatchCombined` and branch in the click handler before the per-file loop:

```js
        import { convertEmail, convertBatchCombined, DEFAULT_OPTIONS } from '/shared/eml/assemble.js';
```

```js
            const combined = document.querySelector('input[name="output"]:checked').value === 'combined';

            if (combined) {
                const records = [];
                for (let i = 0; i < selectedFiles.length; i++) {
                    const file = selectedFiles[i];
                    progressText.textContent = 'Reading ' + (i + 1) + ' of ' + selectedFiles.length;
                    progressBar.style.width = Math.round((i / selectedFiles.length) * 50) + '%';
                    try {
                        records.push(await parseEml(
                            new Uint8Array(await file.arrayBuffer()), { filename: file.name }));
                    } catch (err) {
                        // A file that cannot be parsed is reported and skipped; the
                        // remaining messages still produce a usable combined exhibit.
                        addResultRow({ name: file.name, note: 'failed — ' + err.message, state: 'error' });
                    }
                }

                if (records.length) {
                    progressText.textContent = 'Building combined PDF';
                    progressBar.style.width = '75%';
                    const out = await convertBatchCombined(records, options);
                    const name = 'combined-emails.pdf';
                    downloadPdf(out.bytes, name);
                    if (typeof sessionFiles !== 'undefined') {
                        sessionFiles.add(name,
                            new Blob([out.bytes], { type: 'application/pdf' }), 'email-to-pdf');
                    }
                    addResultRow({ name, note: out.pageCount + ' pages · ' +
                        out.perEmail.length + ' messages', state: 'ok' });
                    for (const entry of out.zipFiles) zipEntries.push(entry);
                }

                progressBar.style.width = '100%';
                progressText.textContent = 'Done';
                statusEl.className = 'status status-success';
                statusEl.textContent = 'Conversion complete.';
                showPipelineSuggestions('email-to-pdf');
                convertBtn.disabled = false;
                return;
            }
```

- [ ] **Step 7: Verify combined output by hand**

Serve the site, select all ten fixtures, choose *Single combined PDF*, convert. Confirm: the first page is a table of contents, entries are ordered oldest first, clicking an entry jumps to that email, the footer page numbers run continuously, and the failing fixture (if any) appears as a red row rather than aborting the run.

- [ ] **Step 8: Commit**

```bash
git add shared/pdf/writer.js shared/pdf/writer.test.js shared/eml/assemble.js \
        shared/eml/assemble.test.js batesstamp/email-to-pdf/index.html
git commit -m "feat(email-to-pdf): combined batch output with a linked table of contents"
```

---

## Task 17: Site integration

**Files:**
- Modify: `shared/tools.js`
- Modify: `batesstamp/index.html`
- Modify: `batesstamp/sitemap.xml`

**Interfaces:**
- Consumes: `TOOLS`, `TOOL_ICONS`, `TOOL_PIPELINE` (existing globals).
- Produces: the tool appearing in the nav dropdown, the index grid, the sitemap, and the cross-tool pipeline.

- [ ] **Step 1: Register the tool**

In `shared/tools.js`, add to `TOOL_ICONS` (an envelope with a downward arrow, matching the 20×20 stroke style of the others — inline SVG, never an emoji):

```js
  'email-to-pdf': '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="13" rx="2"/><path d="m2 7 10 6 10-6"/><path d="M12 17v5"/><polyline points="9 19 12 22 15 19"/></svg>',
```

Add to `TOOLS`, after `page-extractor`:

```js
  {
    id: 'email-to-pdf',
    name: 'Email to PDF',
    description: 'Convert .eml email files to searchable PDFs with full headers and a certificate of conversion',
    path: '/email-to-pdf/',
    category: 'document',
    umamiEvent: 'convert-email'
  },
```

Add to `TOOL_PIPELINE`:

```js
  'email-to-pdf': ['bates-stamp', 'redaction', 'filing-assembler'],
```

and add `'email-to-pdf'` to the arrays for `bates-stamp`? No — the pipeline runs forward, from a produced PDF to the next tool. Converting is always the first step, so nothing routes *into* it. Leave the other entries unchanged.

- [ ] **Step 2: Add the index card**

In `batesstamp/index.html`, copy the markup of an existing tool card and change its href to `/email-to-pdf/`, its icon to the `email-to-pdf` SVG above, its title to `Email to PDF`, and its description to `Convert .eml email files to searchable PDFs with full headers, an attachment manifest, and a certificate of conversion.` The whole card must be an `<a>` wrapping the content, matching the existing cards — the cards are fully clickable links, not divs with a link inside.

- [ ] **Step 3: Add the sitemap entry**

In `batesstamp/sitemap.xml`, following the shape of the existing entries:

```xml
    <url>
        <loc>https://batesstamp.com/email-to-pdf/</loc>
        <lastmod>2026-09-11</lastmod>
        <changefreq>monthly</changefreq>
        <priority>0.8</priority>
    </url>
```

Do not add `tests.html` — it is already disallowed in `robots.txt` (Task 1).

- [ ] **Step 4: Verify the integration**

```bash
cd /home/ctibs/Projects/legal-tools && bash build.sh --dev
cd batesstamp && python3 -m http.server 8788
```

Confirm: the tool appears in the nav dropdown on every page; the index card is clickable across its whole area and lands on the tool; converting a file then shows pipeline links to Bates Stamper, Redaction and Filing Assembler; clicking Bates Stamper carries the converted PDF across via the session-files dropdown.

- [ ] **Step 5: Commit**

```bash
git add shared/tools.js batesstamp/index.html batesstamp/sitemap.xml
git commit -m "feat(email-to-pdf): register the tool in nav, index, sitemap and pipeline"
```

---

## Task 18: Verification checklist and close-out

The tests cover structure. This task covers everything a test cannot see, and is the last gate before the work is called done.

**Files:**
- Create: `docs/verification/2026-09-11-email-to-pdf-checklist.md`
- Modify: `README.md`

- [ ] **Step 1: Run the whole suite and record the result**

```bash
cd /home/ctibs/Projects/legal-tools && bash build.sh --dev
cd batesstamp && python3 -m http.server 8788
```

Open `http://localhost:8788/email-to-pdf/tests.html`. Record the exact tab title in the checklist below. Do not proceed while any test fails, and do not weaken an assertion to make it pass.

- [ ] **Step 2: Write the checklist**

```markdown
# Email to PDF — verification checklist

Run against the fixture corpus after any change to the conversion pipeline.
This is manual verification made repeatable — **not** automated regression.
Do not describe it as a test suite in commit messages or documentation.

Setup: `bash build.sh --dev`, then serve `batesstamp/` and open `/email-to-pdf/`.
Drive it by hand or with Playwright — the spec allows either; what matters is that
the same fixtures are exercised in the same order every time and that a human looks
at the resulting PDFs, which is the part no driver can do.

## Automated first

- [ ] `python3 docs/fixtures/eml/generate.py` has been run (fixture 07 is
      gitignored and absent on a fresh clone; its tests fail with a clear
      "fixture not found" message until it is generated).
- [ ] `/email-to-pdf/tests.html` reports PASS with zero failures. Result: __________

## Rendering — check in all three styles

- [ ] `02-html-nested-quotes.eml` — three quote levels each indented one step
      further, each with a rail; the signature block's line breaks survive.
- [ ] `08-outlook-tables.eml` — all four rows and four columns present; the nested
      table inside the disputed cell renders; no row is lost at a page break.
- [ ] `01-plain-text.eml` — the indented list lines keep their alignment; two
      quote levels distinguishable.
- [ ] `05-encoded-word-subject.eml` — Cyrillic renders as letters, not boxes; the
      CJK sentence shows replacement characters **and** the certificate reports the
      substitution count.
- [ ] `03-inline-cid-image.eml` — the inline image appears in the body.
- [ ] `10-headers-only.eml` — renders a header block and the "no body text" note.

## Evidence

- [ ] Footer on every page: filename, 12-char hash, `page n of N`, with N equal to
      the real page count.
- [ ] Header appendix reproduces the Received chain verbatim, including the IP;
      wrapped long headers are visibly continuations.
- [ ] Certificate lists: tool version, UTC timestamp, full source SHA-256,
      Message-ID, the raw Date header, page count, attachment count, body part used.
- [ ] `09-remote-images.eml` — certificate reports 2 blocked remote images
      including 1 tracking pixel; the body shows labeled placeholders, not gaps.
- [ ] `07-large-pdf-attachment.eml` — manifest shows the filename, type, size and
      full hash; the attachment's pages follow a labeled separator page.
- [ ] On those merged attachment pages, the stamped footer does not overprint
      content already in the page's bottom margin.
- [ ] Dates print with their original offset. Convert `01-plain-text.eml` in a
      machine set to a non-Pacific time zone and confirm it still reads
      `Tue, 4 Mar 2026 09:14:22 -0800`.
- [ ] Turn off each evidence option in turn and confirm the corresponding section
      disappears and nothing else changes.
- [ ] `embedSource` on — open the PDF in a reader that shows attachments and
      confirm the `.eml` is there and opens.

## Searchability

- [ ] Select body text in a PDF reader and copy it; the clipboard contains the
      same words.
- [ ] `Ctrl-F` a phrase spanning a line break; it is found.
- [ ] Open the converted PDF in the Bates Stamper and stamp it; the stamp applies
      and the text layer survives.

## Batch

- [ ] All ten fixtures at once, one PDF per email: a single `converted-emails.zip`
      containing ten PDFs with dated, unique filenames — not ten separate
      downloads, which the browser would block.
- [ ] A single file converts to a direct PDF download, not a ZIP.
- [ ] Same ten combined: TOC first, oldest first, TOC links jump correctly,
      footer numbering continuous.
- [ ] Introduce a deliberately corrupt file (`head -c 200 /dev/urandom > bad.eml`)
      into the batch: it appears as a red failure row, every other file still
      converts, and the run completes.

## Privacy

- [ ] With the browser devtools Network tab open and filtered to All, convert
      `09-remote-images.eml`. **No request** is made to any `marketing.example`
      host, and no request carries email content anywhere.
- [ ] The preview pane's links are not clickable.

## Responsiveness and accessibility

- [ ] At 400px width the options and preview remain usable and nothing overflows
      horizontally.
- [ ] The drop zone is reachable and operable by keyboard.
- [ ] No emoji anywhere in the UI or the output.
```

- [ ] **Step 3: Work the checklist and fix what it finds**

Any failure is a bug in the implementation, not in the checklist. Fix it, re-run the affected tests, and re-check the item.

- [ ] **Step 4: Update the README**

Add to the site table in `README.md` under the BatesStamp row's tool list, and note the two new vendored dependencies and the `--dev` build flag:

```markdown
### Development

`bash build.sh` copies shared assets into `batesstamp/`. Add `--dev` to also stage
the `.eml` test fixtures at `batesstamp/fixtures/` for the Email to PDF test page
at `/email-to-pdf/tests.html` — never run `--dev` for a deployed build.

Serve `batesstamp/` over `http://localhost` (not `file://`) — `crypto.subtle`,
which the Email to PDF tool uses for hashing, requires a secure context.

Vendored dependencies live in `batesstamp/vendor/` with their provenance and
hashes recorded in `batesstamp/vendor/README.md`.
```

- [ ] **Step 5: Final commit**

```bash
git add docs/verification/ README.md
git commit -m "docs: verification checklist and development notes for email-to-pdf"
```

- [ ] **Step 6: Deploy check**

Push and confirm the Cloudflare Pages build succeeds with the plain `bash build.sh` command (no `--dev`), then verify on the live site that `/email-to-pdf/` loads, `/email-to-pdf/tests.html` returns the page but is disallowed in `robots.txt`, and `/fixtures/` returns 404 — the fixtures must not be on the public site.
