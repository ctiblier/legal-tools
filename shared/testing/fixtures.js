// shared/testing/fixtures.js
export const FIXTURE_BASE = '/fixtures/eml/';

export async function loadFixture(name) {
  const res = await fetch(FIXTURE_BASE + name);
  if (!res.ok) {
    throw new Error(
      'fixture ' + name + ' not found (' + res.status + ') — ' +
      'run `bash build.sh --dev` from the repository root, then serve batesstamp/'
    );
  }
  return new Uint8Array(await res.arrayBuffer());
}
