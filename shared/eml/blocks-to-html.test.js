import { test, assert, assertEqual } from '/shared/testing/harness.js';
import { blocksToHtml, PREVIEW_MAX_GRID } from './blocks-to-html.js';

const run = (text, extra) => Object.assign({
  text, bold: false, italic: false, underline: false, strike: false,
  color: null, sizeScale: 1, href: null
}, extra || {});

test('escapes HTML in email text so a preview cannot inject markup', () => {
  const html = blocksToHtml([{ type: 'paragraph', runs: [run('<script>alert(1)</script>')] }],
    { images: new Map() });
  assert(!html.includes('<script>'), 'script tag escaped');
  assert(html.includes('&lt;script&gt;'), 'rendered as visible text');
});

test('bold and italic runs become semantic elements', () => {
  const html = blocksToHtml([{ type: 'paragraph',
    runs: [run('a', { bold: true }), run('b', { italic: true })] }], { images: new Map() });
  assert(html.includes('<strong>'), 'bold rendered');
  assert(html.includes('<em>'), 'italic rendered');
});

test('links are rendered inert — no href the reviewer can click through', () => {
  const html = blocksToHtml([{ type: 'paragraph',
    runs: [run('click', { href: 'https://tracker.example/x' })] }], { images: new Map() });
  assert(!html.includes('href='), 'no live href in the preview');
  assert(html.includes('tracker.example'), 'target shown as text');
});

test('blocked images render a visible labeled placeholder', () => {
  const html = blocksToHtml([{ type: 'blockedImage', reason: 'remote', alt: 'Banner' }],
    { images: new Map() });
  assert(html.includes('remote image not loaded'), 'label present');
  assert(html.includes('Banner'), 'alt text preserved');
});

test('nested blockquotes nest in the output', () => {
  const html = blocksToHtml([{ type: 'blockquote', depth: 1, children: [
    { type: 'blockquote', depth: 2, children: [
      { type: 'paragraph', runs: [run('deep')] }] }] }], { images: new Map() });
  assertEqual((html.match(/<blockquote/g) || []).length, 2);
});

test('table cells carry their rowspan so the preview keeps the source layout', () => {
  const cell = (text, rowspan) => ({
    blocks: [{ type: 'paragraph', runs: [run(text)] }], colspan: 1, rowspan, header: false
  });
  const html = blocksToHtml([{ type: 'table', rows: [[cell('A', 3), cell('B', 1)]] }],
    { images: new Map() });
  assert(html.includes('<td rowspan="3">'), 'rowspan 3 emitted as an attribute');
  assertEqual((html.match(/rowspan/g) || []).length, 1,
    'a rowspan of 1 is the default and stays out of the markup');
});

test('tables render as tables with header cells', () => {
  const html = blocksToHtml([{ type: 'table', rows: [[
    { blocks: [{ type: 'paragraph', runs: [run('H')] }], colspan: 1, rowspan: 1, header: true }
  ]] }], { images: new Map() });
  assert(html.includes('<th'), 'header cell rendered');
});

test('a table too large for the preview says so instead of rendering', () => {
  const cell = (t) => ({ blocks: [{ type: 'paragraph', runs: [run(t)] }], colspan: 1, rowspan: 1, header: false });
  const row = (n) => Array.from({ length: n }, (_, i) => cell('c' + i));
  const big = { type: 'table', rows: Array.from({ length: 5001 }, () => row(40)) };
  const small = { type: 'table', rows: Array.from({ length: 5000 }, () => row(40)) };
  assert(5001 * 40 > PREVIEW_MAX_GRID && 5000 * 40 <= PREVIEW_MAX_GRID, 'the two straddle the limit');
  const out = blocksToHtml([big]);
  assert(!out.includes('<table'), 'no table element');
  assert(out.includes('table of 5001 rows and 40 columns is too large to preview; it is in the PDF'), out);
  assert(blocksToHtml([small]).startsWith('<table'), 'a table at the limit still renders');
});

test('the preview limit counts the columns rowspans add, and refuses very wide tables', () => {
  const cell = (t, rowspan = 1) => ({ blocks: [{ type: 'paragraph', runs: [run(t)] }],
    colspan: 1, rowspan, header: false });
  // 1000 cells in a row, each held below by a rowspan: the second row starts
  // at column 1000, so the grid is 1001 wide although no row has 1001 cells.
  const pushed = { type: 'table', rows: [
    Array.from({ length: 1000 }, (_, i) => cell('a' + i, 2)), [cell('b')]] };
  assert(blocksToHtml([pushed]).includes('2 rows and 1001 columns is too large'), 'pushed wide');
  const oneRow = { type: 'table', rows: [Array.from({ length: 1001 }, (_, i) => cell('c' + i))] };
  assert(!blocksToHtml([oneRow]).includes('<table'), 'a single row over 1000 columns is refused');
});
