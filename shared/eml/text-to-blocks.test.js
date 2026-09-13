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
