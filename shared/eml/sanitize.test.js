import { test, assert, assertEqual } from '/shared/testing/harness.js';
import { loadFixture } from '/shared/testing/fixtures.js';
import { parseEml } from './parse.js';
import { sanitizeHtml } from './sanitize.js';

test('strips script and style elements and counts them', () => {
  const { body, stats } = sanitizeHtml(
    '<p>keep</p><script>evil()</script><style>.x{}</style>', new Map()
  );
  assertEqual(body.querySelector('script'), null);
  assertEqual(body.querySelector('style'), null);
  assertEqual(stats.activeContentRemoved, 2);
  assert(body.textContent.includes('keep'), 'visible content survives');
});

test('strips event handler attributes and javascript: hrefs', () => {
  const { body } = sanitizeHtml(
    '<a href="javascript:evil()" onclick="evil()">click</a>', new Map()
  );
  const a = body.querySelector('a');
  assertEqual(a.getAttribute('onclick'), null);
  assertEqual(a.getAttribute('href'), null);
});

test('blocks remote images and leaves a labeled placeholder', () => {
  const { body, stats } = sanitizeHtml(
    '<img src="https://cdn.example/banner.png" alt="Banner" width="600" height="120">',
    new Map()
  );
  assertEqual(body.querySelector('img'), null);
  const ph = body.querySelector('[data-blocked-image]');
  assert(ph, 'placeholder element inserted');
  assertEqual(ph.getAttribute('data-alt'), 'Banner');
  assertEqual(stats.remoteImagesBlocked, 1);
  assertEqual(stats.trackingPixelsBlocked, 0);
});

test('counts 1x1 remote images as tracking pixels separately', () => {
  const { stats } = sanitizeHtml(
    '<img src="https://track.example/o?id=1" width="1" height="1">', new Map()
  );
  assertEqual(stats.remoteImagesBlocked, 1);
  assertEqual(stats.trackingPixelsBlocked, 1);
});

test('resolves cid: images against the attachment map', () => {
  const inline = new Map([['markup001', { contentId: 'markup001', mimeType: 'image/png' }]]);
  const { body, stats } = sanitizeHtml(
    '<img src="cid:markup001" width="48" height="48">', inline
  );
  const img = body.querySelector('[data-cid-ref]');
  assertEqual(img.getAttribute('data-cid-ref'), 'markup001');
  assertEqual(stats.unresolvedCidImages, 0);
});

test('an unresolvable cid becomes a placeholder and is counted', () => {
  const { body, stats } = sanitizeHtml('<img src="cid:missing">', new Map());
  assertEqual(stats.unresolvedCidImages, 1);
  assert(body.querySelector('[data-blocked-image]'), 'placeholder inserted');
});

test('data: images are preserved', () => {
  const url = 'data:image/png;base64,iVBORw0KGgo=';
  const { body } = sanitizeHtml('<img src="' + url + '">', new Map());
  assertEqual(body.querySelector('[data-data-uri]').getAttribute('data-data-uri'), url);
});

test('a visible image at a tracker-ish URL still gets a placeholder', () => {
  const { body, stats } = sanitizeHtml(
    '<img src="https://ads.example/pixel/creative123.jpg" alt="Promo" width="600" height="120">',
    new Map()
  );
  assert(body.querySelector('[data-blocked-image]'), 'placeholder inserted, not deleted');
  assertEqual(stats.remoteImagesBlocked, 1);
  assertEqual(stats.trackingPixelsBlocked, 0, 'a URL keyword is not proof of a pixel');
});

test('percentage geometry is not pixel geometry', () => {
  // parseInt('1%', 10) is 1, so a width="1%" height="1%" image satisfied the
  // 1x1 test and was removed outright — the only blocked remote image that got
  // no placeholder. A percentage says nothing about rendered size, so it is not
  // proof the image had nothing to show, and deleting visible content unmarked
  // is the one thing this function must never do.
  const { body, stats } = sanitizeHtml(
    '<img src="https://cdn.example/banner.png" alt="Banner" width="1%" height="1%">',
    new Map()
  );
  assert(body.querySelector('[data-blocked-image]'),
    'placeholder inserted, not deleted');
  assertEqual(stats.remoteImagesBlocked, 1);
  assertEqual(stats.trackingPixelsBlocked, 0,
    'a percentage is not a declared 1x1');
});

test('an image with a relative or unknown-scheme src is disclosed, not dropped', () => {
  const { body, stats } = sanitizeHtml('<img src="logo.png" alt="Logo">', new Map());
  assert(body.querySelector('[data-blocked-image]'), 'placeholder inserted');
  assertEqual(stats.remoteImagesBlocked, 1);
});

test('the real marketing fixture loses its pixel, banner and script', async () => {
  const rec = await parseEml(await loadFixture('09-remote-images.eml'));
  const { body, stats } = sanitizeHtml(rec.bodyHtml, rec.inlineImages);
  assertEqual(stats.remoteImagesBlocked, 2);
  assertEqual(stats.trackingPixelsBlocked, 1);
  assertEqual(body.querySelector('script'), null);
  assert(body.querySelector('a[href^="https://portal"]'), 'link targets survive as text');
});
