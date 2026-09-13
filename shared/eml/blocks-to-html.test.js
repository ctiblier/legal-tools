import { test, assert, assertEqual } from '/shared/testing/harness.js';
import { blocksToHtml } from './blocks-to-html.js';

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

test('tables render as tables with header cells', () => {
  const html = blocksToHtml([{ type: 'table', rows: [[
    { blocks: [{ type: 'paragraph', runs: [run('H')] }], colspan: 1, rowspan: 1, header: true }
  ]] }], { images: new Map() });
  assert(html.includes('<th'), 'header cell rendered');
});
