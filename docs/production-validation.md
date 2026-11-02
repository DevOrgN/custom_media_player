# Web and Linux Electron release validation

Scope: web app and Linux Electron. Testing uses generated local media and
throwaway storage; windows stay on Xvfb and audio goes to a null sink.

## Reproduce

```sh
npm test
npm run test:e2e
npm run test:playwright
```

Both end-to-end commands rebuild the frontend before launching. The Playwright
suite checks the served HTML and changed JavaScript against the freshly built
files byte for byte. `shells/electron/dist/` must not exist: it shadows the root
frontend with a potentially stale copy.

Playwright uses the installed Electron executable (`ELECTRON_BIN` overrides the
default). For web journeys it uses standalone Chromium when available; otherwise
it explicitly reports an isolated Electron Chromium renderer with no preload or
Node integration. `MT_PLAYWRIGHT_CHROMIUM` selects an existing standalone browser.
The runners never install or download a browser automatically.

## Defects corrected

- Playlist looping no longer enables native single-track repeat, which prevents
  the `ended` event needed for advancing to the next track.
- A chain of corrupt files stops after each candidate fails once. Native
  non-bubbling `<source>` errors now reach the application; stale sources cannot
  skip a newly selected track. Manual selection can retry a file.
- Modified custom shortcuts and Ctrl+Shift+O now dispatch their assigned actions.
  Unassigned browser shortcuts remain available; dialogs own playback keys.
- Shortcut overrides persist through Electron's changing loopback origin and an
  immediate web reload.
- Stale logo reads, image shrinking and colour sampling cannot undo newer edits.
- Autoplay avoids the library setter that leaves rejected play promises
  unhandled during rapid source changes. The native playback fallback also
  handles asynchronous rejection.

## Coverage

Latest validation: 235 unit tests, all seven browser suites, and 27 Playwright
checks passed.

- Unit tests cover application state, saved settings, language, file adapters,
  keyboard bindings, the password gate, media sequencing and resource cleanup.
- The seven Chromium suites cover media types, playlist operations, drag and
  drop, seek/volume/transport, menus, dialogs, settings, shortcuts and responsive
  layouts. The comprehensive journey has 230 checks; width coverage includes
  12 sizes.
- The 27-check Playwright journey drives actual pointer and keyboard input,
  browser file selection, desktop file-picker IPC, cancellation, playlist
  looping on real media endings, fullscreen state and glyphs, rebindings,
  clear/cancel/undo, desktop restart and web reload. It checks narrow controls
  at 520×420 and fails on unhandled page errors.
- The Linux Electron walkthrough exercises local-file playback and all 22
  shortcut entries. Its three native picker entries only confirm invocation;
  chosen and canceled results are exercised separately at the dialog boundary
  by Playwright, with the application IPC and file adapter left intact.

The legacy test setup checked the media library's native loop flag instead of
playlist progression and emitted fake `ended` events even with native looping
enabled. Those assumptions are corrected. The dialog scenario now closes the
active dialog before setting up its next case. Fullscreen measurements now fail
explicitly when the window, hook and control disagree.

## Performance probe

One local Chromium run measured 261 ms to boot, 47 ms to insert 100 image rows,
and 493 ms to finish their thumbnails. Keyboard interaction still worked with
100 rows. These small generated fixtures are a responsiveness check, not a
benchmark for large media libraries or long/high-resolution videos. Hidden-window
animation-frame timing was excluded because background scheduling distorts it.

## Release limits

- Standalone Chromium installation timed out. The completed web tests use
  Chromium inside Electron; standalone Chrome, Firefox and WebKit remain
  unverified.
- Native operating-system file-dialog visuals and manual navigation still need
  a human smoke check. Playwright supplies selected/canceled dialog results for
  Electron and drives the real browser file input for web.
- The password pop-up is a client-side convenience gate, not server-side access
  control. A public deployment that requires restricted access needs host-level
  authentication.
- Existing packaged artifacts were not rebuilt or certified. Build release
  artifacts from the validated source; the current local `dist/` is fresh.
- Generated `js/` runtime files are rebuilt locally. Source and tests are
  committed; generated output is excluded from commits. Rebuild before serving
  or packaging a fresh checkout.
