// Page cursor, pagination, footers and annotations. Knows about pages; knows
// nothing about email.
//
// Footers are stamped in finalize() rather than as each page is created, because
// "page 3 of 17" cannot be written until the seventeenth page exists.

const { rgb, PDFName, PDFString, PDFArray } = PDFLib;

const NAMED_COLORS = {
  black: [0, 0, 0], white: [1, 1, 1], red: [0.8, 0.1, 0.1], green: [0.1, 0.5, 0.2],
  blue: [0.1, 0.2, 0.7], gray: [0.5, 0.5, 0.5], grey: [0.5, 0.5, 0.5],
  navy: [0.05, 0.1, 0.4], maroon: [0.5, 0.1, 0.1], silver: [0.75, 0.75, 0.75]
};

/**
 * Convert a CSS colour from an email's style attribute into an rgb triple.
 * Runs carry `color` as whatever string the sender's mail client wrote, so the
 * conversion belongs here rather than in the pure block-IR layer. Anything
 * unrecognised returns null and the caller falls back to the theme's text
 * colour — an unreadable colour is worse than an unfaithful one.
 */
export function cssToRgb(value) {
  if (!value) return null;
  const str = String(value).trim().toLowerCase();

  if (NAMED_COLORS[str]) return NAMED_COLORS[str];

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(str);
  if (hex) {
    const h = hex[1].length === 3
      ? hex[1].split('').map((c) => c + c).join('')
      : hex[1];
    return [
      parseInt(h.slice(0, 2), 16) / 255,
      parseInt(h.slice(2, 4), 16) / 255,
      parseInt(h.slice(4, 6), 16) / 255
    ];
  }

  const fn = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(str);
  if (fn) {
    return [
      Math.min(255, parseInt(fn[1], 10)) / 255,
      Math.min(255, parseInt(fn[2], 10)) / 255,
      Math.min(255, parseInt(fn[3], 10)) / 255
    ];
  }

  return null;
}

export class PageWriter {
  constructor({ pdfDoc, theme, fontSet, footerLeft }) {
    this.pdfDoc = pdfDoc;
    this.theme = theme;
    this.fontSet = fontSet;
    this.footerLeft = footerLeft || '';
    this.pages = [];
    this.annots = new Map();      // page index -> array of annotation refs
    this.destinations = new Map(); // name -> {pageIndex, y}
    this.page = null;
    this.y = 0;
    this.newPage();
  }

  get pageCount() { return this.pages.length; }

  get contentWidth() {
    const m = this.theme.page.margin;
    return this.theme.page.width - m.left - m.right;
  }

  get left() { return this.theme.page.margin.left; }

  newPage() {
    this.page = this.pdfDoc.addPage([this.theme.page.width, this.theme.page.height]);
    this.pages.push(this.page);
    this.y = this.theme.page.height - this.theme.page.margin.top;
    return this.page;
  }

  get bottomLimit() { return this.theme.page.margin.bottom; }

  /** Start a new page if `height` will not fit below the cursor. */
  ensure(height) {
    if (this.y - height < this.bottomLimit) this.newPage();
    return this.page;
  }

  moveDown(dy) { this.y -= dy; }

  lineHeight(size) { return size * this.theme.leading; }

  measureToken(token, size) {
    const scale = (token.style && token.style.sizeScale) || 1;
    const effective = size * scale;
    const faceKey = this.fontSet.faceFor(token.style || {});
    let width = 0;
    for (const seg of this.fontSet.segment(token.text, faceKey)) {
      width += this.fontSet.font(seg.faceKey).widthOfTextAtSize(seg.text, effective);
    }
    return width;
  }

  /**
   * Draw one already-wrapped line of tokens. Returns the height consumed.
   * Link runs are drawn in the link colour and underlined, and get a clickable
   * annotation covering exactly the drawn extent.
   */
  drawLine(tokens, opts = {}) {
    const size = opts.size || this.theme.size.body;
    const x0 = opts.x != null ? opts.x : this.left;
    const baseColor = opts.color || this.theme.color.text;
    const height = this.lineHeight(size);

    this.ensure(height);
    const baseline = this.y - size;
    let x = x0;

    for (const token of tokens) {
      const style = token.style || {};
      const scale = style.sizeScale || 1;
      const effective = size * scale;
      const faceKey = this.fontSet.faceFor(style);
      const isLink = !!style.href;
      const colorArr = isLink
        ? this.theme.color.link
        : (cssToRgb(style.color) || baseColor);
      const tokenStartX = x;

      for (const seg of this.fontSet.segment(token.text, faceKey)) {
        const font = this.fontSet.font(seg.faceKey);
        this.page.drawText(seg.text, {
          x, y: baseline, size: effective, font,
          color: rgb(colorArr[0], colorArr[1], colorArr[2])
        });
        x += font.widthOfTextAtSize(seg.text, effective);
      }

      if (isLink && x > tokenStartX) {
        this.page.drawLine({
          start: { x: tokenStartX, y: baseline - 1.5 },
          end: { x, y: baseline - 1.5 },
          thickness: 0.5,
          color: rgb(colorArr[0], colorArr[1], colorArr[2])
        });
        this.linkTo(style.href, {
          x: tokenStartX, y: baseline - 2,
          width: x - tokenStartX, height: effective + 3
        });
      }

      if (style.underline && !isLink && x > tokenStartX) {
        this.page.drawLine({
          start: { x: tokenStartX, y: baseline - 1.5 },
          end: { x, y: baseline - 1.5 },
          thickness: 0.5,
          color: rgb(colorArr[0], colorArr[1], colorArr[2])
        });
      }

      if (style.strike && x > tokenStartX) {
        this.page.drawLine({
          start: { x: tokenStartX, y: baseline + effective * 0.28 },
          end: { x, y: baseline + effective * 0.28 },
          thickness: 0.5,
          color: rgb(colorArr[0], colorArr[1], colorArr[2])
        });
      }
    }

    this.y -= height;
    return height;
  }

  drawRule({ x, width, color, thickness } = {}) {
    const c = color || this.theme.color.rule;
    this.ensure(4);
    this.page.drawLine({
      start: { x: x != null ? x : this.left, y: this.y },
      end: { x: (x != null ? x : this.left) + (width || this.contentWidth), y: this.y },
      thickness: thickness || 0.5,
      color: rgb(c[0], c[1], c[2])
    });
  }

  drawRect({ x, y, width, height, color }) {
    const c = color || this.theme.color.band;
    this.page.drawRectangle({
      x, y, width, height, color: rgb(c[0], c[1], c[2])
    });
  }

  _annotsFor(pageIndex) {
    if (!this.annots.has(pageIndex)) this.annots.set(pageIndex, []);
    return this.annots.get(pageIndex);
  }

  linkTo(url, rect) {
    const ref = this.pdfDoc.context.register(
      this.pdfDoc.context.obj({
        Type: 'Annot',
        Subtype: 'Link',
        Rect: [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height],
        Border: [0, 0, 0],
        A: this.pdfDoc.context.obj({ Type: 'Action', S: 'URI', URI: PDFString.of(url) })
      })
    );
    this._annotsFor(this.pages.length - 1).push(ref);
  }

  /** Record the current position as a named target for a table-of-contents link. */
  markDestination(name) {
    this.destinations.set(name, { pageIndex: this.pages.length - 1, y: this.y });
  }

  linkToDestination(name, rect) {
    const target = this.destinations.get(name);
    if (!target) return; // destination not yet written; caller orders TOC last
    const ref = this.pdfDoc.context.register(
      this.pdfDoc.context.obj({
        Type: 'Annot',
        Subtype: 'Link',
        Rect: [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height],
        Border: [0, 0, 0],
        Dest: [this.pages[target.pageIndex].ref, PDFName.of('XYZ'), 0, target.y, null]
      })
    );
    this._annotsFor(this.pages.length - 1).push(ref);
  }

  /**
   * Stamp footers and attach annotations. Call exactly once, after all content.
   *
   * Footers go on every page, including pages copied in from an attached PDF.
   * That is deliberate: continuous "page n of N" numbering across the whole
   * exhibit is what lets a single loose page be placed back in the document. The
   * cost is that a footer may overprint content sitting in an attachment page's
   * bottom margin. Task 18's checklist looks for this on the 6 MB PDF fixture.
   */
  finalize() {
    const total = this.pages.length;
    const size = this.theme.size.footer;
    const font = this.fontSet.font('regular');
    const c = this.theme.color.muted;

    this.pages.forEach((page, i) => {
      const y = this.theme.page.margin.bottom * 0.55;
      page.drawText(this.footerLeft, {
        x: this.left, y, size, font, color: rgb(c[0], c[1], c[2])
      });
      const right = 'page ' + (i + 1) + ' of ' + total;
      const w = font.widthOfTextAtSize(right, size);
      page.drawText(right, {
        x: this.theme.page.width - this.theme.page.margin.right - w,
        y, size, font, color: rgb(c[0], c[1], c[2])
      });

      const refs = this.annots.get(i);
      if (refs && refs.length) {
        const arr = PDFArray.withContext(this.pdfDoc.context);
        for (const ref of refs) arr.push(ref);
        page.node.set(PDFName.of('Annots'), arr);
      }
    });
  }
}
