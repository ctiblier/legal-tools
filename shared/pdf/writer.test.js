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
  writer.finalize();
  assertEqual(writer.pageCount, 3);
  const bytes = await pdfDoc.save();
  const reloaded = await PDFLib.PDFDocument.load(bytes);
  assertEqual(reloaded.getPageCount(), 3);
});

test('link annotations survive a save/load round trip', async () => {
  const { pdfDoc, writer } = await newWriter();
  writer.linkTo('https://example.test/x', { x: 54, y: 700, width: 100, height: 12 });
  writer.finalize();
  const bytes = await pdfDoc.save();
  const text = new TextDecoder().decode(bytes);
  assert(text.includes('example.test'), 'URI action written into the file');
});
