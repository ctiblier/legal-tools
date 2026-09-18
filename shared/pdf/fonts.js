// TTF embedding, per-codepoint face resolution, and substitution accounting.
//
// Depends on globals `PDFLib` and `fontkit` from <script> tags on the page.
//
// Two families of four faces each carry the type; one fallback face covers
// codepoints they lack. Anything neither covers is substituted with U+FFFD and
// counted, so the certificate can say how many characters could not be rendered
// rather than letting them vanish.

const FONT_DIR = '/fonts/pdf/';

const FAMILY_FILES = {
  sans: {
    regular: 'LiberationSans-Regular.ttf',
    bold: 'LiberationSans-Bold.ttf',
    italic: 'LiberationSans-Italic.ttf',
    bolditalic: 'LiberationSans-BoldItalic.ttf'
  },
  serif: {
    regular: 'LiberationSerif-Regular.ttf',
    bold: 'LiberationSerif-Bold.ttf',
    italic: 'LiberationSerif-Italic.ttf',
    bolditalic: 'LiberationSerif-BoldItalic.ttf'
  }
};

const MONO_FILE = 'LiberationMono-Regular.ttf';
const FALLBACK_FILE = 'DejaVuSans.ttf';

const REPLACEMENT = '�';

const cache = new Map(); // filename -> Uint8Array, so a batch loads each face once

async function fetchFont(file) {
  if (cache.has(file)) return cache.get(file);
  const res = await fetch(FONT_DIR + file);
  if (!res.ok) throw new Error('Could not load font ' + file + ' (' + res.status + ')');
  const bytes = new Uint8Array(await res.arrayBuffer());
  cache.set(file, bytes);
  return bytes;
}

/**
 * @param {PDFDocument} pdfDoc
 * @param {{family?: 'sans'|'serif'}} [opts]
 */
export async function loadFontSet(pdfDoc, opts = {}) {
  const family = opts.family === 'serif' ? 'serif' : 'sans';
  pdfDoc.registerFontkit(fontkit);

  const files = Object.assign({}, FAMILY_FILES[family], {
    mono: MONO_FILE,
    fallback: FALLBACK_FILE
  });

  const faces = new Map();
  for (const [key, file] of Object.entries(files)) {
    const bytes = await fetchFont(file);
    faces.set(key, {
      // subset: true keeps only the glyphs actually drawn, so a one-page email
      // does not carry four megabytes of unused type.
      pdfFont: await pdfDoc.embedFont(bytes, { subset: true }),
      fk: fontkit.create(bytes)
    });
  }

  const state = { substitutions: 0 };

  function covers(faceKey, cp) {
    const face = faces.get(faceKey);
    return !!(face && face.fk.hasGlyphForCodePoint(cp));
  }

  return {
    get substitutions() { return state.substitutions; },

    faceFor(style) {
      if (style && style.mono) return 'mono';
      if (style && style.bold && style.italic) return 'bolditalic';
      if (style && style.bold) return 'bold';
      if (style && style.italic) return 'italic';
      return 'regular';
    },

    font(faceKey) {
      const face = faces.get(faceKey);
      // Every caller passes a key that segment() produced or a literal from this
      // module's own set, so a miss is a programming error. Falling back to the
      // regular face would draw the document in the wrong typeface and say nothing.
      if (!face) throw new Error('unknown font face key: ' + faceKey);
      return face.pdfFont;
    },

    /**
     * Split text into runs of consecutive characters drawable by one face.
     * Never drops a character: an uncovered codepoint becomes U+FFFD on the
     * fallback face.
     *
     * Counting is opt-in via `count`, and only the drawing path may opt in.
     * Segmenting is not idempotent with respect to the counter, and the same
     * text is segmented several times: once per measurement while wrapping,
     * once per character inside hardBreak() against a growing buffer, and once
     * more to draw. Counting on every call inflated the certificate's
     * substitution figure 2x in the simple case and quadratically for a long
     * unbreakable token — a numbered false statement on a document whose whole
     * purpose is to describe its own conversion precisely.
     */
    segment(text, faceKey, { count = false } = {}) {
      const segments = [];
      let current = null;

      for (const ch of String(text)) {
        const cp = ch.codePointAt(0);
        let useKey;
        let useText = ch;

        if (covers(faceKey, cp)) {
          useKey = faceKey;
        } else if (covers('fallback', cp)) {
          useKey = 'fallback';
        } else {
          if (count) state.substitutions++;
          useKey = 'fallback';
          useText = REPLACEMENT;
        }

        if (current && current.faceKey === useKey) current.text += useText;
        else { current = { text: useText, faceKey: useKey }; segments.push(current); }
      }

      return segments;
    }
  };
}
