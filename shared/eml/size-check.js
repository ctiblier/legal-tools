// shared/eml/size-check.js
// Size gate for the Email to PDF page, applied before any parsing.
//
// The design spec (§7, "Size") wants two thresholds, not one: a file over the
// hard limit cannot be converted in a browser tab at all and is refused, while a
// file over the soft limit is converted but is worth a word of warning, because
// conversion is single-threaded work in the tab and a 60 MB mbox-derived .eml
// will sit there for a while. Only the hard limit filtered anything; this module
// makes both decisions in one place so the page cannot get them into a
// contradictory order.
//
// `warnMb` and `hardMb` are megabytes, and a megabyte is 1024 * 1024 bytes — the
// same convention as `initFileDropZone`'s `maxSizeMB`.
//
// Both comparisons are strict: a file of exactly `warnMb` MB is not large, and a
// file of exactly `hardMb` MB is accepted. The byte counts on disk are what they
// are; there is no reason to refuse the round number.

const MB = 1024 * 1024;

/**
 * @param {Array<{name: string, size: number}>} files Files or file-like objects
 *   in the order the user selected them.
 * @param {number} warnMb Soft threshold; accepted files strictly above it are `large`.
 * @param {number} hardMb Hard threshold; files strictly above it are `refused`.
 * @returns {{accepted: Array, refused: Array, large: Array}} `accepted` and
 *   `refused` partition `files`, each in the original order; `large` is the
 *   subset of `accepted` over the soft threshold.
 */
export function sizeCheck(files, warnMb, hardMb) {
  const accepted = [];
  const refused = [];
  const large = [];
  for (const file of files) {
    if (file.size > hardMb * MB) {
      refused.push(file);
    } else {
      accepted.push(file);
      if (file.size > warnMb * MB) large.push(file);
    }
  }
  return { accepted, refused, large };
}
