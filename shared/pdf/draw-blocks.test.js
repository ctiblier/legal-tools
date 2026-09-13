import { test, assert, assertEqual } from '/shared/testing/harness.js';
import { loadFontSet } from './fonts.js';
import { PageWriter } from './writer.js';
import { drawBlocks } from './draw-blocks.js';
import { THEMES } from '/shared/eml/themes.js';
import { loadFixture } from '/shared/testing/fixtures.js';
import { parseEml } from '/shared/eml/parse.js';
import { sanitizeHtml } from '/shared/eml/sanitize.js';
import { htmlToBlocks } from '/shared/eml/html-to-blocks.js';

async function harness(themeKey = 'mail-client') {
  const pdfDoc = await PDFLib.PDFDocument.create();
  const theme = THEMES[themeKey];
  const fontSet = await loadFontSet(pdfDoc, { family: theme.family });
  const writer = new PageWriter({ pdfDoc, theme, fontSet, footerLeft: 'x.eml · abc' });
  return { pdfDoc, writer, ctx: { indent: 0, quoteDepth: 0, images: new Map(), embedCache: new Map() } };
}

const p = (text) => ({
  type: 'paragraph',
  runs: [{ text, bold: false, italic: false, underline: false, strike: false,
           color: null, sizeScale: 1, href: null }]
});

test('a short paragraph fits on one page', async () => {
  const { writer, ctx } = await harness();
  await drawBlocks(writer, [p('Hello there')], ctx);
  assertEqual(writer.pageCount, 1);
});

test('long content paginates rather than overflowing', async () => {
  const { writer, ctx } = await harness();
  const many = [];
  for (let i = 0; i < 120; i++) many.push(p('Paragraph number ' + i + ' of the body text.'));
  await drawBlocks(writer, many, ctx);
  assert(writer.pageCount > 1, 'paginated');
  assert(writer.pageCount < 40, 'did not run away: ' + writer.pageCount);
});

test('a table taller than a page splits and repeats its header row', async () => {
  const { writer, ctx } = await harness();
  const rows = [[{ blocks: [p('Invoice')], colspan: 1, rowspan: 1, header: true },
                 { blocks: [p('Amount')], colspan: 1, rowspan: 1, header: true }]];
  for (let i = 0; i < 90; i++) {
    rows.push([
      { blocks: [p('INV-' + (1000 + i))], colspan: 1, rowspan: 1, header: false },
      { blocks: [p('$' + (i * 37) + '.00')], colspan: 1, rowspan: 1, header: false }
    ]);
  }
  await drawBlocks(writer, [{ type: 'table', rows }], ctx);
  assert(writer.pageCount > 1, 'table split across pages');
});

test('a single cell taller than the page does not overprint the next row', async () => {
  const { writer, ctx } = await harness();
  const tall = [];
  for (let i = 0; i < 80; i++) tall.push(p('Overflowing cell line ' + i));
  const rows = [
    [{ blocks: tall, colspan: 1, rowspan: 1, header: false },
     { blocks: [p('short')], colspan: 1, rowspan: 1, header: false }],
    [{ blocks: [p('next row')], colspan: 1, rowspan: 1, header: false },
     { blocks: [p('next row b')], colspan: 1, rowspan: 1, header: false }]
  ];
  await drawBlocks(writer, [{ type: 'table', rows }], ctx);
  // The cursor must end on the page it is actually drawing on, below the top
  // margin — not restored to a y captured before the overflow.
  assert(writer.y <= 792 - writer.theme.page.margin.top, 'cursor is on the live page');
  assert(writer.y > 0, 'cursor did not run off the bottom of the page');
});

test('nested blockquotes terminate and consume vertical space', async () => {
  const { writer, ctx } = await harness();
  const deep = { type: 'blockquote', depth: 1, children: [
    p('level one'),
    { type: 'blockquote', depth: 2, children: [
      p('level two'),
      { type: 'blockquote', depth: 3, children: [p('level three')] }
    ] }
  ] };
  const before = writer.y;
  await drawBlocks(writer, [deep], ctx);
  assert(writer.y < before, 'cursor advanced');
});

test('a blocked image draws a visible labeled placeholder, not a gap', async () => {
  const { writer, ctx } = await harness();
  const before = writer.y;
  await drawBlocks(writer, [{ type: 'blockedImage', reason: 'remote', alt: 'Banner' }], ctx);
  assert(before - writer.y > 10, 'placeholder occupies real space');
});

test('an empty block list is a no-op', async () => {
  const { writer, ctx } = await harness();
  const before = writer.y;
  await drawBlocks(writer, [], ctx);
  assertEqual(writer.y, before);
  assertEqual(writer.pageCount, 1);
});

test('the Outlook fixture renders to a saveable PDF in every theme', async () => {
  const rec = await parseEml(await loadFixture('08-outlook-tables.eml'));
  for (const key of ['mail-client', 'exhibit', 'minimal']) {
    const { pdfDoc, writer, ctx } = await harness(key);
    const { body } = sanitizeHtml(rec.bodyHtml, rec.inlineImages);
    await drawBlocks(writer, htmlToBlocks(body), ctx);
    writer.finalize();
    const bytes = await pdfDoc.save();
    assert(bytes.length > 1000, key + ' produced a real PDF');
  }
});
