#!/bin/bash
# Build script for BatesStamp Legal Toolkit
# Copies shared files into the Cloudflare Pages deploy directory (batesstamp/)

set -e

echo "Building BatesStamp Legal Toolkit..."

# Shared CSS lands at the site root (referenced as /brand.css)
cp shared/brand.css batesstamp/

# Shared JS — copied wholesale, including nested directories (eml/, pdf/, testing/);
# a plain build then strips the test-only parts below.
# batesstamp/shared/ is gitignored build output; it is rebuilt from scratch each time
# so a deleted source file cannot survive as a stale copy.
rm -rf batesstamp/shared
mkdir -p batesstamp/shared
cp -R shared/. batesstamp/shared/
rm -f batesstamp/shared/brand.css

# Test-only material is tracked outside the served tree and never deployed:
# the test page and pdf.js (dev/), the in-browser harness (shared/testing/),
# every *.test.js module, and the .eml fixtures (docs/fixtures/eml/). Clear any
# previously staged copies unconditionally, so a plain build after a --dev build
# in the same tree cannot carry them into the output. Pages builds from a fresh
# clone and the staged paths are gitignored, so this guards the local
# build-and-upload case rather than the hosted one.
rm -rf batesstamp/fixtures
rm -f batesstamp/email-to-pdf/tests.html
rm -f batesstamp/vendor/pdf.min.js batesstamp/vendor/pdf.worker.min.js

if [ "$1" = "--dev" ]; then
  # Development only: stage the test page and fixtures inside the served root so
  # the test page can fetch them at the same absolute paths production uses.
  # Never run with --dev for a deployed build; Cloudflare Pages runs
  # `bash build.sh` with no arguments.
  cp dev/email-to-pdf/tests.html batesstamp/email-to-pdf/
  cp dev/vendor/pdf.min.js dev/vendor/pdf.worker.min.js batesstamp/vendor/
  if [ -d docs/fixtures/eml ]; then
    mkdir -p batesstamp/fixtures
    cp -R docs/fixtures/eml batesstamp/fixtures/
    echo "Dev test page and fixtures staged (/email-to-pdf/tests.html)"
  else
    echo "No fixtures at docs/fixtures/eml/ — skipping fixture staging."
    echo "Run: python3 docs/fixtures/eml/generate.py"
  fi
else
  rm -rf batesstamp/shared/testing
  find batesstamp/shared -name '*.test.js' -delete
fi

echo "Build complete."
