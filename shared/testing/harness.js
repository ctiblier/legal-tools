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
