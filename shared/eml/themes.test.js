import { test, assert, assertEqual } from '/shared/testing/harness.js';
import { THEMES, THEME_ORDER } from './themes.js';

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
