#!/usr/bin/env bash
# Playwright uses the installed Electron runtime; never downloads a browser.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
command -v xvfb-run >/dev/null
command -v pactl >/dev/null
npm run build:web
. tests/e2e/quiet.sh
pactl list short sinks | awk -v sink="$PULSE_SINK" '$2 == sink { found=1 } END { exit !found }' || {
  echo 'playwright: a null audio sink is required' >&2; exit 1;
}
env -u WAYLAND_DISPLAY -u XDG_SESSION_TYPE -u ELECTRON_RUN_AS_NODE \
  xvfb-run -a -s '-screen 0 1920x1080x24' node tests/e2e/playwright.mjs
