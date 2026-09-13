# Vendored dependencies

Committed rather than CDN-loaded. This site self-hosts its fonts so that
rendering a page contacts no third party (commit `58a5a5d`); a tool whose promise
is that confidential email never leaves the browser should not fetch its MIME
parser from someone else's server at page load either.

| File | Package | Version | Source | SHA-256 |
|---|---|---|---|---|
| `postal-mime/*.js` (10 files) | postal-mime | 3.0.0 | `https://cdn.jsdelivr.net/npm/postal-mime@3.0.0/src/` | see below |
| `fontkit.umd.js` | @pdf-lib/fontkit | 1.1.1 | `https://unpkg.com/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js` | *(paste the sha256sum output from Task 8 Step 1)* |

```
893f32e8d45a9c571a403eb83bb7896e78bdd08996a2fad5ee7cf77c89517f74  postal-mime/address-parser.js
a4dc92b730d7917eaab7057c680e7297007371ce914231b8239262e0fd9ea358  postal-mime/base64-decoder.js
71161ff0ab6bedf58a047d3fc5631b50d5f60655938a418d9f49cac75bc01251  postal-mime/base64-encoder.js
71e2890cd6c7ff8142eba5b1f7d400415a62791a26388820892573a35ecb814f  postal-mime/decode-strings.js
9a81283d735d6c150b0f363d661458a8f15a225d46c48a54b74bae8f5ed61c28  postal-mime/html-entities.js
ceb3c4f9b6b42bb5b754c5b380df2aefa8edb566138da28b883ff6a5d89afe1e  postal-mime/mime-node.js
f4634372883fae15571f79b16f13ded743006fb3fc9c8d4e68e785f36c72dc44  postal-mime/pass-through-decoder.js
e87743ef76b041fc7245074b304cc5d22b527f058cd6bb08df4622479ca76b6c  postal-mime/postal-mime.js
680c6278d36287773cae17720a9af902ea0f8764233733a8c9b767cfd6eadbb7  postal-mime/qp-decoder.js
88de6ee6bde6cb5ce170197acd7af3090d0ddfd6eab01a6e8ae670564e5e3d7d  postal-mime/text-format.js
```

postal-mime ships unbundled ES modules with relative sibling imports, so the whole
`src/` directory is vendored rather than a single file.

To update: download the new version, replace the directory, re-run the import
audit from Task 4 Step 1, record the new hashes here, and re-run
`/email-to-pdf/tests.html` in full before committing. The parser's return shape is
load-bearing for `shared/eml/parse.js`.
