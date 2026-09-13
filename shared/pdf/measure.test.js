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
