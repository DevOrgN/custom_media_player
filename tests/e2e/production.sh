#!/usr/bin/env bash
# Run the browser journeys with isolated storage, a virtual screen and no sound.
# No packages or browser downloads. Optional args select individual .cjs suites.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
npm run build:web
command -v pactl >/dev/null || { echo 'production: pactl is required for silent audio' >&2; exit 127; }
command -v xvfb-run >/dev/null || { echo 'production: xvfb-run is required' >&2; exit 127; }
export MT_PRODUCTION_ELECTRON="${ELECTRON_BIN:-/usr/lib/electron41/electron}"
[ -x "$MT_PRODUCTION_ELECTRON" ] || { echo 'production: set ELECTRON_BIN to an installed Electron' >&2; exit 127; }
export MT_PROFILE_ROOT
MT_PROFILE_ROOT="$(mktemp -d /tmp/mt-production.XXXXXX)"
trap 'python3 -c '"'"'import shutil, sys; shutil.rmtree(sys.argv[1])'"'"' "$MT_PROFILE_ROOT"' EXIT
# quiet.sh is also sourced by run.sh. Verify the routing first and fail closed.
. "$ROOT/tests/e2e/quiet.sh"
pactl list short sinks | awk -v sink="$PULSE_SINK" '$2 == sink { found=1 } END { exit !found }' || {
  echo 'production: a null audio sink is required' >&2; exit 1;
}
cat > "$MT_PROFILE_ROOT/electron" <<'WRAPPER'
#!/usr/bin/env bash
exec "$MT_PRODUCTION_ELECTRON" --ozone-platform=x11 --user-data-dir="$MT_PROFILE_ROOT/profile" "$@"
WRAPPER
chmod +x "$MT_PROFILE_ROOT/electron"
env -u WAYLAND_DISPLAY -u XDG_SESSION_TYPE ELECTRON_BIN="$MT_PROFILE_ROOT/electron" \
  xvfb-run -a -s '-screen 0 1920x1080x24' "$ROOT/tests/e2e/run.sh" "$@"
