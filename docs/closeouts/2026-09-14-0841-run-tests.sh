#!/usr/bin/env bash
# Headless runner for /email-to-pdf/tests.html.
#
# The plan tells implementers to open the test page in a browser. There is no
# installed system browser here, but Playwright's Chrome-for-Testing headless
# shell is cached and works. This script is the supported way to run the suite:
# it builds, serves, drives the page with virtual time, and prints the verdict.
#
# Usage: .superpowers/sdd/2026-09-11-email-to-pdf/run-tests
# Exit status: 0 = every test passed, 1 = failures or the page did not run.
set -uo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

SHELL_BIN="$HOME/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell"
PORT=${PORT:-8788}
URL="http://localhost:$PORT/email-to-pdf/tests.html"

if [ ! -x "$SHELL_BIN" ]; then
  echo "FAIL: headless chrome not found at $SHELL_BIN" >&2
  exit 1
fi

bash build.sh --dev >/dev/null || { echo "FAIL: build.sh --dev failed" >&2; exit 1; }

# Reuse an already-running server if one is up; otherwise start one and stop it
# again on exit, so repeated runs do not leak processes.
STARTED=""
if ! curl -sf -o /dev/null "http://localhost:$PORT/" 2>/dev/null; then
  (cd batesstamp && exec python3 -m http.server "$PORT" >/tmp/sdd-server-$PORT.log 2>&1) &
  STARTED=$!
  for _ in $(seq 1 40); do
    curl -sf -o /dev/null "http://localhost:$PORT/" 2>/dev/null && break
    sleep 0.25
  done
fi
cleanup() { [ -n "$STARTED" ] && kill "$STARTED" 2>/dev/null; }
trap cleanup EXIT

# Virtual time, not wall-clock: the budget is how far Chrome's clock may advance
# before it gives up, and it burns through it as fast as the CPU allows. The
# 8.6 MB PDF fixture alone costs ~266s of virtual clock in postal-mime's chunked
# base64 decoder, so a 60s budget silently cut the suite off mid-run and looked
# like a hang. Keep this generously above the worst observed cost.
# Raised twice during Task 14. Once assemble.test.js builds real PDFs (font
# embedding, subsetting, page copying for the 6 MB attachment fixture) the suite
# needs ~2,000,000 of virtual clock; adding pdf.js for text extraction pushes a
# cold-cache run higher still. Virtual time is not wall-clock — the
# browser burns it as fast as the CPU allows — so a generous ceiling costs
# nothing, while a short one truncates the run and looks exactly like a hang.
#
# This value is MEASURED, not guessed. It was raised three times chasing symptoms
# before the real cause was found: pdf.js (loaded by the test page to extract text
# from generated PDFs) spawns a real Worker thread, and Worker scheduling does not
# coordinate cleanly with Chromium's virtual-time mode. Vendoring pdf.js removed a
# network fetch but NOT the flakiness. Observed:
#     BUDGET=  4,000,000  -> FAIL, FAIL
#     BUDGET= 40,000,000  -> PASS, FAIL, FAIL
#     BUDGET=200,000,000  -> PASS x8, then a later FAIL under host load
#     BUDGET=1,000,000,000-> settled here: an order of magnitude above the highest
#                            value ever observed to be needed (500,000,000)
# The requirement drifts with host load, so the ceiling is set far above need
# rather than close to it. Virtual time is not wall-clock: a run still finishes in
# about four seconds, so an oversized ceiling costs nothing. TIMEOUT below is the
# real safety net — it bounds wall-clock, which is what a genuine hang consumes.
BUDGET=${BUDGET:-1000000000}
TIMEOUT=${TIMEOUT:-180}

DOM=$(timeout "$TIMEOUT" "$SHELL_BIN" --headless --no-sandbox --disable-gpu \
        --virtual-time-budget="$BUDGET" --dump-dom "$URL" 2>/dev/null)

TITLE=$(printf '%s' "$DOM" | grep -oP '(?<=<title>)[^<]*' | head -1)

if [ -z "$TITLE" ] || ! printf '%s' "$TITLE" | grep -qE '^(PASS|FAIL) '; then
  echo "FAIL: the test page did not finish running (title: '${TITLE:-none}')."
  echo "Usually a module 404 or a top-level import error; but if the console"
  echo "below is clean, the suite may simply have outrun BUDGET=${BUDGET} of"
  echo "virtual time — re-run with a larger BUDGET before hunting for a bug."
  "$SHELL_BIN" --headless --no-sandbox --disable-gpu --virtual-time-budget="$BUDGET" \
    --dump-dom "$URL" 2>&1 >/dev/null | grep -iE 'error|failed|404' | head -20
  exit 1
fi

printf '%s\n' "$TITLE"
printf '%s' "$DOM" | grep -oP '(?<=<div class="test-fail">)[^<]*' | sed 's/^/  /'

case "$TITLE" in
  PASS*) exit 0 ;;
  *)     exit 1 ;;
esac
