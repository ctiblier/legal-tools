import { test, assert, assertEqual } from '/shared/testing/harness.js';
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
  assert(segs.every((s) => s.faceKey !== 'substituted'), 'no substitution for Cyrillic');
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
