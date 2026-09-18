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

test('every theme prints the Date header verbatim, never a reformatted date', async () => {
  // Spec §3.2 is the sharpest constraint in the document: the offset is
  // frequently the disputed fact, so normalizing it silently alters evidence.
  // Until now no test inspected the date a theme actually draws — the property
  // was guaranteed by code review alone, and a theme that called
  // toLocaleString() would have passed the whole suite.
  const RAW = 'Tue, 4 Mar 2026 09:14:22 -0800';
  const record = {
    from: { name: 'John Smith', address: 'jsmith@acme-manufacturing.example' },
    to: [{ name: 'Robert Jones', address: 'counsel@firm.example' }],
    cc: [], bcc: [],
    date: { raw: RAW, parsed: new Date('2026-03-04T17:14:22Z') },
    subject: 'Delivery schedule',
    messageId: '<20260304171422.A1F9C@acme-manufacturing.example>'
  };

  for (const key of THEME_ORDER) {
    const pdfDoc = await PDFLib.PDFDocument.create();
    const theme = THEMES[key];
    const fontSet = await loadFontSet(pdfDoc, { family: theme.family });
    const writer = new PageWriter({ pdfDoc, theme, fontSet, footerLeft: 'x.eml' });

    const drawn = [];
    const original = writer.page.drawText.bind(writer.page);
    writer.page.drawText = (text, opts) => { drawn.push(text); return original(text, opts); };

    theme.drawHeaderBlock(writer, record);

    // Each word and each space is its own drawText call, so concatenate with
    // nothing to reconstruct exactly what reaches the page.
    const all = drawn.join('');
    assert(all.includes(RAW),
      key + ' must draw the raw Date header "' + RAW + '"; drew: ' + all);

    // A reformatted date is the failure this guards: any of these appearing
    // means the offset was interpreted rather than reproduced.
    for (const leak of ['PST', 'GMT', '2026-03-04', '17:14', '5:14']) {
      assert(!all.includes(leak),
        key + ' must not reformat the date; found "' + leak + '" in: ' + all);
    }
  }
});

test('the mail-client band is tall enough for the text drawn on it', async () => {
  const pdfDoc = await PDFLib.PDFDocument.create();
  const theme = THEMES['mail-client'];
  const fontSet = await loadFontSet(pdfDoc, { family: theme.family });
  const writer = new PageWriter({ pdfDoc, theme, fontSet, footerLeft: 'x.eml' });

  // Capture the tint rectangle instead of guessing at it: its `y` is the band's
  // bottom edge in PDF user space, where smaller y is further down the page.
  let band = null;
  const originalDrawRect = writer.drawRect.bind(writer);
  writer.drawRect = (opts) => { band = opts; return originalDrawRect(opts); };

  const many = [];
  for (let i = 0; i < 12; i++) {
    many.push({ name: 'Recipient Number ' + i, address: 'r' + i + '@example.test' });
  }
  theme.drawHeaderBlock(writer, {
    from: { name: 'A Sender With A Long Display Name', address: 'sender@example.test' },
    to: many, cc: [], bcc: [],
    date: { raw: 'Tue, 4 Mar 2026 09:14:22 -0800', parsed: null },
    subject: 'A subject long enough that it must wrap across more than a single line in the band',
    messageId: '<x@example.test>'
  });

  assert(band, 'the tint rectangle was drawn');
  // The header ends with a trailing moveDown, so the last line of text sits a
  // little above the final cursor. The band's bottom edge must be at or below
  // that last line — under the old estimate-based code it sat well above it,
  // and the text spilled past the tint.
  const lastTextBottom = writer.y + 16;
  assert(band.y <= lastTextBottom,
    'band bottom (' + band.y.toFixed(1) + ') must be at or below the last text line (' +
    lastTextBottom.toFixed(1) + ')');
});
