import { test, assert, assertEqual, extractPdfText } from '/shared/testing/harness.js';
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
  // "pageCount > 1" alone passes even when the header row is never repeated,
  // which is the behaviour this test is named for. Record which page each
  // string lands on, and assert the header appears on more than one.
  const drawn = [];
  const spyOn = (page) => {
    const original = page.drawText.bind(page);
    page.drawText = (text, opts) => {
      drawn.push({ page: writer.pages.indexOf(page), text });
      return original(text, opts);
    };
  };
  const newPage = writer.newPage.bind(writer);
  writer.newPage = () => { const p = newPage(); spyOn(p); return p; };
  spyOn(writer.page);

  await drawBlocks(writer, [{ type: 'table', rows }], ctx);
  assert(writer.pageCount > 1, 'table split across pages');

  for (const label of ['Invoice', 'Amount']) {
    const pages = new Set(drawn.filter((d) => d.text === label).map((d) => d.page));
    assert(pages.size > 1,
      'the header cell "' + label + '" must repeat on each page the table ' +
      'spans; found it on ' + pages.size + ' page(s)');
  }
});

test('a cell taller than the page does not overprint the next cell in its row', async () => {
  const { pdfDoc, writer, ctx } = await harness();
  const tall = [];
  for (let i = 0; i < 80; i++) tall.push(p('Overflowing cell line ' + i));
  const rows = [[
    { blocks: tall, colspan: 1, rowspan: 1, header: false },
    { blocks: [p('SECONDCELL')], colspan: 1, rowspan: 1, header: false }
  ]];

  // Record every draw as {pageIndex, y, text} so we can see where content landed,
  // rather than inferring it from the final cursor position.
  const draws = [];
  const patch = (page, index) => {
    const orig = page.drawText.bind(page);
    page.drawText = (text, opts) => { draws.push({ index, y: opts.y, text }); return orig(text, opts); };
  };
  let patched = 0;
  const patchAll = () => {
    const pages = pdfDoc.getPages();
    for (; patched < pages.length; patched++) patch(pages[patched], patched);
  };
  patchAll();
  const origNewPage = writer.newPage.bind(writer);
  writer.newPage = () => { const pg = origNewPage(); patchAll(); return pg; };

  await drawBlocks(writer, [{ type: 'table', rows }], ctx);

  const second = draws.find((d) => d.text.includes('SECONDCELL'));
  assert(second, 'the second cell was drawn at all');
  const firstOnThatPage = draws.filter(
    (d) => d.index === second.index && d.text.startsWith('Overflowing')
  );
  assert(firstOnThatPage.length > 0, 'the tall cell also has content on that page');
  const lowestOfFirst = Math.min(...firstOnThatPage.map((d) => d.y));
  // Smaller y is further down the page. The second cell must start below the
  // first cell's content on this page, not on top of it.
  assert(second.y < lowestOfFirst,
    'second cell at y=' + second.y.toFixed(1) +
    ' must be below the tall cell\'s lowest content at y=' + lowestOfFirst.toFixed(1));
});

test('a zero-dimension image degrades to a placeholder and keeps the cursor finite', async () => {
  const { writer, ctx } = await harness();
  // A stub embed whose natural size is degenerate. If the guard is missing, the
  // cursor becomes NaN and pagination silently stops for the whole document.
  ctx.embedCache.set('cid:zero', { scale: () => ({ width: 0, height: 0 }) });
  const before = writer.y;
  await drawBlocks(writer, [{
    type: 'image', alt: 'Zero', widthPx: 100, heightPx: 100,
    ref: { kind: 'cid', contentId: 'zero' }
  }], ctx);
  assert(Number.isFinite(writer.y), 'cursor is still a finite number');
  assert(before - writer.y > 10, 'a placeholder occupied real space');
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
    // A byte-length floor cannot fail here: six embedded subsetted TTFs put the
    // document far past 1000 bytes before anything is drawn, so this passed for
    // a completely blank page in all three themes — exactly the regression the
    // name claims to guard. Assert the fixture's content is on the page.
    const text = await extractPdfText(bytes);
    for (const phrase of ['INV-1041', 'Disputed', 'see counsel']) {
      assert(text.includes(phrase),
        key + ' must render "' + phrase + '"; got ' + text.slice(0, 200));
    }
  }
});
