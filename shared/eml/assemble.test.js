import { test, assert, assertEqual, extractPdfText, extractPdfTextItems }
  from '/shared/testing/harness.js';
import { loadFixture } from '/shared/testing/fixtures.js';
import { parseEml } from './parse.js';
import { convertEmail, convertBatchCombined, DEFAULT_OPTIONS } from './assemble.js';
import { THEMES } from './themes.js';

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

test('the certificate reports message-content pages, not the whole document', async () => {
  const out = await convertFixture('01-plain-text.eml');
  const doc = await PDFLib.PDFDocument.load(out.bytes);
  assert(out.summary.pageCount < doc.getPageCount(),
    'message-content pages (' + out.summary.pageCount + ') must be fewer than the ' +
    'document total (' + doc.getPageCount() + '), which includes appendix and certificate');
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

test('appending a PDF adds its separator and its pages, and nothing else', async () => {
  // "More pages than before" passes even when a stray blank page is emitted, so
  // count them exactly: one labelled separator page plus the attachment's own
  // pages. A blank page in an exhibit invites the question of what was on it.
  const name = '07-large-pdf-attachment.eml';
  const withAppend = await convertFixture(name);
  const without = await convertFixture(name, { appendAttachments: false });

  const rec = await parseEml(await loadFixture(name), { filename: name });
  const src = await PDFLib.PDFDocument.load(rec.attachments[0].bytes,
    { ignoreEncryption: true });

  assertEqual(withAppend.pageCount, without.pageCount + 1 + src.getPageCount());
});

test('a long table-of-contents entry wraps instead of running off the page', async () => {
  // drawLine takes one ALREADY-WRAPPED line and draws every token it is given,
  // so an unwrapped entry ran straight past the right margin and off the sheet
  // — unmarked, which §3.3 treats as worse than an ellipsis. Long subjects are
  // the norm in litigation email. extractPdfText cannot catch this: off-page
  // text extracts perfectly well, so assert on position.
  const rec = await parseEml(await loadFixture('01-plain-text.eml'),
    { filename: 'long-subject.eml' });
  rec.subject = 'Re: Fwd: Smith v. Acme Manufacturing — deposition of the ' +
    'corporate representative and production of documents responsive to ' +
    'requests fourteen through twenty-two, as discussed';

  const out = await convertBatchCombined([rec], DEFAULT_OPTIONS);
  const pages = await extractPdfTextItems(out.bytes);

  const theme = THEMES[DEFAULT_OPTIONS.theme];
  const limit = theme.page.width - theme.page.margin.right + 1;

  const overflowing = pages[0].filter((it) => it.x > limit);
  assertEqual(overflowing.map((it) => it.str + '@x=' + Math.round(it.x)).join(' | '), '',
    'no contents text may be drawn past the right margin (' + Math.round(limit) + 'pt)');
});

test('the contents list never spills past its reserved pages', async () => {
  // Many messages with long wrapping subjects is the case that overruns the
  // reservation. If the list runs out of reserved space, drawLine's ensure()
  // appends a page at the END of the document — a table of contents printed
  // after the exhibits. It must stop and say so instead.
  const records = [];
  for (let i = 0; i < 40; i++) {
    const rec = await parseEml(await loadFixture('01-plain-text.eml'),
      { filename: 'msg-' + i + '.eml' });
    rec.subject = 'Re: Fwd: Smith v. Acme Manufacturing — deposition of the ' +
      'corporate representative and production of documents responsive to ' +
      'requests fourteen through twenty-two, item ' + i;
    rec.date = Object.assign({}, rec.date,
      { parsed: new Date(Date.UTC(2026, 0, 1 + i)) });
    records.push(rec);
  }

  const out = await convertBatchCombined(records, DEFAULT_OPTIONS);
  const pages = await extractPdfTextItems(out.bytes);

  // Find where the exhibits start: the first page showing a message header.
  const firstExhibit = pages.findIndex((items) =>
    items.some((it) => it.str.includes('jsmith@acme-manufacturing.example')));
  assert(firstExhibit > 0, 'the exhibits were drawn');

  // No page at or after the exhibits may carry contents-list text.
  const strays = [];
  for (let i = firstExhibit; i < pages.length; i++) {
    const text = pages[i].map((it) => it.str).join(' ');
    if (text.includes('Contents') || text.includes('Contents continue')) {
      strays.push('page ' + (i + 1));
    }
  }
  assertEqual(strays.join(', '), '',
    'contents text must not appear after the exhibits begin');
});

test('embedSource attaches every source file in a combined PDF', async () => {
  // The combined path had no attach() call at all, so ticking "Embed the
  // original .eml" produced a PDF with nothing embedded and no indication that
  // the option had done nothing. A silently no-op option is the failure mode
  // §3.5 exists to forbid.
  const a = await parseEml(await loadFixture('01-plain-text.eml'),
    { filename: '01-plain-text.eml' });
  const b = await parseEml(await loadFixture('02-html-nested-quotes.eml'),
    { filename: '02-html-nested-quotes.eml' });

  const out = await convertBatchCombined([a, b],
    Object.assign({}, DEFAULT_OPTIONS, { embedSource: true }));

  const doc = await PDFLib.PDFDocument.load(out.bytes);
  const names = doc.catalog.get(PDFLib.PDFName.of('Names'));
  assert(names, 'the document declares an embedded-files name tree');

  const text = await extractPdfText(out.bytes);
  assert(!text.includes('undefined'), 'no placeholder leaked into the output');
  assertEqual(out.embeddedSources.slice().sort().join(','),
    '01-plain-text.eml,02-html-nested-quotes.eml');
});

test('combined-batch ZIP entries do not collide across messages', async () => {
  // The per-email path prefixes each entry with the output PDF's stem. The
  // combined path pushed the bare MIME filename, so two messages attaching
  // invoice.pdf produced two identically-named JSZip entries and the user
  // extracted one file — silent loss of the evidence bytes the ZIP exists to
  // deliver.
  const a = await parseEml(await loadFixture('07-large-pdf-attachment.eml'),
    { filename: 'first.eml' });
  const b = await parseEml(await loadFixture('07-large-pdf-attachment.eml'),
    { filename: 'second.eml' });

  const out = await convertBatchCombined([a, b],
    Object.assign({}, DEFAULT_OPTIONS, { appendAttachments: false }));

  assertEqual(out.zipFiles.length, 2, 'both attachments are collected');
  const names = out.zipFiles.map((f) => f.name);
  assertEqual(new Set(names).size, 2, 'entry names are unique; got ' + names.join(', '));
});

test('an HTML part that renders to nothing falls back to the text part', async () => {
  // bodyPartUsed is chosen on truthiness, so an HTML part containing only
  // structure selects 'html'; htmlToBlocks then yields no blocks and the body
  // is blank, while the certificate still states the body was rendered from the
  // HTML part and a perfectly good text/plain part goes unused. Blank body plus
  // a certificate asserting otherwise is the exact shape §3.5 forbids.
  const raw = new TextEncoder().encode([
    'Message-ID: <empty-html@firm.example>',
    'Date: Mon, 16 Mar 2026 12:00:00 -0700',
    'From: Robert Jones <counsel@firm.example>',
    'To: John Smith <jsmith@acme-manufacturing.example>',
    'Subject: Structure-only HTML part',
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="alt"',
    '',
    '--alt',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'THE TEXT PART CARRIES THE ACTUAL MESSAGE.',
    '',
    '--alt',
    'Content-Type: text/html; charset=utf-8',
    '',
    '<html><body></body></html>',
    '',
    '--alt--',
    ''
  ].join('\r\n'));

  const rec = await parseEml(raw, { filename: 'empty-html.eml' });
  const out = await convertEmail(rec, DEFAULT_OPTIONS);
  const text = await extractPdfText(out.bytes);

  assert(text.includes('THE TEXT PART CARRIES THE ACTUAL MESSAGE'),
    'the text part is rendered rather than a blank body');
  assert(out.summary.defects.some((d) => d.code === 'BODY_PART_EMPTY'),
    'the substitution is disclosed on the certificate');
});

test('each certificate in a combined PDF describes its own message only', async () => {
  // convertEmail is careful to capture message-content pages before the
  // manifest, appendix and certificate are drawn. The combined path passed
  // writer.pageCount and one shared stats object, so every certificate reported
  // a running total of the whole document and inherited every earlier message's
  // limitations. Ordering the message WITH blocked remote images first is what
  // makes the leak visible: the second message has no images at all.
  const withImages = await parseEml(await loadFixture('09-remote-images.eml'),
    { filename: '09-remote-images.eml' });
  const plain = await parseEml(await loadFixture('01-plain-text.eml'),
    { filename: '01-plain-text.eml' });

  // 09 is dated after 01, and combined output sorts oldest first, so force the
  // order this test needs by overriding the parsed dates.
  withImages.date = Object.assign({}, withImages.date, { parsed: new Date('2026-03-01T00:00:00Z') });
  plain.date = Object.assign({}, plain.date, { parsed: new Date('2026-04-01T00:00:00Z') });

  const out = await convertBatchCombined([withImages, plain], DEFAULT_OPTIONS);
  const doc = await PDFLib.PDFDocument.load(out.bytes);
  const pages = await extractPdfTextItems(out.bytes);

  const certPages = pages
    .map((items, i) => ({ i, text: items.map((it) => it.str).join(' ') }))
    .filter((p) => p.text.includes('Certificate of conversion'));
  assertEqual(certPages.length, 2, 'one certificate per message');

  // The second message has no remote images; its certificate must not claim any.
  assert(certPages[0].text.includes('remote image'),
    'the first message did block remote images');
  assert(!certPages[1].text.includes('remote image'),
    'the plain-text message\'s certificate must not inherit the first ' +
    'message\'s blocked images');

  // Neither certificate may report a page count larger than the document.
  for (const p of certPages) {
    const m = p.text.match(/Pages of message content (\d+)/);
    assert(m, 'the certificate states a page count');
    assert(Number(m[1]) < doc.getPageCount(),
      'message-content pages (' + m[1] + ') must be fewer than the document ' +
      'total (' + doc.getPageCount() + '); got a running total instead');
  }
});

test('the certificate counts each substituted character exactly once', async () => {
  // fonts.test.js exercises segment() directly, so it cannot see that the
  // drawing path calls segment() twice per token — once to measure and once to
  // draw — and that hardBreak() measures once per character against a growing
  // buffer. Only an end-to-end assertion against a known fixture catches it.
  //
  // 05-encoded-word-subject.eml's body carries exactly one CJK sentence,
  // 契約書の翻訳を添付します。 — 13 characters, none of them covered by
  // Liberation or DejaVu. The certificate must say 13.
  const out = await convertFixture('05-encoded-word-subject.eml');
  assertEqual(out.summary.substitutions, 13);

  const text = await extractPdfText(out.bytes);
  assert(text.includes('13 character(s) could not be rendered'),
    'the certificate reports 13 substitutions; got: ' +
    (text.match(/\d+ character\(s\) could not be rendered/) || ['no such line'])[0]);
});

test('an attachment page carrying /Rotate is appended in its display orientation', async () => {
  // Fixture 14's attached page is a portrait MediaBox with /Rotate 90 — a
  // landscape scan, which is what scanners and fax gateways produce. pdf-lib's
  // copyPages carried /Rotate on the page dictionary; embedPdf reports the
  // UNROTATED box and drawPage defaults to no rotation, so the exhibit came out
  // upright and wrongly scaled. Text drawn horizontally in page space must end
  // up rotated on the sheet: pdf.js reports a rotated text item with non-zero
  // off-diagonal terms in its transform.
  const out = await convertFixture('14-attachment-rotated.eml');
  // pdf.js transfers the buffer it is handed to its worker, which detaches it —
  // so a second getDocument on the same bytes sees an empty array. Always give
  // it a copy when the bytes are needed more than once.
  const doc = await pdfjsLib.getDocument({ data: out.bytes.slice() }).promise;
  let found = null;
  for (let i = 1; i <= doc.numPages; i++) {
    const items = (await (await doc.getPage(i)).getTextContent()).items;
    const hit = items.find((it) => it.str.includes('ROTATED TOP LINE'));
    if (hit) { found = hit; break; }
  }
  assert(found, 'the rotated attachment\'s text is present in the output');

  const [a, b, c, d] = found.transform;
  assert(Math.abs(b) > 0.01 || Math.abs(c) > 0.01,
    'the attachment text must be rotated on the page; got transform ' +
    JSON.stringify([a, b, c, d]) + ' (no rotation applied)');
});

test('the page footer does not overprint an attachment\'s bottom margin', async () => {
  // Fixture 13 carries text at y=36 and y=24 of its attached PDF, which is
  // exactly where the footer is stamped. The footer goes on every page on
  // purpose — continuous numbering is what lets a loose page be placed back —
  // so the attachment's content is scaled up out of the band rather than the
  // footer being omitted. Nothing may share the footer's line.
  const out = await convertFixture('13-attachment-bottom-margin.eml');
  const pages = await extractPdfTextItems(out.bytes);

  const page = pages.find((items) =>
    items.some((it) => it.str.includes('ATTACHMENT BOTTOM LINE ONE')));
  assert(page, 'the attachment page is present in the output');

  const footer = page.find((it) => /^page \d+ of \d+$/.test(it.str.trim()));
  assert(footer, 'the attachment page carries a page footer');

  const collisions = page
    .filter((it) => it !== footer && !it.str.includes('.eml'))
    .filter((it) => Math.abs(it.y - footer.y) < 9)
    .map((it) => it.str);

  assertEqual(collisions.join(' | '), '');
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
  const text = await extractPdfText(out.bytes);
  // The placeholder label is what a failed embed draws. Its absence is the
  // only evidence that the image actually made it into the page.
  assert(!text.includes('image could not be rendered'),
    'no placeholder was drawn for a resolvable inline image');
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

test('a salvaged broken-base64 body keeps its readable text and discloses the rest', async () => {
  // This used to skip itself: it returned early unless the parser reported
  // BODY_DECODE_FAILED, and postal-mime salvages fixture 04 instead — so the
  // body of the test never ran. Its assertion could not have failed either,
  // being a NEGATIVE substring check against compressed PDF bytes, where no
  // body text is findable at all. Assert what actually happens.
  const out = await convertFixture('04-broken-base64.eml');
  const text = await extractPdfText(out.bytes);

  assert(text.includes('This is the readable opening line'),
    'the salvageable part of the body is rendered');
  assert(!text.includes('contained no body text'),
    'a partly-readable body is never described as empty');
  assert(out.summary.substitutions > 0,
    'the undecodable remainder is disclosed as substituted characters');
});

test('a body that genuinely failed to decode says so, not "no body text"', async () => {
  // No fixture reaches this branch — postal-mime salvages even deliberately
  // broken base64 — so drive it directly. Saying "this message contained no
  // body text" when the truth is "the body could not be decoded" misstates the
  // evidence: spec §7 requires a lawyer to learn the message exists even when
  // its body is unreadable.
  const rec = await parseEml(await loadFixture('10-headers-only.eml'),
    { filename: 'undecodable.eml' });
  assertEqual(rec.bodyPartUsed, 'none', 'starting from a record with no body');
  rec.defects.push({
    code: 'BODY_DECODE_FAILED',
    detail: 'invalid base64 in the text/plain part'
  });

  const out = await convertEmail(rec, DEFAULT_OPTIONS);
  const text = await extractPdfText(out.bytes);

  assert(text.includes('could not be decoded'),
    'the decode failure is stated in the body');
  assert(!text.includes('contained no body text'),
    'the two facts are not confused');
});

test('a headers-only email still converts', async () => {
  const out = await convertFixture('10-headers-only.eml');
  assert(out.pageCount >= 1, 'produced at least one page');
  assertEqual(out.summary.bodyPartUsed, 'none');
});

test('a forwarded message renders its nested record', async () => {
  const out = await convertFixture('06-forwarded-message.eml');
  const text = await extractPdfText(out.bytes);
  assert(text.includes('Delivery schedule'), "the nested message's subject rendered");
  // The nested message's own date, with its own offset, is the evidence that
  // matters most in a forwarded chain.
  assert(text.includes('Tue, 4 Mar 2026 09:14:22 -0800'),
    "the nested message's own date rendered verbatim");
});

test('an unmergeable PDF attachment is disclosed, not silently dropped', async () => {
  const rec = await parseEml(await loadFixture('12-corrupt-pdf-attachment.eml'),
    { filename: '12-corrupt-pdf-attachment.eml' });
  const out = await convertEmail(rec, DEFAULT_OPTIONS);
  const att = rec.attachments.find((a) => a.filename === 'damaged.pdf');
  assert(att, 'the attachment is still listed on the record');
  assertEqual(out.summary.dispositions.get(att.sha256), 'unreadable');
  assert(att.error, 'an error was recorded on the attachment');
  assert(out.summary.defects.some((d) => d.code === 'ATTACHMENT_UNREADABLE'),
    'a defect reached the certificate');
  assert(out.zipFiles.some((z) => z.name === 'damaged.pdf'),
    'the bytes still reach the user via the ZIP');
});

test('the summary carries everything the certificate needs', async () => {
  const out = await convertFixture('09-remote-images.eml');
  for (const key of ['pageCount', 'bodyPartUsed', 'sanitizeStats', 'substitutions',
                     'dispositions', 'defects', 'generatedAtUtc']) {
    assert(out.summary[key] !== undefined, 'summary.' + key + ' present');
  }
});

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

test('the combined table of contents actually renders each email\'s entry', async () => {
  const names = ['01-plain-text.eml', '02-html-nested-quotes.eml', '10-headers-only.eml'];
  const records = [];
  for (const n of names) records.push(await parseEml(await loadFixture(n), { filename: n }));
  const out = await convertBatchCombined(records, DEFAULT_OPTIONS);
  const text = await extractPdfText(out.bytes);
  assert(text.includes('Contents'), 'the contents heading rendered');
  for (const e of out.perEmail) {
    assert(text.includes(e.subject), 'entry rendered for: ' + e.subject);
  }
});

test('a combined PDF appends attachments, and the manifest does not lie', async () => {
  const names = ['07-large-pdf-attachment.eml', '01-plain-text.eml'];
  const records = [];
  for (const n of names) records.push(await parseEml(await loadFixture(n), { filename: n }));
  const out = await convertBatchCombined(records, DEFAULT_OPTIONS);
  const doc = await PDFLib.PDFDocument.load(out.bytes);

  const withAttachment = records.find((r) => r.attachments.length);
  const att = withAttachment.attachments[0];
  assert(att, 'the fixture actually has an attachment to test against');

  const withoutAttachment = await convertBatchCombined(records,
    Object.assign({}, DEFAULT_OPTIONS, { appendAttachments: false }));
  const docWithout = await PDFLib.PDFDocument.load(withoutAttachment.bytes);
  assert(doc.getPageCount() > docWithout.getPageCount(),
    'the merged attachment added pages: got ' + doc.getPageCount() +
    ' vs ' + docWithout.getPageCount() + ' without it');

  const text = await extractPdfText(out.bytes);
  assert(text.includes('executed-agreement.pdf'), 'the attachment is named in the document');
});

test('a combined PDF discloses an unmergeable attachment rather than dropping it', async () => {
  const n = '12-corrupt-pdf-attachment.eml';
  const rec = await parseEml(await loadFixture(n), { filename: n });
  const out = await convertBatchCombined([rec], DEFAULT_OPTIONS);
  const att = rec.attachments.find((a) => a.filename === 'damaged.pdf');
  assert(att.error, 'an error was recorded on the attachment');
  // Combined-mode entries are namespaced per message so two messages attaching
  // the same filename cannot overwrite each other — match the leaf name.
  assert(out.zipFiles.some((z) => z.name.endsWith('damaged.pdf')),
    'the bytes still reach the user via the ZIP; got ' +
    out.zipFiles.map((z) => z.name).join(', '));
});
