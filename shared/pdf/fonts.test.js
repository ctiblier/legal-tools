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
  const segs = fs.segment('契約書', 'regular');
  assertEqual(fs.substitutions, 3);
  assertEqual(segs.map((s) => s.text).join('').length, 3, 'length preserved');
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
  // U+1F600 is a single codepoint but two UTF-16 code units. Counting it twice
  // would overstate on the certificate what the conversion failed to render.
  const segs = fs.segment('\u{1F600}', 'regular');
  assertEqual(fs.substitutions, 1, 'one codepoint, one substitution');
  assertEqual(Array.from(segs.map((s) => s.text).join('')).length, 1,
    'one character out for one character in');
});
