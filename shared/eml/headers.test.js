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
