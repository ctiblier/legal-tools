import { test, assert, assertEqual } from '/shared/testing/harness.js';
import { dispositionFor, manifestBlocks } from './manifest.js';
import { certificateBlocks, rawHeaderBlocks } from './certificate.js';
import { outputFilename, zipEntryName } from './filename.js';
import { loadFixture } from '/shared/testing/fixtures.js';
import { parseEml } from './parse.js';

const textOf = (blocks) => JSON.stringify(blocks);
// The removed-element limitation as it will read on the page. JSON tells you the
// bytes; this tells you the sentence, so an assertion failure shows what a
// reader would actually see. List items hold paragraphs, paragraphs hold runs.
const removedSentence = (blocks) => blocks
  .filter((b) => b.type === 'list')
  .flatMap((b) => b.items)
  .map((item) => item.map((p) => (p.runs || []).map((r) => r.text).join('')).join(' '))
  .find((t) => t.includes('removed')) || '(no removed-element sentence)';

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
  assert(/\d+(\.\d+)? (B|KB|MB)/.test(out), 'a formatted size is rendered');
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

test('the raw header appendix reproduces the header block verbatim', async () => {
  const rec = await parseEml(await loadFixture('01-plain-text.eml'));
  const blocks = rawHeaderBlocks(rec);
  const pre = blocks.find((b) => b.type === 'preformatted');
  assert(pre, 'the appendix uses a preformatted block');
  // Byte-for-byte against the source block, modulo the CRLF->LF normalisation
  // the renderer needs. A re-serialization from parsed values would not match.
  assertEqual(pre.text, rec.rawHeaderBlock.replace(/\r\n/g, '\n'));
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
  // Assert the disclosure sentences themselves, not bare digits that other
  // fields (the page count, the source hash) also happen to contain.
  assert(out.includes('2 remote image(s) were not loaded'), 'blocked image count disclosed');
  assert(out.includes('1 were tracking pixels'), 'tracking pixels disclosed');
  assert(out.includes('3 character(s) could not be rendered'), 'substitution count disclosed');
  assert(out.includes(rec.sourceSha256), 'full source hash present');
  assert(out.toLowerCase().includes('html'), 'body part disclosed');
});

test('the certificate names only what was actually removed, not scripts of meta tags', async () => {
  const rec = await parseEml(await loadFixture('01-plain-text.eml'));
  const blocks = certificateBlocks(rec, {
    pageCount: 1, bodyPartUsed: 'html',
    sanitizeStats: { remoteImagesBlocked: 0, trackingPixelsBlocked: 0,
                     activeContentRemoved: 1, scriptStyleRemoved: 0,
                     otherActiveRemoved: 1, unresolvedCidImages: 0 },
    substitutions: 0, dispositions: new Map(), defects: [],
    generatedAtUtc: '2026-09-11T12:00:00Z'
  });
  const out = textOf(blocks);
  assertEqual(removedSentence(blocks),
    '1 other active or embedded element(s) (such as meta tags, forms, frames or ' +
    'embedded objects) were removed. Style sheets are not applied; the layout of ' +
    'the body is a reconstruction, not a screenshot.');
  assert(!out.includes('script or style'), 'no script claim when no script was removed');
  // The total (1) must not sit in front of the breakdown either; it used to, and
  // the certificate read "1 1 other active ...".
  assert(!out.includes('1 1 '), 'total not doubled ahead of the breakdown: ' +
    removedSentence(blocks));
});

test('the certificate splits both kinds when both were removed', async () => {
  const rec = await parseEml(await loadFixture('01-plain-text.eml'));
  const blocks = certificateBlocks(rec, {
    pageCount: 1, bodyPartUsed: 'html',
    sanitizeStats: { remoteImagesBlocked: 0, trackingPixelsBlocked: 0,
                     activeContentRemoved: 3, scriptStyleRemoved: 2,
                     otherActiveRemoved: 1, unresolvedCidImages: 0 },
    substitutions: 0, dispositions: new Map(), defects: [],
    generatedAtUtc: '2026-09-11T12:00:00Z'
  });
  const out = textOf(blocks);
  // The sentence opens with the breakdown, and with nothing in front of it.
  assertEqual(removedSentence(blocks),
    '2 script or style element(s) and 1 other active or embedded element(s) (such ' +
    'as meta tags, forms, frames or embedded objects) were removed. Style sheets ' +
    'are not applied; the layout of the body is a reconstruction, not a screenshot.');
  assert(out.includes('2 script or style element(s)'), 'script count named');
  assert(out.includes('1 other active or embedded element(s)'), 'other count named');
  // The total (3) is not printed at all: it used to lead the sentence, which
  // read as "3 2 script or style element(s)".
  assert(!out.includes('3 2 '), 'total not doubled ahead of the breakdown: ' +
    removedSentence(blocks));
});

test('the old stats shape is reported as other, never as scripts', async () => {
  const rec = await parseEml(await loadFixture('01-plain-text.eml'));
  const blocks = certificateBlocks(rec, {
    pageCount: 1, bodyPartUsed: 'html',
    sanitizeStats: { remoteImagesBlocked: 0, trackingPixelsBlocked: 0,
                     activeContentRemoved: 1, unresolvedCidImages: 0 },
    substitutions: 0, dispositions: new Map(), defects: [],
    generatedAtUtc: '2026-09-11T12:00:00Z'
  });
  const out = textOf(blocks);
  assertEqual(removedSentence(blocks),
    '1 other active or embedded element(s) (such as meta tags, forms, frames or ' +
    'embedded objects) were removed. Style sheets are not applied; the layout of ' +
    'the body is a reconstruction, not a screenshot.');
  assert(!out.includes('script or style'), 'an unbroken-down total is not called scripts');
  assert(!out.includes('1 1 '), 'total not doubled ahead of the breakdown: ' +
    removedSentence(blocks));
});

test('a script-only removal is stated as scripts, with no other-kind clause', async () => {
  const rec = await parseEml(await loadFixture('01-plain-text.eml'));
  const blocks = certificateBlocks(rec, {
    pageCount: 1, bodyPartUsed: 'html',
    sanitizeStats: { remoteImagesBlocked: 0, trackingPixelsBlocked: 0,
                     activeContentRemoved: 2, scriptStyleRemoved: 2,
                     otherActiveRemoved: 0, unresolvedCidImages: 0 },
    substitutions: 0, dispositions: new Map(), defects: [],
    generatedAtUtc: '2026-09-11T12:00:00Z'
  });
  const out = textOf(blocks);
  assertEqual(removedSentence(blocks),
    '2 script or style element(s) were removed. Style sheets are not applied; the ' +
    'layout of the body is a reconstruction, not a screenshot.');
  assert(!out.includes('other active or embedded'), 'no other-kind claim when none were');
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

test('zipEntryName neutralises names Windows refuses to extract', () => {
  const taken = new Set();
  for (const name of ['CON.txt', 'nul', 'COM1.pdf', 'lpt9.doc']) {
    const out = zipEntryName(name, taken);
    assert(!/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i.test(out), name + ' -> ' + out);
  }
});

test('zipEntryName strips control and bidi characters', () => {
  const out = zipEntryName('inv\u202Efdp.exe\u0007\u0085', new Set());
  assert(!/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(out),
    'got ' + JSON.stringify(out));
  assert(out.endsWith('.exe'), 'the true extension stays visible: ' + out);
});

test('zipEntryName keeps names within 255 bytes, extension intact', () => {
  const out = zipEntryName('\u00e9'.repeat(300) + '.pdf', new Set());
  assert(new TextEncoder().encode(out).length <= 255, 'bytes ' + new TextEncoder().encode(out).length);
  assert(out.endsWith('.pdf'), out);
});

test('zipEntryName dedupes canonically equivalent Unicode names', () => {
  const taken = new Set();
  const a = zipEntryName('caf\u00e9.txt', taken);
  const b = zipEntryName('cafe\u0301.txt', taken);
  assert(a.normalize('NFC') !== b.normalize('NFC'), a + ' vs ' + b);
});
