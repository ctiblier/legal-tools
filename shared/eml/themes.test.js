import { test, assert, assertEqual } from '/shared/testing/harness.js';
import { THEMES, THEME_ORDER } from './themes.js';
import { PageWriter } from '/shared/pdf/writer.js';
import { loadFontSet } from '/shared/pdf/fonts.js';

test('three themes, mail-client first', () => {
  assertEqual(THEME_ORDER.length, 3);
  assertEqual(THEME_ORDER[0], 'mail-client');
  for (const key of THEME_ORDER) assert(THEMES[key], 'theme ' + key + ' exists');
});

test('every theme defines the full contract', () => {
  for (const key of THEME_ORDER) {
    const t = THEMES[key];
    assertEqual(t.id, key);
    assert(t.page.width > 0 && t.page.height > 0, key + ' page size');
    assert(t.page.margin.top > 0, key + ' margins');
    assert(t.size.body > 0 && t.size.footer > 0 && t.size.mono > 0, key + ' sizes');
    assert(t.leading > 1, key + ' leading');
    for (const c of ['text', 'muted', 'rule', 'quoteBar', 'link', 'band', 'bandText']) {
      assert(Array.isArray(t.color[c]) && t.color[c].length === 3, key + ' color ' + c);
    }
    assert(typeof t.drawHeaderBlock === 'function', key + ' header renderer');
    assert(t.family === 'sans' || t.family === 'serif', key + ' family');
  }
});

test('colour components are all in 0..1, not 0..255', () => {
  for (const key of THEME_ORDER) {
    for (const arr of Object.values(THEMES[key].color)) {
      for (const v of arr) assert(v >= 0 && v <= 1, key + ' component out of range: ' + v);
    }
  }
});

test('US Letter portrait for every theme', () => {
  for (const key of THEME_ORDER) {
    assertEqual(THEMES[key].page.width, 612);
    assertEqual(THEMES[key].page.height, 792);
  }
});

test('every theme renders a header block without throwing, for a sparse record', async () => {
  const bare = {
    from: null, to: [], cc: [], bcc: [],
    date: { raw: null, parsed: null }, subject: '', messageId: null
  };
  for (const key of THEME_ORDER) {
    const pdfDoc = await PDFLib.PDFDocument.create();
    const theme = THEMES[key];
    const fontSet = await loadFontSet(pdfDoc, { family: theme.family });
    const writer = new PageWriter({ pdfDoc, theme, fontSet, footerLeft: 'x.eml' });
    theme.drawHeaderBlock(writer, bare);
    assert(writer.y < theme.page.height - theme.page.margin.top, key + ' consumed vertical space');
  }
});

test('a wrapping header does not overflow the mail-client band', async () => {
  const pdfDoc = await PDFLib.PDFDocument.create();
  const theme = THEMES['mail-client'];
  const fontSet = await loadFontSet(pdfDoc, { family: theme.family });
  const writer = new PageWriter({ pdfDoc, theme, fontSet, footerLeft: 'x.eml' });
  const many = [];
  for (let i = 0; i < 12; i++) many.push({ name: 'Recipient Number ' + i, address: 'r' + i + '@example.test' });
  const top = writer.y;
  theme.drawHeaderBlock(writer, {
    from: { name: 'A Sender With A Long Display Name', address: 'sender@example.test' },
    to: many, cc: [], bcc: [],
    date: { raw: 'Tue, 4 Mar 2026 09:14:22 -0800', parsed: null },
    subject: 'A subject long enough that it must wrap across more than a single line in the band',
    messageId: '<x@example.test>'
  });
  // The band is painted from a measured height; the cursor must end below the
  // band's own bottom edge, not inside or above it.
  assert(top - writer.y > 100, 'a wrapped header consumed multi-line height');
});
