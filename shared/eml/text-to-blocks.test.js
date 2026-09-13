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
