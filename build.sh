#!/bin/bash
# Build script for BatesStamp Legal Toolkit
# Copies shared files into the Cloudflare Pages deploy directory (batesstamp/)

set -e

echo "Building BatesStamp Legal Toolkit..."

# Shared CSS lands at the site root (referenced as /brand.css)
cp shared/brand.css batesstamp/

# Shared JS — copied wholesale, including nested directories (eml/, pdf/, testing/).
# batesstamp/shared/ is gitignored build output; it is rebuilt from scratch each time
# so a deleted source file cannot survive as a stale copy.
rm -rf batesstamp/shared
mkdir -p batesstamp/shared
cp -R shared/. batesstamp/shared/
rm -f batesstamp/shared/brand.css

# Development only: stage the .eml test fixtures inside the served root so the
# test page can fetch them at the same absolute paths it will use in production.
# Never run with --dev for a deployed build; Cloudflare Pages runs `bash build.sh`
# with no arguments, so evidence fixtures cannot reach the live site.
if [ "$1" = "--dev" ]; then
  rm -rf batesstamp/fixtures
  if [ -d docs/fixtures/eml ]; then
    mkdir -p batesstamp/fixtures
    cp -R docs/fixtures/eml batesstamp/fixtures/
    echo "Dev fixtures staged at batesstamp/fixtures/eml/"
  else
    echo "No fixtures at docs/fixtures/eml/ — skipping dev staging."
    echo "Run: python3 docs/fixtures/eml/generate.py"
  fi
fi

echo "Build complete."
