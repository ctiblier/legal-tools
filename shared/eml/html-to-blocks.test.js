import { test, assert, assertEqual } from '/shared/testing/harness.js';
import { loadFixture } from '/shared/testing/fixtures.js';
import { parseEml } from './parse.js';
import { sanitizeHtml } from './sanitize.js';
import { htmlToBlocks } from './html-to-blocks.js';

function blocks(html, inline) {
  const { body } = sanitizeHtml(html, inline || new Map());
  return htmlToBlocks(body);
}

const flat = (runs) => runs.map((r) => r.text).join('');

test('a paragraph becomes one paragraph block', () => {
  const out = blocks('<p>Hello there</p>');
  assertEqual(out.length, 1);
  assertEqual(out[0].type, 'paragraph');
  assertEqual(flat(out[0].runs), 'Hello there');
});

test('inline styling becomes run flags, not separate blocks', () => {
  const out = blocks('<p>plain <b>bold</b> and <i>italic</i></p>');
  assertEqual(out.length, 1);
  const bold = out[0].runs.find((r) => r.text === 'bold');
  const ital = out[0].runs.find((r) => r.text === 'italic');
  assertEqual(bold.bold, true);
  assertEqual(bold.italic, false);
  assertEqual(ital.italic, true);
});

test('nested emphasis combines flags', () => {
  const out = blocks('<p><b>bold <i>both</i></b></p>');
  const both = out[0].runs.find((r) => r.text === 'both');
  assertEqual(both.bold, true);
  assertEqual(both.italic, true);
});

test('links carry href on the run', () => {
  const out = blocks('<p>see <a href="https://example.test/x">this</a></p>');
  const link = out[0].runs.find((r) => r.text === 'this');
  assertEqual(link.href, 'https://example.test/x');
});

test('headings keep their level', () => {
  const out = blocks('<h2>March statement</h2>');
  assertEqual(out[0].type, 'heading');
  assertEqual(out[0].level, 2);
});

test('lists become list blocks with per-item blocks', () => {
  const out = blocks('<ul><li>one</li><li>two</li></ul>');
  assertEqual(out[0].type, 'list');
  assertEqual(out[0].ordered, false);
  assertEqual(out[0].items.length, 2);
  assertEqual(flat(out[0].items[0][0].runs), 'one');
});

test('ordered lists are marked ordered', () => {
  const out = blocks('<ol><li>first</li></ol>');
  assertEqual(out[0].ordered, true);
});

test('nested blockquotes carry increasing depth', () => {
  const out = blocks(
    '<blockquote><p>a</p><blockquote><p>b</p></blockquote></blockquote>'
  );
  assertEqual(out[0].type, 'blockquote');
  assertEqual(out[0].depth, 1);
  const inner = out[0].children.find((c) => c.type === 'blockquote');
  assertEqual(inner.depth, 2);
  assertEqual(flat(inner.children[0].runs), 'b');
});

test('tables preserve rows, cells and header flags', () => {
  const out = blocks(
    '<table><tr><th>H</th></tr><tr><td colspan="2">D</td></tr></table>'
  );
  assertEqual(out[0].type, 'table');
  assertEqual(out[0].rows.length, 2);
  assertEqual(out[0].rows[0][0].header, true);
  assertEqual(out[0].rows[1][0].colspan, 2);
});

test('a nested table becomes blocks inside the parent cell, never a lost table', () => {
  const out = blocks(
    '<table><tr><td><table><tr><td>inner</td></tr></table></td></tr></table>'
  );
  const cell = out[0].rows[0][0];
  const innerTable = cell.blocks.find((b) => b.type === 'table');
  assert(innerTable, 'inner table survives as a block inside the cell');
  assertEqual(flat(innerTable.rows[0][0].blocks[0].runs), 'inner');
});

test('a blocked image becomes a blockedImage block, never a silent gap', () => {
  const out = blocks('<img src="https://cdn.example/b.png" alt="Banner" width="600">');
  const img = out.find((b) => b.type === 'blockedImage');
  assertEqual(img.reason, 'remote');
  assertEqual(img.alt, 'Banner');
});

test('a resolvable cid image becomes an image block with a cid ref', () => {
  const inline = new Map([['c1', { contentId: 'c1', mimeType: 'image/png' }]]);
  const out = blocks('<img src="cid:c1" width="48" height="48">', inline);
  const img = out.find((b) => b.type === 'image');
  assertEqual(img.ref.kind, 'cid');
  assertEqual(img.ref.contentId, 'c1');
  assertEqual(img.widthPx, 48);
});

test('<br> breaks the line without starting a new block', () => {
  const out = blocks('<p>Robert Jones<br>Jones &amp; Associates</p>');
  assertEqual(out.length, 1);
  assert(flat(out[0].runs).includes('\n'), 'line break preserved inside the paragraph');
});

test('whitespace between block elements does not create empty paragraphs', () => {
  const out = blocks('<p>one</p>\n\n   \n<p>two</p>');
  assertEqual(out.length, 2);
});

test('the Outlook fixture yields a four-column table and keeps every row', async () => {
  const rec = await parseEml(await loadFixture('08-outlook-tables.eml'));
  const { body } = sanitizeHtml(rec.bodyHtml, rec.inlineImages);
  const out = htmlToBlocks(body);
  const table = out.find((b) => b.type === 'table');
  assertEqual(table.rows.length, 4);
  assertEqual(table.rows[0].length, 4);
});

test('the nested-quote fixture reaches depth three', async () => {
  const rec = await parseEml(await loadFixture('02-html-nested-quotes.eml'));
  const { body } = sanitizeHtml(rec.bodyHtml, rec.inlineImages);
  const out = htmlToBlocks(body);
  let node = out.find((b) => b.type === 'blockquote');
  let depth = node.depth;
  while (node) {
    node = (node.children || []).find((c) => c.type === 'blockquote');
    if (node) depth = node.depth;
  }
  assertEqual(depth, 3);
});
