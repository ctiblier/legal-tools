import { test, assert, assertEqual, extractPdfText } from '/shared/testing/harness.js';
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
