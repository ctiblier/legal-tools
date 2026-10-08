import { test, assert, assertEqual, extractPdfText, extractPdfTextItems } from '/shared/testing/harness.js';
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

const cell = (text, { colspan = 1, rowspan = 1, header = false } = {}) => ({
  blocks: [p(text)], colspan, rowspan, header
});

// Left edge of each label's first draw. Two labels sharing a column share that
// edge, which is what a rowspan has to get right; `page` picks which page the
// table was split across.
async function leftEdges(pdfDoc, writer, page = 0) {
  writer.finalize(); // idempotent, so the caller may save the document again
  const items = (await extractPdfTextItems(await pdfDoc.save()))[page];
  const leftOf = (label) => {
    const hits = items.filter((it) => it.str.trim() === label);
    assert(hits.length > 0, 'no "' + label + '" on page ' + (page + 1));
    return hits[0].x;
  };
  return leftOf;
}

test('a rowspan cell reserves its column so the rows below keep their headings', async () => {
  const { pdfDoc, writer, ctx } = await harness();
  // A spans two rows, so the row beneath it must start in the second column:
  // without reservation E and F slide one column left, under the wrong heading.
  await drawBlocks(writer, [{ type: 'table', rows: [
    [cell('AAA', { rowspan: 2 }), cell('BBB'), cell('CCC')],
    [cell('EEE'), cell('FFF')]
  ] }], ctx);
  const leftOf = await leftEdges(pdfDoc, writer);
  const [a, b, c, e, f] = ['AAA', 'BBB', 'CCC', 'EEE', 'FFF'].map(leftOf);
  assert(Math.abs(e - b) <= 1, 'EEE at x=' + e.toFixed(1) + ' must sit under BBB at x=' + b.toFixed(1));
  assert(Math.abs(f - c) <= 1, 'FFF at x=' + f.toFixed(1) + ' must sit under CCC at x=' + c.toFixed(1));
  assert(e > a, 'EEE at x=' + e.toFixed(1) + ' must be right of AAA at x=' + a.toFixed(1));
});

test('a cell spanning two columns and two rows reserves both columns below it', async () => {
  const { pdfDoc, writer, ctx } = await harness();
  await drawBlocks(writer, [{ type: 'table', rows: [
    [cell('AAA', { colspan: 2, rowspan: 2 }), cell('BBB')],
    [cell('CCC')],
    [cell('DDD'), cell('EEE'), cell('FFF')]
  ] }], ctx);
  const leftOf = await leftEdges(pdfDoc, writer);
  const [a, b, c, d, e, f] = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'FFF'].map(leftOf);
  // The wide cell holds two of the table's three columns, so AAA and BBB are
  // two columns apart while EEE, FFF and the rest are one column apart.
  assert(Math.abs(b - a - 2 * (f - e)) <= 2,
    'AAA to BBB spans twice the width of EEE to FFF: ' +
    [(b - a), 2 * (f - e)].map((v) => v.toFixed(1)).join(', '));
  assert(Math.abs(b - c) <= 1, 'CCC at x=' + c.toFixed(1) + ' must sit under BBB at x=' + b.toFixed(1));
  // Once the span ends, row 3 uses all three columns: DDD where AAA started,
  // EEE in the column AAA's second half held, FFF where BBB and CCC sit.
  assert(Math.abs(d - a) <= 1, 'DDD at x=' + d.toFixed(1) + ' must start where AAA at x=' + a.toFixed(1) + ' started');
  assert(Math.abs(c - b) <= 1, 'CCC at x=' + c.toFixed(1) + ' must sit under BBB at x=' + b.toFixed(1));
  assert(e > d && e < f, 'EEE at x=' + e.toFixed(1) + ' must fall between DDD at x=' + d.toFixed(1) +
    ' and FFF at x=' + f.toFixed(1));
});

test('a table that splits keeps its columns aligned under the repeated header', async () => {
  const { pdfDoc, writer, ctx } = await harness();
  // The header cell's rowspan 2 covers the header row and ONE row below it. On
  // the first page that row is leftA0, so it alone starts in column 2 (under
  // HEADT) with its partner in column 3, and every later body row starts back in
  // column 1: left<i> at HEADS's x, right<i> at HEADT's x.
  const rows = [[cell('HEADS', { rowspan: 2, header: true }), cell('HEADT', { header: true })]];
  for (let i = 0; i < 60; i++) rows.push([cell('leftA' + i), cell('rightB' + i)]);
  await drawBlocks(writer, [{ type: 'table', rows }], ctx);
  const pages = await renderItems(pdfDoc, writer);
  assert(pages.length > 1, 'the table split across pages; got ' + pages.length);

  let headsX = 0;
  let headtX = 0;
  for (let pi = 0; pi < pages.length; pi++) {
    const where = ' on page ' + (pi + 1);
    headsX = colX(pages[pi], 'HEADS', where);
    headtX = colX(pages[pi], 'HEADT', where);
    const colWidth = headtX - headsX;
    assert(colWidth > 100, 'the two header columns are far apart' + where + ': ' + colWidth);
    // Body rows on this page, top down. Only the very first body row of the
    // table (the one the header's rowspan reaches) is shifted a column right.
    const rowsOnPage = groupRows(pages[pi], /^(leftA|rightB)(\d+)$/);
    assert(rowsOnPage.length > 1, 'page ' + (pi + 1) + ' holds body rows');
    for (const cells of rowsOnPage) {
      for (const [label, x] of cells) {
        const i = Number(/\d+$/.exec(label)[0]);
        if (i === 0) continue; // checked separately below
        // Every body row but leftA0/rightB0 sits in columns 1 and 2, on every
        // page: left<i> under HEADS, right<i> under HEADT.
        const want = label.startsWith('leftA') ? headsX : headtX;
        assert(Math.abs(x - want) <= 1,
          '"' + label + '" at x=' + x.toFixed(1) + ' must sit in its own column at x=' +
          want.toFixed(1) + where + ', not drift to x=' + (want === headsX ? headtX : headsX).toFixed(1));
      }
    }
  }
  // The rowspan's one extra row: leftA0 under HEADT, rightB0 one column further.
  const firstRow = groupRows(pages[0], /^(leftA|rightB)(0)$/)[0];
  for (const [label, x] of firstRow) {
    const want = label.startsWith('leftA') ? headtX : headtX + (headtX - headsX);
    assert(Math.abs(x - want) <= 1,
      '"' + label + '" sits under the header rowspan at x=' + want.toFixed(1) +
      ', got x=' + x.toFixed(1));
  }
  assert(pages[1].some((it) => it.str.trim() === 'HEADS'), 'the header row repeated there');
});

// All draw positions in the rendered document, as one array per page of
// {str, x, y} items.
async function renderItems(pdfDoc, writer) {
  writer.finalize(); // idempotent, so the caller may save the document again
  return extractPdfTextItems(await pdfDoc.save());
}

// Left edge of the first draw of `label` on a page's items.
function colX(items, label, ctxMsg) {
  const hit = items.find((it) => it.str.trim() === label);
  assert(hit, 'no "' + label + '" drawn' + (ctxMsg || ''));
  return hit.x;
}

// Items whose text matches `re`, bundled into table rows by y: the cells of one
// row share a starting y, and rows descend the page. Each row is an array of
// [label, x], and rows come back top-down (header first).
function groupRows(items, re) {
  const seen = [];
  for (const it of items) {
    const m = re.exec(it.str.trim());
    if (!m) continue;
    const label = m[1] + m[2];
    let row = seen.find((r) => Math.abs(r.y - it.y) <= 1);
    if (!row) { row = { y: it.y, cells: [] }; seen.push(row); }
    row.cells.push([label, it.x]);
  }
  seen.sort((a, b) => b.y - a.y); // larger y is higher up the page
  return seen.map((r) => r.cells);
}

test('the row under a repeated header starts in column 1 on every page', async () => {
  // On the first page the header's rowspan covers the first body row, so that
  // row rightly starts in column 2. But the copy of the header drawn after a
  // page break must neither read nor write the occupancy the body rows use:
  // the first body row drawn under a repeated header must start in column 1,
  // at that page's HEADS x.
  const { pdfDoc, writer, ctx } = await harness();
  const rows = [[cell('HEADS', { rowspan: 2, header: true }), cell('HEADT', { header: true })]];
  for (let i = 0; i < 60; i++) rows.push([cell('leftA' + i), cell('rightB' + i)]);
  await drawBlocks(writer, [{ type: 'table', rows }], ctx);
  const pages = await renderItems(pdfDoc, writer);
  assert(pages.length > 1, 'the table split across pages; got ' + pages.length);
  for (let pi = 1; pi < pages.length; pi++) {
    const headsX = colX(pages[pi], 'HEADS', ' on page ' + (pi + 1));
    const body = pages[pi].filter((it) => /^leftA\d+$/.test(it.str.trim()));
    assert(body.length > 0, 'page ' + (pi + 1) + ' has body rows under the repeated header');
    // Larger y is higher up: the first body row drawn under the repeated header.
    const firstUnder = body.reduce((best, it) => (it.y > best.y ? it : best));
    assert(Math.abs(firstUnder.x - headsX) <= 1,
      'the first body row under the repeated header on page ' + (pi + 1) + ' starts "' +
      firstUnder.str.trim() + '" at x=' + firstUnder.x.toFixed(1) + ', but the repeated header ' +
      'must not hand its rowspan down: expected column 1 at x=' + headsX.toFixed(1));
  }
});

test('a rowspan in the middle of the table still holds its column across a page break', async () => {
  // The rowspan does not start in the header, so occupancy must survive to it:
  // the row after HELD's (X2, X3) starts one column right of HELD, under
  // UNDER2 and UNDER3, on whichever page it lands.
  const { pdfDoc, writer, ctx } = await harness();
  const rows = [[cell('HEAD1', { header: true }), cell('HEAD2', { header: true }),
                 cell('HEAD3', { header: true })]];
  for (let i = 0; i < 19; i++) rows.push([cell('a' + i), cell('b' + i), cell('c' + i)]);
  rows.push([cell('HELD', { rowspan: 2 }), cell('UNDER2'), cell('UNDER3')]);
  rows.push([cell('X2'), cell('X3')]);
  for (let i = 0; i < 45; i++) rows.push([cell('d' + i), cell('e' + i), cell('f' + i)]);
  await drawBlocks(writer, [{ type: 'table', rows }], ctx);
  const pages = await renderItems(pdfDoc, writer);
  assert(pages.length > 1, 'the table split across pages; got ' + pages.length);

  // The column grid, taken from the header: each column one HEAD-to-HEAD apart.
  const heads = pages[0].filter((it) => /^HEAD\d$/.test(it.str.trim()))
    .sort((l, r) => l.x - r.x).map((it) => it.x);
  assert(heads.length === 3, 'all three header cells drawn on page 1');
  const colWidth = heads[1] - heads[0];
  assert(colWidth > 60, 'three distinct columns: ' + heads.map((v) => v.toFixed(1)).join(', '));

  for (let pi = 0; pi < pages.length; pi++) {
    const held = pages[pi].find((it) => it.str.trim() === 'HELD');
    if (!held) continue;
    const under2 = pages[pi].find((it) => it.str.trim() === 'UNDER2');
    const under3 = pages[pi].find((it) => it.str.trim() === 'UNDER3');
    assert(under2 && Math.abs(under2.x - (held.x + colWidth)) <= 1,
      'UNDER2 is in the column right of HELD, in the same row');
    // X2/X3 may land on the next page; look them up across the document.
    const find = (label) => pages.flat().find((it) => it.str.trim() === label);
    const x2 = find('X2');
    const x3 = find('X3');
    assert(x2 && Math.abs(x2.x - under2.x) <= 1,
      '"X2" at x=' + (x2 ? x2.x.toFixed(1) : 'missing') + ' must sit under UNDER2 at x=' +
      under2.x.toFixed(1) + ': HELD still holds column 1 for that row');
    assert(x3 && Math.abs(x3.x - under3.x) <= 1,
      '"X3" at x=' + (x3 ? x3.x.toFixed(1) : 'missing') + ' must sit under UNDER3 at x=' +
      under3.x.toFixed(1));
  }
  assert(pages.some((pg) => pg.some((it) => it.str.trim() === 'HELD')), 'HELD was drawn');
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
