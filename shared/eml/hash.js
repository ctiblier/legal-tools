// SHA-256 over raw bytes. Requires a secure context: crypto.subtle is undefined
// over file://, so development must be served from http://localhost.

export async function sha256Hex(bytes) {
  if (!globalThis.crypto || !globalThis.crypto.subtle) {
    throw new Error(
      'crypto.subtle unavailable — this page must be served over https:// or http://localhost'
    );
  }
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// The footer carries a short digest for legibility; the certificate carries the
// full one. Twelve hex characters is 48 bits — ample to tie a loose page back to
// its source document, and short enough to sit in a footer without crowding it.
export function shortHash(hex) {
  return hex.slice(0, 12);
}
