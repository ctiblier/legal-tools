import { test, assert, assertEqual, assertThrows } from '/shared/testing/harness.js';
import { loadFontSet } from './fonts.js';

async function newDoc() {
  return await PDFLib.PDFDocument.create();
}

test('maps run styles onto face keys', async () => {
  const fs = await loadFontSet(await newDoc(), { family: 'sans' });
  assertEqual(fs.faceFor({ bold: false, italic: false }), 'regular');
  assertEqual(fs.faceFor({ bold: true, italic: false }), 'bold');
  assertEqual(fs.faceFor({ bold: false, italic: true }), 'italic');
  assertEqual(fs.faceFor({ bold: true, italic: true }), 'bolditalic');
});

test('Latin text stays on the primary face in one segment', async () => {
  const fs = await loadFontSet(await newDoc(), { family: 'sans' });
  const segs = fs.segment('Delivery schedule', 'regular');
  assertEqual(segs.length, 1);
  assertEqual(segs[0].faceKey, 'regular');
  assertEqual(fs.substitutions, 0);
});

test('Cyrillic renders rather than substituting', async () => {
  const fs = await loadFontSet(await newDoc(), { family: 'sans' });
  const segs = fs.segment('Перевод договора', 'regular');
  assert(segs.every((s) => s.faceKey !== 'fallback'), 'Cyrillic is covered by the primary face');
  assertEqual(fs.substitutions, 0);
});

test('mixed scripts split into segments without losing characters', async () => {
  const fs = await loadFontSet(await newDoc(), { family: 'sans' });
  const segs = fs.segment('Anna Иванова', 'regular');
  assertEqual(segs.map((s) => s.text).join(''), 'Anna Иванова');
});

test('uncovered codepoints substitute and are counted, never dropped', async () => {
  const fs = await loadFontSet(await newDoc(), { family: 'sans' });
  const segs = fs.segment('契約書', 'regular', { count: true });
  assertEqual(fs.substitutions, 3);
  assertEqual(segs.map((s) => s.text).join('').length, 3, 'length preserved');
});

test('segmenting without count does not touch the substitution total', async () => {
  // Measuring must never move the counter. The certificate's figure was 2x to
  // 25x too high because every measurement pass counted, and the wrapper
  // measures each token at least once before drawing it.
  const fs = await loadFontSet(await newDoc(), { family: 'sans' });
  fs.segment('契約書', 'regular');
  fs.segment('契約書', 'regular');
  assertEqual(fs.substitutions, 0, 'measuring twice counted nothing');

  fs.segment('契約書', 'regular', { count: true });
  assertEqual(fs.substitutions, 3, 'drawing once counted three');
});

test('embedded fonts can measure text', async () => {
  const fs = await loadFontSet(await newDoc(), { family: 'serif' });
  const w = fs.font('regular').widthOfTextAtSize('Hello', 12);
  assert(w > 0, 'measured a positive width');
});

test('an unknown face key throws rather than silently drawing in another face', async () => {
  const fs = await loadFontSet(await newDoc(), { family: 'sans' });
  assertThrows(() => fs.font('no-such-face'), 'unknown key must throw');
});

test('the mono style maps to the monospace face', async () => {
  const fs = await loadFontSet(await newDoc(), { family: 'sans' });
  assertEqual(fs.faceFor({ mono: true }), 'mono');
  assert(fs.font('mono').widthOfTextAtSize('M', 12) > 0, 'mono face is embedded and measurable');
});

test('an astral-plane character counts as one substitution, not two', async () => {
  const fs = await loadFontSet(await newDoc(), { family: 'sans' });
  // U+20000 (CJK Extension B) is a single codepoint but two UTF-16 code units,
  // and is covered by neither Liberation nor DejaVu. Counting it twice would
  // overstate on the certificate what the conversion failed to render.
  // Do not use an emoji here: DejaVu ships real outlines for much of that range
  // (U+1F600 resolves to a genuine glyph, not .notdef), so an emoji probe tests
  // coverage rather than substitution.
  const segs = fs.segment('\u{20000}', 'regular', { count: true });
  assertEqual(fs.substitutions, 1, 'one codepoint, one substitution');
  assertEqual(Array.from(segs.map((s) => s.text).join('')).length, 1,
    'one character out for one character in');
});

test('a covered astral character is rendered, not substituted', async () => {
  const fs = await loadFontSet(await newDoc(), { family: 'sans' });
  // The fallback face genuinely covers this one. Coverage must mean a real
  // glyph: if hasGlyphForCodePoint ever started reporting true for .notdef,
  // the certificate would under-report what could not be rendered.
  const segs = fs.segment('\u{1F600}', 'regular');
  assertEqual(fs.substitutions, 0, 'covered codepoint is not substituted');
  assertEqual(segs[0].faceKey, 'fallback', 'drawn by the fallback face');
});
