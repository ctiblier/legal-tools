import { test, assert, assertEqual, assertDeepEqual } from '/shared/testing/harness.js';
import { loadFontSet } from './fonts.js';
import { PageWriter, cssToRgb } from './writer.js';
import { tokenizeRuns } from './measure.js';
import { THEMES } from '/shared/eml/themes.js';

async function newWriter() {
  const pdfDoc = await PDFLib.PDFDocument.create();
  const theme = THEMES['mail-client'];
  const fontSet = await loadFontSet(pdfDoc, { family: theme.family });
  return { pdfDoc, writer: new PageWriter({ pdfDoc, theme, fontSet, footerLeft: 'test.eml · abc123def456' }) };
}

const style = { bold: false, italic: false, color: null, sizeScale: 1, href: null };

test('starts with one page and a cursor below the top margin', async () => {
  const { writer } = await newWriter();
  assertEqual(writer.pageCount, 1);
  assert(writer.y < 792 - 50, 'cursor starts inside the top margin');
});

test('contentWidth is the page minus both side margins', async () => {
  const { writer } = await newWriter();
  assertEqual(writer.contentWidth, 612 - 54 - 54);
});

test('ensure() adds a page when the requested height does not fit', async () => {
  const { writer } = await newWriter();
  writer.moveDown(650);
  writer.ensure(120);
  assertEqual(writer.pageCount, 2);
});

test('ensure() does not add a page when the height fits', async () => {
  const { writer } = await newWriter();
  writer.ensure(40);
  assertEqual(writer.pageCount, 1);
});

test('drawLine advances the cursor by the line height', async () => {
  const { writer } = await newWriter();
  const before = writer.y;
  const toks = tokenizeRuns([{ text: 'Hello there', ...style }]);
  writer.drawLine(toks, { x: 54, size: 10.5 });
  assertEqual(Math.round(before - writer.y), Math.round(writer.lineHeight(10.5)));
});

test('measureToken returns a positive width that scales with size', async () => {
  const { writer } = await newWriter();
  const tok = { text: 'Hello', space: false, newline: false, style };
  const small = writer.measureToken(tok, 8);
  const large = writer.measureToken(tok, 16);
  assert(small > 0, 'positive width');
  assert(large > small, 'width scales with font size');
});

test('cssToRgb handles hex, rgb() and named colours, and rejects the rest', () => {
  assertDeepEqual(cssToRgb('#ff0000'), [1, 0, 0]);
  assertDeepEqual(cssToRgb('#f00'), [1, 0, 0]);
  assertDeepEqual(cssToRgb('rgb(0, 0, 255)'), [0, 0, 1]);
  assertDeepEqual(cssToRgb('black'), [0, 0, 0]);
  assertEqual(cssToRgb('hsl(20 100% 50%)'), null);
  assertEqual(cssToRgb(''), null);
});

test('finalize stamps a footer on every page and produces a loadable PDF', async () => {
  const { pdfDoc, writer } = await newWriter();
  writer.newPage();
  writer.newPage();
  // Content streams are Flate-compressed on save regardless of
  // useObjectStreams, so the footer text is not greppable in the saved
  // bytes. Spy on each page's drawText to prove finalize() actually drew the
  // footer, rather than only checking the page count survived.
  const calls = [];
  for (const page of writer.pages) {
    const orig = page.drawText.bind(page);
    page.drawText = (text, opts) => { calls.push(text); return orig(text, opts); };
  }
  writer.finalize();
  assertEqual(writer.pageCount, 3);
  assert(calls.some((t) => t.includes('page 1 of 3')), 'first page footer present');
  assert(calls.some((t) => t.includes('page 3 of 3')), 'last page footer present');
  assertEqual(calls.filter((t) => t.includes('test.eml')).length, 3, 'footerLeft drawn on every page');
  const bytes = await pdfDoc.save();
  const reloaded = await PDFLib.PDFDocument.load(bytes);
  assertEqual(reloaded.getPageCount(), 3);
});

test('link annotations survive a save/load round trip', async () => {
  const { pdfDoc, writer } = await newWriter();
  writer.linkTo('https://example.test/x', { x: 54, y: 700, width: 100, height: 12 });
  writer.finalize();
  // useObjectStreams:false keeps indirect objects uncompressed so the URI is
  // greppable in the raw bytes. pdf-lib's default packs them into a Flate object
  // stream, and this assertion would fail against a perfectly correct writer.
  const bytes = await pdfDoc.save({ useObjectStreams: false });
  const text = new TextDecoder('latin1').decode(bytes);
  assert(text.includes('example.test'), 'URI action written into the file');
});

test('a link annotation is attached to the page the cursor was on', async () => {
  const { writer } = await newWriter();
  writer.newPage();                       // cursor now on page 2
  writer.linkTo('https://example.test/y', { x: 54, y: 700, width: 100, height: 12 });
  writer.finalize();
  const pages = writer.pdfDoc.getPages();
  const first = pages[0].node.get(PDFLib.PDFName.of('Annots'));
  const second = pages[1].node.get(PDFLib.PDFName.of('Annots'));
  // pdf-lib's own page.normalize() (triggered by drawText, which finalize()
  // calls for the footer on every page) materializes an empty Annots array on
  // any page that had content drawn on it, even one with no link annotations.
  // So "no annotation" means absent-or-empty, not strictly absent.
  assert(!first || first.size() === 0, 'no annotation on the page the cursor had left');
  assert(second && second.size() === 1, 'exactly one annotation on the current page');
});

test('underlineLinks:false skips the underline stroke but still creates the annotation', async () => {
  const { writer } = await newWriter();
  // One word, so tokenizeRuns yields a single token and thus a single
  // annotation — a run with a space would yield one annotation per word,
  // which is a separate (and correct) property of drawLine, not what this
  // test is checking.
  const toks = tokenizeRuns([{ text: 'linktext', ...style, href: 'https://example.test/z' }]);
  let lineCalls = 0;
  const origDrawLine = writer.page.drawLine.bind(writer.page);
  writer.page.drawLine = (opts) => { lineCalls += 1; return origDrawLine(opts); };
  writer.drawLine(toks, { x: 54, size: 10.5, underlineLinks: false });
  assertEqual(lineCalls, 0, 'no underline stroke drawn');
  const annots = writer.annots.get(0);
  assert(annots && annots.length === 1, 'link annotation still created');
});

test('usableHeight is the page minus top and bottom margins', async () => {
  const { writer } = await newWriter();
  assertEqual(writer.usableHeight, 792 - 54 - 64);
});

test('ensure(usableHeight) on a fresh page does not add a second page', async () => {
  const { writer } = await newWriter();
  writer.ensure(writer.usableHeight);
  assertEqual(writer.pageCount, 1);
});

test('reservePages appends blank pages and returns their indices', async () => {
  const { writer } = await newWriter();
  const indices = writer.reservePages(3);
  assertEqual(indices.length, 3);
  assertEqual(writer.pageCount, 4);
  assertEqual(indices[0], 1);
});

test('useExistingPage moves the cursor without adding a page', async () => {
  const { writer } = await newWriter();
  const [first] = writer.reservePages(1);
  writer.newPage();
  const countBefore = writer.pageCount;
  writer.useExistingPage(first);
  assertEqual(writer.pageCount, countBefore);
  assertEqual(writer.y, 792 - writer.theme.page.margin.top);
});

test('drawing into a reserved page does not append pages', async () => {
  const { writer } = await newWriter();
  const [reserved] = writer.reservePages(1);
  writer.newPage();
  const before = writer.pageCount;
  writer.useExistingPage(reserved);
  writer.drawLine(tokenizeRuns([{ text: 'Contents', ...style }]), { x: 54, size: 12 });
  assertEqual(writer.pageCount, before);
});
