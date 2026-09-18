// shared/testing/harness.js
// Minimal in-browser assertion runner. No dependencies, no build step.
//
// Usage:
//   import { test, assertEqual, runAll } from '/shared/testing/harness.js';
//   test('does the thing', () => { assertEqual(1 + 1, 2); });
//   runAll();
//
// runAll() renders results into #results and writes a machine-readable summary
// to window.__TEST_SUMMARY and document.title so a headless driver can read it
// without scraping the DOM.

const cases = [];

export function test(name, fn) {
  cases.push({ name, fn });
}

export class AssertionError extends Error {}

export function assert(cond, msg) {
  if (!cond) throw new AssertionError(msg || 'expected truthy value');
}

export function assertEqual(actual, expected, msg) {
  if (!Object.is(actual, expected)) {
    throw new AssertionError(
      (msg ? msg + ': ' : '') +
      'expected ' + JSON.stringify(expected) + ' but got ' + JSON.stringify(actual)
    );
  }
}

// Structural comparison by serialisation. Key order matters, which is fine here:
// every value compared in these tests is built by our own code in a fixed order.
export function assertDeepEqual(actual, expected, msg) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new AssertionError(
      (msg ? msg + ': ' : '') + 'expected\n' + JSON.stringify(expected, null, 2) +
      '\nbut got\n' + JSON.stringify(actual, null, 2)
    );
  }
}

export function assertThrows(fn, msg) {
  let threw = false;
  try { fn(); } catch (e) { threw = true; }
  if (!threw) throw new AssertionError(msg || 'expected the function to throw');
}

export async function runAll() {
  const out = document.getElementById('results');
  let passed = 0;
  const failures = [];

  for (const c of cases) {
    let error = null;
    try {
      await c.fn();
      passed++;
    } catch (e) {
      error = e;
      failures.push({ name: c.name, message: e.message, stack: e.stack });
    }
    if (out) {
      const row = document.createElement('div');
      row.className = error ? 'test-fail' : 'test-pass';
      row.textContent = (error ? 'FAIL  ' : 'pass  ') + c.name +
        (error ? '\n      ' + error.message : '');
      out.appendChild(row);
    }
  }

  const summary = { total: cases.length, passed, failed: failures.length, failures };
  window.__TEST_SUMMARY = summary;
  document.title = failures.length
    ? 'FAIL ' + failures.length + '/' + cases.length
    : 'PASS ' + passed + '/' + cases.length;

  if (out) {
    const banner = document.createElement('div');
    banner.className = failures.length ? 'test-summary fail' : 'test-summary pass';
    banner.textContent = failures.length
      ? failures.length + ' of ' + cases.length + ' failed'
      : 'all ' + passed + ' passed';
    out.prepend(banner);
  }
  return summary;
}

/** Extract all text from a PDF's pages, for asserting on what actually rendered. */
export async function extractPdfText(bytes) {
  const doc = await pdfjsLib.getDocument({ data: bytes }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    // pdf.js reports one item per run (often per word), each already carrying its
    // own trailing space; joining them with another space and collapsing the
    // result is what makes a plain substring match reliable — without it, every
    // multi-word phrase comes back with doubled or tripled internal spaces and
    // no literal substring assertion can ever match, regardless of what the PDF
    // actually contains.
    //
    // Collapsing whitespace like this is deliberately lossy: it cannot detect a
    // genuine phrase-break defect (stray content interleaved into body text,
    // silently breaking phrase search) if that defect happens to look like
    // ordinary word spacing once collapsed. This helper is for asserting that
    // specific text appears somewhere on the page, not a general-purpose
    // fidelity check — the phrase-break failure mode is covered separately by
    // Task 18's manual checklist item ("Ctrl-F a phrase spanning a line break").
    pages.push(content.items.map((it) => it.str).join(' ').replace(/\s+/g, ' ').trim());
  }
  return pages.join('\n');
}

/**
 * Per-page text items with their baseline coordinates.
 *
 * extractPdfText() collapses a page to a single string, which is the right shape
 * for "does this text appear" but throws away position — so it cannot answer
 * whether two pieces of text land on top of each other. Anything about layout,
 * overlap or margins needs this instead.
 *
 * @returns {Promise<Array<Array<{str: string, x: number, y: number}>>>}
 */
export async function extractPdfTextItems(bytes) {
  const doc = await pdfjsLib.getDocument({ data: bytes }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(content.items
      .filter((it) => it.str.trim())
      .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5] })));
  }
  return pages;
}
