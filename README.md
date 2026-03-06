# Legal Tools Monorepo

Monorepo for free legal tools built for attorneys and legal professionals.

| Site | Domain | Description |
|------|--------|-------------|
| [BatesStamp](batesstamp/) | [batesstamp.com](https://batesstamp.com) | Free browser-based Bates stamping for PDFs |
| [PFSCalculator](pfscalculator/) | [pfscalculator.com](https://pfscalculator.com) | Florida Statute 768.79 settlement calculator |

---

## Repository Structure

```
legal-tools/
├── shared/
│   └── brand.css              # Shared design system (tokens, layout, components)
├── batesstamp/
│   ├── index.html             # Main tool page
│   ├── styles.css             # @imports brand.css + site-specific styles
│   ├── about.html
│   ├── privacy-policy.html
│   ├── terms-of-service.html
│   └── (static assets)
├── pfscalculator/
│   ├── index.html             # Main calculator page
│   ├── style.css              # @imports brand.css + site-specific styles
│   ├── script.js              # Calculator logic
│   ├── about.html
│   ├── privacy-policy.html
│   ├── terms-of-service.html
│   ├── 404.html
│   └── (static assets)
└── README.md
```

---

## Hosting & Deployment

Both sites are deployed via **Cloudflare Pages** from this single repo.

### Cloudflare Pages Configuration

**BatesStamp project:**
- Repository: `ctiblier/legal-tools`
- Build command: `cp shared/brand.css batesstamp/`
- Build output directory: `batesstamp`
- Custom domain: `batesstamp.com`

**PFSCalculator project:**
- Repository: `ctiblier/legal-tools`
- Build command: `cp shared/brand.css pfscalculator/`
- Build output directory: `pfscalculator`
- Custom domain: `pfscalculator.com`

### Build Watch Paths (optional, recommended)

To avoid unnecessary rebuilds, set build watch paths in each project's settings:

- **batesstamp**: `shared/**`, `batesstamp/**`
- **pfscalculator**: `shared/**`, `pfscalculator/**`

### How Deploys Work

1. Push to `main` triggers Cloudflare Pages builds
2. The build command copies `shared/brand.css` into the site directory
3. Cloudflare serves the site directory as a static site
4. Both sites rebuild on any push (unless watch paths are configured)

---

## Shared Brand System

The file `shared/brand.css` is the single source of truth for visual consistency across both sites. It defines:

- **Design tokens** — Colors (navy scale, gold accent, grays), typography (Crimson Pro + DM Sans), spacing, shadows, radii
- **Base styles** — Reset, body, container
- **Header** — Navy gradient with SVG pattern, gold border accent
- **Navigation** — Centered links with gold hover underlines
- **Footer** — 3-column grid (brand info, page links, cross-site links)
- **Shared components** — Page content styles, feature grids, mission box, contact box, disclaimer, badges, ad containers
- **Responsive** — Mobile breakpoints for all shared components

### CSS Architecture

```
shared/brand.css           ← Edit here for brand-wide changes
       ↓ @import
batesstamp/styles.css      ← Site-specific: drop zone, stamp controls, status messages
pfscalculator/style.css    ← Site-specific: calculator boxes, radio buttons, results
```

### Fonts (loaded via Google Fonts in each HTML file)

- **Display**: Crimson Pro (headings) — weights 400, 600, 700
- **Body**: DM Sans (UI/body text) — weights 400, 500, 600, 700

### Color Palette

| Token | Value | Usage |
|-------|-------|-------|
| `--navy-deep` | `#0f1c2e` | Page background |
| `--navy` | `#1e3a5f` | Primary brand, nav background |
| `--navy-mid` | `#2c5282` | Links, focus rings, accents |
| `--gold` | `#c9a227` | Accent borders, hover effects |
| `--cream` | `#fafaf8` | Section backgrounds |
| `--off-white` | `#f6f7f9` | Footer background |

---

## Development Workflow

```bash
# Navigate to repo
cd /home/ctibs/Projects/legal-tools

# Edit shared brand (affects both sites)
vim shared/brand.css

# Edit site-specific styles
vim batesstamp/styles.css
vim pfscalculator/style.css

# Test locally — open HTML files directly or use a local server
# Note: @import brand.css requires serving files (not file:// protocol)
python3 -m http.server 8080 --directory batesstamp  # after: cp shared/brand.css batesstamp/

# Commit and push — both sites redeploy automatically
git add -A && git commit -m "description" && git push
```

### Local Testing

Because the CSS uses `@import url('brand.css')`, you need to copy the shared file before testing locally:

```bash
cp shared/brand.css batesstamp/
cp shared/brand.css pfscalculator/
```

Then serve with any local HTTP server. Do NOT commit these copies — they are created by the Cloudflare build step.

---

## Migration History

**March 2026** — Consolidated from two separate repos into this monorepo:
- `ctiblier/batesstamp` (GitHub Pages) → `legal-tools/batesstamp/` (Cloudflare Pages)
- `ctiblier/PFSCalculator` (GitHub Pages) → `legal-tools/pfscalculator/` (Cloudflare Pages)

Changes made during migration:
- Created shared brand stylesheet from BatesStamp's design system
- Unified PFSCalculator to match: Crimson Pro font, CSS custom properties, semantic `<nav>`, 3-column footer
- Removed Buy Me a Coffee from all PFSCalculator pages
- Moved hosting from GitHub Pages to Cloudflare Pages

The original repos are preserved as archives.

---

## Analytics

Both sites use:
- **Google Analytics** (separate tracking IDs per site)
- **Umami Analytics** (self-hosted at `umami.ctibs.app`, separate website IDs)
- **Google AdSense** (same publisher ID: `ca-pub-9125889511214710`)

## Contact

**Email:** contact@ctibs.app
