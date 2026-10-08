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

test('a forwarded message with no Content-Disposition is still preserved as nested', async () => {
  const rec = await parseEml(await loadFixture('11-inline-forwarded.eml'),
    { filename: '11-inline-forwarded.eml' });
  assertEqual(rec.nested.length, 1);
  assertEqual(rec.nested[0].subject, 'Delivery schedule');
  // The forwarded message's own date, with its own offset, is the point.
  assertEqual(rec.nested[0].date.raw, 'Tue, 4 Mar 2026 09:14:22 -0800');
});

test('an empty body is reported as such, not as a failure', async () => {
  const rec = await parseEml(await loadFixture('10-headers-only.eml'));
  assertEqual(rec.bodyPartUsed, 'none');
  assertEqual(rec.subject, 'Read receipt');
  assertEqual(rec.defects.length, 0);
});

async function rejects(promise) {
  try { await promise; } catch (e) { return e; }
  return null;
}

test('random bytes are refused, not converted into a blank message', async () => {
  // RFC 822 has no magic bytes, and any line containing a colon used to count
  // as a header — so 200 random bytes produced a PDF of a message with no
  // sender, date or subject, dressed as an exhibit. Seeded, so the same bytes
  // run every time; enough runs that one lucky "x:" line cannot carry it.
  let seed = 0x2f6b;
  const rand = () => (seed = (seed * 1103515245 + 12345) >>> 0) >>> 24;
  for (let run = 0; run < 20; run++) {
    const bytes = new Uint8Array(200);
    for (let i = 0; i < bytes.length; i++) bytes[i] = rand();
    const err = await rejects(parseEml(bytes, { filename: 'bad.eml' }));
    assert(err, 'run ' + run + ': random bytes must be refused');
  }
});

test('text with a colon but no email header is refused', async () => {
  const bytes = new TextEncoder().encode(
    'Meeting notes\nAgenda: budget, staffing\nNext: Thursday\n\nnothing else\n');
  const err = await rejects(parseEml(bytes));
  assert(err, 'a notes file is not an email');
  assert(/not appear to be a \.eml/.test(err.message), 'got: ' + err.message);
});

test('a sparse but genuine message with one standard header still converts', async () => {
  const rec = await parseEml(new TextEncoder().encode('Subject: Hello\n\nBody text\n'));
  assertEqual(rec.subject, 'Hello');
});
