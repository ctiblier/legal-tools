#!/bin/bash
# Build script for BatesStamp Legal Toolkit
# Copies shared files into the Cloudflare Pages deploy directory (batesstamp/)

set -e

echo "Building BatesStamp Legal Toolkit..."

# Copy shared CSS (existing pattern)
cp shared/brand.css batesstamp/

# Copy shared JS modules (only if they exist — allows incremental development)
mkdir -p batesstamp/shared
for f in file-handler.js nav.js tools.js session-files.js pdf-worker.js; do
  if [ -f "shared/$f" ]; then
    cp "shared/$f" "batesstamp/shared/"
  fi
done

echo "Build complete."
