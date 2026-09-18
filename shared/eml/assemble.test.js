import { test, assert, assertEqual, extractPdfText, extractPdfTextItems }
  from '/shared/testing/harness.js';
import { loadFixture } from '/shared/testing/fixtures.js';
import { parseEml } from './parse.js';
import { convertEmail, convertBatchCombined, DEFAULT_OPTIONS } from './assemble.js';

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
  assert(out.zipFiles.some((z) => z.name === 'damaged.pdf'),
    'the bytes still reach the user via the ZIP');
});
