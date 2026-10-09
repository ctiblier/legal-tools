// Drives every batesstamp tool end to end and reports CSP violations, page errors,
// failed requests and every third-party host contacted.
// Usage: dev/csp/run (or: node dev/csp/e2e.js <baseUrl> <fixturesDir> <outDir>)
// PLAYWRIGHT names the playwright package to load; the default is the cached npx copy.
const { chromium } = require(process.env.PLAYWRIGHT || '/home/ctibs/.npm/_npx/86170c4cd1c5da32/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const [BASE, FIX, OUT] = process.argv.slice(2);
const EXE = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
fs.mkdirSync(OUT, { recursive: true });

const problems = [];
const hosts = new Map();
const results = [];
const IGNORE_HOST_ERR = /cloudflareinsights/; // its cert fails the headless shell's trust store

function watch(page, label) {
  page.on('console', (m) => {
    const t = m.text();
    if (/Content.Security.Policy|Refused to/i.test(t)) problems.push(`[${label}] console: ${t}`);
    else if (m.type() === 'error' && !IGNORE_HOST_ERR.test(t)) problems.push(`[${label}] console error: ${t}`);
  });
  page.on('pageerror', (e) => problems.push(`[${label}] pageerror: ${e.message}`));
  page.on('worker', (w) => w.on('console', (m) => {
    if (/Content.Security.Policy|Refused to/i.test(m.text())) problems.push(`[${label}] worker: ${m.text()}`);
  }));
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.protocol.startsWith('http') && !BASE.startsWith(u.origin)) {
      const k = u.origin + u.pathname;
      hosts.set(k, (hosts.get(k) || 0) + 1);
    }
  });
  page.on('requestfailed', (r) => {
    if (!IGNORE_HOST_ERR.test(r.url())) problems.push(`[${label}] requestfailed: ${r.url()} ${r.failure().errorText}`);
  });
}

async function violations(page) {
  return page.evaluate(() => window.__cspv || []);
}

async function saveDownload(page, label, action, count = 1, timeout = 120000) {
  const got = [];
  const done = new Promise((resolve) => {
    const h = async (d) => {
      const f = path.join(OUT, label + '-' + d.suggestedFilename());
      await d.saveAs(f);
      const buf = fs.readFileSync(f);
      got.push({ name: d.suggestedFilename(), size: buf.length, magic: buf.subarray(0, 4).toString('latin1') });
      if (got.length >= count) { page.off('download', h); resolve(); }
    };
    page.on('download', h);
  });
  await action();
  await Promise.race([done, page.waitForTimeout(timeout)]);
  const ok = got.length >= count && got.every((g) => g.size > 0 && (g.magic === '%PDF' || g.magic.startsWith('PK')));
  results.push({ label, ok, got });
  if (!ok) problems.push(`[${label}] download check failed: ${JSON.stringify(got)}`);
  return got;
}

async function enabled(page, sel, timeout = 60000) {
  await page.waitForFunction((s) => { const b = document.querySelector(s); return b && !b.disabled; }, sel, { timeout })
    .catch(() => problems.push(`[${page.url()}] ${sel} never enabled`));
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  const ctx = await browser.newContext({ acceptDownloads: true });
  await ctx.addInitScript(() => {
    window.__cspv = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__cspv.push(`${e.violatedDirective} blocked ${e.blockedURI} (${e.sourceFile}:${e.lineNumber})`);
    });
  });

  async function open(url, label) {
    const page = await ctx.newPage();
    watch(page, label);
    const resp = await page.goto(BASE + url, { waitUntil: 'load' });
    if (!resp.headers()['content-security-policy']) problems.push(`[${label}] no CSP header on ${url}`);
    await page.waitForTimeout(1500);
    return page;
  }
  async function close(page, label) {
    await page.waitForTimeout(1000);
    for (const v of await violations(page)) problems.push(`[${label}] violation: ${v}`);
    await page.close();
  }

  // Static pages.
  for (const u of ['/', '/about.html', '/privacy-policy.html', '/terms-of-service.html']) {
    const p = await open(u, 'static' + u);
    if (u === '/' && !(await p.$('nav, .nav, header'))) problems.push('[home] nav missing');
    await close(p, 'static' + u);
  }

  // Build an input PDF (3 pages, text + image) with the page's own pdf-lib.
  let page = await open('/bates-stamp/', 'make-input');
  const png = fs.readFileSync(path.join(__dirname, '..', '..', 'batesstamp', 'favicon-192.png'));
  const pdfB64 = await page.evaluate(async (pngB64) => {
    const doc = await PDFLib.PDFDocument.create();
    const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
    const img = await doc.embedPng(Uint8Array.from(atob(pngB64), (c) => c.charCodeAt(0)));
    for (let i = 1; i <= 3; i++) {
      const pg = doc.addPage([612, 792]);
      pg.drawText('CSP test page ' + i + ' — confidential text', { x: 72, y: 700, size: 18, font });
      pg.drawImage(img, { x: 72, y: 450, width: 192, height: 192 });
    }
    doc.setTitle('Secret title'); doc.setAuthor('Secret author');
    const bytes = await doc.save();
    let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s);
  }, png.toString('base64'));
  const PDF = path.join(OUT, 'input.pdf');
  fs.writeFileSync(PDF, Buffer.from(pdfB64, 'base64'));
  const PDF2 = path.join(OUT, 'input2.pdf');
  fs.copyFileSync(PDF, PDF2);
  const PNG = path.join(OUT, 'exhibit.png');
  fs.writeFileSync(PNG, png);
  await close(page, 'make-input');

  // Bates stamp: one file (PDF), then two files (ZIP).
  page = await open('/bates-stamp/', 'bates-stamp');
  await page.setInputFiles('#pdfFile', PDF);
  await page.check('#addExhibit'); await page.check('#addConfidentiality');
  await page.waitForTimeout(1000);
  await saveDownload(page, 'bates-single', () => page.click('#stampBtn'));
  await page.click('#clearFilesBtn').catch(() => {});
  await page.setInputFiles('#pdfFile', [PDF, PDF2]);
  await page.waitForTimeout(1000);
  await saveDownload(page, 'bates-zip', () => page.click('#stampBtn'));
  await close(page, 'bates-stamp');

  // Compressor (pdf.js render + worker).
  page = await open('/compressor/', 'compressor');
  await page.setInputFiles('#fileInput', PDF);
  await enabled(page, '#compressBtn');
  await saveDownload(page, 'compressor', () => page.click('#compressBtn'));
  await close(page, 'compressor');

  // Metadata stripper.
  page = await open('/metadata-stripper/', 'metadata-stripper');
  await page.setInputFiles('#fileInput', PDF);
  await enabled(page, '#stripBtn');
  await saveDownload(page, 'metadata', () => page.click('#stripBtn'));
  await close(page, 'metadata-stripper');

  // Page extractor (pdf.js thumbnails).
  page = await open('/page-extractor/', 'page-extractor');
  await page.setInputFiles('#fileInput', PDF);
  await page.waitForFunction(() => document.querySelectorAll('[data-page-index] canvas, [data-page-index] img').length >= 3, null, { timeout: 60000 })
    .catch(() => problems.push('[page-extractor] thumbnails did not render'));
  await page.fill('#pageRange', '1, 3'); await page.press('#pageRange', 'Tab');
  await enabled(page, '#extractBtn');
  await saveDownload(page, 'extractor', () => page.click('#extractBtn'));
  await close(page, 'page-extractor');

  // Pleading paper.
  page = await open('/pleading-paper/', 'pleading-paper');
  await page.click('#captionToggle');
  await page.fill('#courtName', 'SUPERIOR COURT'); await page.fill('#caseCaption', 'A v. B');
  await page.fill('#caseNumber', '24-1'); await page.fill('#documentTitle', 'MOTION');
  await saveDownload(page, 'pleading', () => page.click('#generateBtn'));
  await close(page, 'pleading-paper');

  // Redaction: draw a box, then redact (pdf.js 300 DPI render).
  page = await open('/redaction/', 'redaction');
  await page.setInputFiles('#fileInput', PDF);
  await page.waitForFunction(() => document.getElementById('pdfCanvas').width > 0, null, { timeout: 60000 });
  await page.waitForTimeout(1000);
  await page.locator('#drawCanvas').scrollIntoViewIfNeeded();
  const box = await page.locator('#drawCanvas').boundingBox();
  await page.mouse.move(box.x + 40, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + box.height / 2 + 60, { steps: 5 }); await page.mouse.up();
  await enabled(page, '#redactBtn');
  await saveDownload(page, 'redaction', () => page.click('#redactBtn'));
  await close(page, 'redaction');

  // Watermark.
  page = await open('/watermark/', 'watermark');
  await page.setInputFiles('#fileInput', PDF);
  await enabled(page, '#watermarkBtn');
  await saveDownload(page, 'watermark', () => page.click('#watermarkBtn'));
  await close(page, 'watermark');

  // Filing assembler: main PDF + exhibits (PDF and PNG), Sortable list.
  page = await open('/filing-assembler/', 'filing-assembler');
  const inputs = await page.$$('input[type=file]');
  await inputs[0].setInputFiles(PDF);
  await inputs[1].setInputFiles([PDF2, PNG]);
  await page.fill('#caseName', 'Smith v. Jones');
  await enabled(page, '#assembleBtn');
  if (!(await page.evaluate(() => typeof Sortable === 'function'))) problems.push('[filing-assembler] Sortable missing');
  await saveDownload(page, 'assembler', () => page.click('#assembleBtn'));
  await close(page, 'filing-assembler');

  // Email to PDF: preview with a cid (blob:) image, separate conversion, then a combined batch.
  page = await open('/email-to-pdf/', 'email-to-pdf');
  await page.setInputFiles('#fileInput', path.join(FIX, '03-inline-cid-image.eml'));
  await page.waitForSelector('#preview img.eml-img', { timeout: 30000 })
    .catch(() => problems.push('[email-to-pdf] preview image missing'));
  const imgOk = await page.evaluate(() => {
    const i = document.querySelector('#preview img.eml-img');
    return i ? { src: i.src.slice(0, 5), w: i.naturalWidth } : null;
  });
  if (!imgOk || imgOk.w === 0) problems.push('[email-to-pdf] preview image did not load: ' + JSON.stringify(imgOk));
  results.push({ label: 'eml-preview-img', ok: !!(imgOk && imgOk.w), got: imgOk });
  await enabled(page, '#convertBtn');
  await saveDownload(page, 'eml-single', () => page.click('#convertBtn'));
  await page.setInputFiles('#fileInput', ['02-html-nested-quotes.eml', '07-large-pdf-attachment.eml', '08-outlook-tables.eml', '09-remote-images.eml', '14-attachment-rotated.eml']
    .map((f) => path.join(FIX, f)));
  await page.waitForTimeout(2000);
  await page.check('input[name="output"][value="combined"]');
  await enabled(page, '#convertBtn');
  await saveDownload(page, 'eml-combined', () => page.click('#convertBtn'), 1, 240000);
  await page.check('input[name="output"][value="separate"]');
  await enabled(page, '#convertBtn');
  await saveDownload(page, 'eml-separate-batch', () => page.click('#convertBtn'), 1, 240000);
  await close(page, 'email-to-pdf');

  await browser.close();
  console.log('RESULTS');
  for (const r of results) console.log((r.ok ? 'ok   ' : 'FAIL ') + r.label + ' ' + JSON.stringify(r.got));
  console.log('THIRD-PARTY REQUESTS');
  for (const [k, v] of hosts) console.log('  ' + v + 'x ' + k);
  console.log('PROBLEMS: ' + problems.length);
  for (const p of problems) console.log('  ' + p);
  process.exit(problems.length || results.some((r) => !r.ok) ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(2); });
