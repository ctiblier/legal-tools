import { test, assert, assertEqual, assertDeepEqual } from '/shared/testing/harness.js';
import { sizeCheck } from './size-check.js';

const MB = 1024 * 1024;
const WARNING_MB = 25;
const HARD_MB = 100;

// sizeCheck returns the file objects it was given, so tests compare by name:
// it is the selection and its order that are under test, not object identity.
const names = (list) => list.map((f) => f.name);
const split = (files) => ({
  accepted: names(files.accepted),
  refused: names(files.refused),
  large: names(files.large),
});
const f = (name, mb) => ({ name, size: mb });

test('empty input gives three empty arrays', () => {
  assertDeepEqual(sizeCheck([], WARNING_MB, HARD_MB), { accepted: [], refused: [], large: [] });
});

test('exactly 25 MB is not large', () => {
  assertDeepEqual(split(sizeCheck([f('exact.eml', 25 * MB)], WARNING_MB, HARD_MB)), {
    accepted: ['exact.eml'], refused: [], large: []
  });
});

test('25 MB plus one byte is large', () => {
  assertDeepEqual(split(sizeCheck([f('just-over.eml', 25 * MB + 1)], WARNING_MB, HARD_MB)), {
    accepted: ['just-over.eml'], refused: [], large: ['just-over.eml']
  });
});

test('exactly 100 MB is accepted, and large', () => {
  assertDeepEqual(split(sizeCheck([f('hitting-limit.eml', 100 * MB)], WARNING_MB, HARD_MB)), {
    accepted: ['hitting-limit.eml'], refused: [], large: ['hitting-limit.eml']
  });
});

test('100 MB plus one byte is refused', () => {
  assertDeepEqual(split(sizeCheck([f('too-big.eml', 100 * MB + 1)], WARNING_MB, HARD_MB)), {
    accepted: [], refused: ['too-big.eml'], large: []
  });
});

test('a mixed batch partitions without reordering', () => {
  const result = sizeCheck([
    f('a-big.eml', 40 * MB),
    f('b-huge.eml', 120 * MB),
    f('c-small.eml', 2 * MB),
    f('d-refuse.eml', 101 * MB),
    f('e-exact-warn.eml', 25 * MB),
  ], WARNING_MB, HARD_MB);
  assertDeepEqual(split(result), {
    accepted: ['a-big.eml', 'c-small.eml', 'e-exact-warn.eml'],
    refused: ['b-huge.eml', 'd-refuse.eml'],
    large: ['a-big.eml']
  });
});

test('accepted and refused are the same objects that were passed in', () => {
  const big = f('big.eml', 40 * MB);
  const huge = f('huge.eml', 200 * MB);
  const result = sizeCheck([big, huge], WARNING_MB, HARD_MB);
  assert(result.accepted[0] === big, 'accepted should hold the original object');
  assert(result.refused[0] === huge, 'refused should hold the original object');
  assert(result.large[0] === big, 'large should hold the original object');
});

test('a batch of small files is neither refused nor warned about', () => {
  const result = sizeCheck([f('a.eml', 1 * MB), f('b.eml', 24 * MB)], WARNING_MB, HARD_MB);
  assertDeepEqual(split(result), { accepted: ['a.eml', 'b.eml'], refused: [], large: [] });
});

test('a batch in which everything is refused accepts nothing', () => {
  const result = sizeCheck([f('a.eml', 200 * MB), f('b.eml', 100 * MB + 1)], WARNING_MB, HARD_MB);
  assertDeepEqual(split(result), { accepted: [], refused: ['a.eml', 'b.eml'], large: [] });
});

test('thresholds come from the arguments, not from the 25/100 defaults', () => {
  // Told to warn above 10 MB and refuse above 15 MB, a 12 MB file is accepted
  // and large while a 20 MB file is refused — none of which the 25/100 pair
  // would produce.
  const files = [f('a.eml', 12 * MB), f('b.eml', 20 * MB), f('c.eml', 3 * MB)];
  assertDeepEqual(split(sizeCheck(files, 10, 15)), {
    accepted: ['a.eml', 'c.eml'], refused: ['b.eml'], large: ['a.eml']
  });
});

test('the module does not mutate the input array', () => {
  const files = [f('a.eml', 40 * MB), f('b.eml', 200 * MB)];
  sizeCheck(files, WARNING_MB, HARD_MB);
  assertDeepEqual(names(files), ['a.eml', 'b.eml']);
});
