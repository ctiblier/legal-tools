# Content Security Policy

batesstamp.com promises that documents never leave the browser. The policy in
`batesstamp/_headers` lets the browser enforce that: a page can send data only
to its own origin and to Umami's collection endpoint, and can run only its own
scripts plus five pinned third-party files. Cloudflare Pages applies
`_headers` to every response, including the workers' own scripts.

A wrong policy fails silently for users: the tool stops working and nothing
reaches us. **Any change to the policy, or to what a page loads, must pass
`dev/csp/run` before it is pushed.**

## Directives

| Directive | Value | Why |
|---|---|---|
| `default-src` | `'none'` | Anything not listed below is refused. |
| `script-src` | `'self'` + five exact file URLs | pdf-lib and JSZip (unpkg), pdf.js and Sortable (cdnjs), Umami's `script.js`. Exact paths, not hosts: unpkg serves every npm package, so a bare host would let an injection load anything. There is no `'unsafe-inline'` and no `'unsafe-eval'`. |
| `worker-src` | `'self'` | The pdf.js worker (`/vendor/pdfjs-3.11.174/`) and the session SharedWorker (`/shared/session-worker.js`). |
| `child-src` | `'self'` | The same, for Safari before 15.5, which ignores `worker-src`. |
| `connect-src` | `'self'` + `https://umami.ctibs.app/api/send` | `'self'` because `shared/pdf/fonts.js` fetches the embedded fonts. The site is static, so there is no same-origin endpoint that accepts data. |
| `img-src` | `'self' data: blob:` | `data:` for the brand.css background and email `data:` images. `blob:` for the email preview's inline (cid) images. |
| `style-src` | `'self' 'unsafe-inline'` | There are about 30 `style=""` attributes and two `<style>` blocks. Injected CSS cannot run code, so removing this isn't worth the churn. |
| `font-src` | `'self'` | Fonts are self-hosted (`fonts.css`). |
| `manifest-src` | `'self'` | `manifest.json`. |
| `object-src`, `base-uri`, `form-action`, `frame-ancestors` | `'none'` | There are no plugins and no `<base>`, the forms don't submit, and the site is never framed. |

## Rules that keep the policy working

- **No inline `<script>`.** Each page's code lives in a file next to it
  (`/<tool>/app.js`, `/home.js`, `/email-to-pdf/nav-init.js`). JSON-LD blocks
  (`type="application/ld+json"`) are data and are fine. No `on*=` attributes.
- **A new or upgraded CDN script** needs its exact URL added to `script-src`.
  Bumping a version without changing the header blocks the script.
- **pdf.js must be called with `isEvalSupported: false`.** Otherwise it probes
  `new Function` and logs a violation. The three `getDocument` calls pass it.
- **Cloudflare Web Analytics is off.** Its injected beacon
  (`static.cloudflareinsights.com`) is not allowed. Umami covers analytics. If
  it is turned back on, it needs `script-src` and `connect-src` entries and a
  privacy-policy disclosure.
- **Cloudflare email obfuscation is on.** On the live site it rewrites the
  `mailto:` link on `/about` and injects
  `/cdn-cgi/scripts/.../email-decode.min.js`. That is a same-origin external
  script, so `'self'` allows it. It never appears locally; only
  `dev/csp/run https://batesstamp.com` exercises it.
- **The dev test page** (`/email-to-pdf/tests.html`) uses inline scripts. It is
  only staged by `build.sh --dev` and served by a plain `http.server`, which
  doesn't apply `_headers`, so the policy doesn't affect it. Never deploy a
  `--dev` build.

## Testing

```bash
dev/csp/run                         # plain build, served locally with the _headers policy
dev/csp/run https://batesstamp.com  # after a deploy
```

The script runs every tool end to end in headless Chromium: Bates stamp
(single and ZIP), compressor, metadata stripper, page extractor, pleading
paper, redaction, watermark and filing assembler, plus Email to PDF (preview
with a blob image, single, combined batch, separate batch ZIP). It fails on
any CSP violation reported to a page's document, page error, failed request,
or download that isn't a non-empty PDF or ZIP. It also lists every third-party URL
contacted. Set `PLAYWRIGHT` to a playwright package path if the cached npx copy
is gone.

**What it does not see:** violations raised inside a worker. They fire on the
worker's global scope, not on the document, and Playwright doesn't pass them
on. The test PDF also uses only a standard font and a PNG, so it doesn't reach
the pdf.js worker paths where `isEvalSupported` matters (embedded fonts, Type 4
functions). Both workers are same-origin scripts, which `worker-src 'self'`
allows. After changing pdf.js options, check a real-world PDF by hand.

`dev/csp/server.py` reproduces Cloudflare's `/*` header block locally.
