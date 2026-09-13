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
