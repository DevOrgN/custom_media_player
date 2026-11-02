import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const __dirname = fileURLToPath(new URL('.', import.meta.url));
/* Real pointer/keyboard journeys through the built Electron app and web page.
   No browser download: Playwright drives the installed Electron runtime. */
const { _electron, chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const ROOT = path.resolve(__dirname, '../..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-playwright-'));
const shots = path.join(os.tmpdir(), 'mt-e2e');
fs.mkdirSync(shots, { recursive: true });
const fixture = (name) => path.join(__dirname, 'media', name);
const hash = (value) => createHash('sha256').update(value).digest('hex');
let application, browser, server;
let checks = 0;
const errors = [];
const ok = (name, yes) => { assert.ok(yes, name); checks++; console.log('ok ' + name); };
const waitFor = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 10000 });
async function boot(page) {
  page.on('pageerror', (error) => errors.push(error.message));
  await page.locator('#gate-input').fill('4254251');
  await page.locator('#gate-input').press('Enter');
  await page.locator('#gate').waitFor({ state: 'detached' });
  await waitFor(page, () => !!window.MediaMenu && !!window.MediaBridge);
}
async function latest(page, directory) {
  for (const file of ['index.html', 'js/app.js', 'js/media.js', 'js/settings.js']) {
    const response = await page.request.get(new URL(file, page.url()).href);
    assert.equal(response.status(), 200);
    assert.equal(hash(await response.body()), hash(fs.readFileSync(path.join(ROOT, directory, file))));
    if (file.startsWith('js/')) {
      assert.equal(hash(fs.readFileSync(path.join(ROOT, directory, file))), hash(fs.readFileSync(path.join(ROOT, file))));
    }
  }
  ok(directory + ' served files match the latest build byte for byte', true);
}
async function launch() {
  const env = { ...process.env, MT_STATE_DIR: path.join(scratch, 'state'), XDG_CONFIG_HOME: path.join(scratch, 'config'), ELECTRON_DISABLE_SANDBOX: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.WAYLAND_DISPLAY;
  delete env.XDG_SESSION_TYPE;
  application = await _electron.launch({
    executablePath: process.env.ELECTRON_BIN || '/usr/lib/electron41/electron',
    args: ['--ozone-platform=x11', '--mute-audio', '--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--user-data-dir=' + path.join(scratch, 'profile'), path.join(ROOT, 'shells/electron')],
    env, timeout: 20000,
  });
  const page = await application.firstWindow();
  page.setDefaultTimeout(10000);
  await boot(page);
  return page;
}
async function chooseDesktop(page, key, files, canceled = false) {
  await application.evaluate(({ dialog }, selection) => {
    dialog.showOpenDialog = async () => selection;
  }, { canceled, filePaths: files });
  await page.keyboard.press(key);
}
async function exercise(page, label) {
  await waitFor(page, () => MediaBridge.duration > 1 && MediaBridge.playing);
  await page.locator('#play').click();
  await waitFor(page, () => !MediaBridge.playing);
  ok(label + ' pointer Play pauses actual media', true);
  await page.keyboard.press('Space');
  await waitFor(page, () => MediaBridge.playing);
  ok(label + ' Space resumes after a pointer click', true);
  await page.locator('#loop').click();
  await waitFor(page, () => document.getElementById('loop').getAttribute('aria-pressed') === 'true');
  await page.evaluate(() => MediaBridge.seekBy(MediaBridge.duration - 0.4 - MediaBridge.currentTime));
  await waitFor(page, () => document.getElementById('title').textContent === 'tone.mp3');
  ok(label + ' playlist loop advances on a real ended event', true);
  await waitFor(page, () => MediaBridge.duration > 1 && MediaBridge.duration < 7 && MediaBridge.playing);
  await page.evaluate(() => MediaBridge.seekBy(MediaBridge.duration - 0.4 - MediaBridge.currentTime));
  await waitFor(page, () => document.getElementById('title').textContent === 'clip.mp4');
  ok(label + ' playlist loop wraps after the last real track', true);
  await page.locator('#fs').click();
  await waitFor(page, () => MediaBridge.fullscreen && document.getElementById('fs').classList.contains('on'));
  await page.keyboard.press('f');
  await waitFor(page, () => !MediaBridge.fullscreen && !document.getElementById('fs').classList.contains('on'));
  ok(label + ' fullscreen button, key, and glyph agree', true);
  await page.evaluate(() => { MediaBridge.pause(); MediaMenu.send('info'); });
  const muted = await page.evaluate(() => MediaBridge.muted);
  await page.keyboard.press('m');
  ok(label + ' help owns playback shortcuts', await page.evaluate(() => MediaBridge.muted) === muted);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+,');
  await page.locator('[data-shortcut-cell="mute"]').click();
  await page.keyboard.press('Control+b');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+b');
  ok(label + ' modified shortcut works after editing', await page.evaluate(() => MediaBridge.muted) !== muted);
  await page.keyboard.press('Shift+x');
  await page.locator('#clear-cancel').click();
  ok(label + ' cancel preserves both rows', await page.locator('#list li').count() === 2);
  await page.keyboard.press('Shift+x');
  await page.locator('#clear-ok').click();
  await waitFor(page, () => !document.querySelector('#list li'));
  await page.keyboard.press('Shift+z');
  await waitFor(page, () => document.querySelectorAll('#list li').length === 2);
  ok(label + ' clear and undo restore the playlist', true);
  await page.screenshot({ path: path.join(shots, 'playwright-' + label + '.png') });
}
async function webOrigin() {
  server = spawn(process.execPath, [path.join(ROOT, 'serve.js')], { cwd: ROOT, env: { ...process.env, PORT: '8765' }, stdio: ['ignore', 'pipe', 'ignore'] });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('web server did not start')), 5000);
    server.stdout.on('data', (data) => {
      const match = String(data).match(/http:\/\/localhost:(\d+)/);
      if (match) { clearTimeout(timeout); resolve('http://127.0.0.1:' + match[1] + '/'); }
    });
  });
}
(async () => {
  let page = await launch();
  await latest(page, 'dist');
  await chooseDesktop(page, 'o', [fixture('clip.mp4')]);
  await waitFor(page, () => document.querySelectorAll('#list li').length === 1 && MediaBridge.playing);
  const before = await page.evaluate(() => document.getElementById('title').textContent);
  await chooseDesktop(page, 'Control+Shift+o', [fixture('tone.mp3')]);
  await waitFor(page, () => document.querySelectorAll('#list li').length === 2);
  ok('desktop Add Files appends without changing the current track', await page.evaluate(() => document.getElementById('title').textContent) === before);
  await chooseDesktop(page, 'o', [], true);
  ok('desktop canceled picker leaves the playlist intact', await page.locator('#list li').count() === 2);
  await exercise(page, 'desktop');
  // Wait for the real debounced write, then restart against the same isolated state.
  await page.waitForTimeout(600);
  await application.close();
  application = null;
  page = await launch();
  await waitFor(page, () => document.querySelectorAll('#list li').length === 2);
  ok('desktop restart restores real file paths and custom bindings', await page.evaluate(() => MediaMenu.bindings.mute[0] === 'Control+B'));
  const origin = await webOrigin();
  let web;
  const chromiumExecutable = process.env.MT_PLAYWRIGHT_CHROMIUM;
  if (chromiumExecutable || fs.existsSync(chromium.executablePath())) {
    browser = await chromium.launch({ headless: true,
      ...(chromiumExecutable ? { executablePath: chromiumExecutable } : {}),
      args: ['--ozone-platform=x11', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
    });
    web = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await web.goto(origin);
    console.log('WEB ENGINE standalone Chromium');
  } else {
    // A web-only renderer: no preload, Node access, or desktop file adapter.
    // Explicitly reported so this is never confused with another browser build.
    await application.evaluate(async ({ BrowserWindow }, url) => {
      const win = new BrowserWindow({ width: 1280, height: 800, show: true,
        webPreferences: { contextIsolation: true, nodeIntegration: false } });
      await win.loadURL(url);
    }, origin);
    web = application.windows().at(-1);
    console.log('WEB ENGINE installed Electron Chromium, no preload or Node integration');
  }
  await boot(web);
  await latest(web, '.');
  const chooser = web.waitForEvent('filechooser');
  await web.keyboard.press('o');
  await (await chooser).setFiles([fixture('clip.mp4'), fixture('tone.mp3')]);
  await waitFor(web, () => document.querySelectorAll('#list li').length === 2);
  ok('web real file input loads selected local files', true);
  await exercise(web, 'web');
  await web.setViewportSize({ width: 520, height: 420 });
  for (const id of ['play', 'prev', 'next', 'loop', 'autoplay', 'fs', 'volume']) {
    const box = await web.locator('#' + id).boundingBox();
    assert.ok(box && box.width > 0 && box.height > 0 && box.x >= -1 && box.y >= -1
      && box.x + box.width <= 521 && box.y + box.height <= 421, 'narrow control ' + id);
  }
  ok('web controls remain reachable at 520 by 420', true);
  await web.reload();
  await boot(web);
  ok('web reload keeps custom bindings and releases local files', await web.evaluate(() =>
    MediaMenu.bindings.mute[0] === 'Control+B' && document.querySelectorAll('#list li').length === 0));
  assert.deepEqual(errors, [], 'unhandled page errors');
  ok('no unhandled page errors', true);
  console.log(`PASSED all ${checks} Playwright checks against the latest build`);
})().catch((error) => { console.error('FAIL Playwright:', error.message);
  if (errors.length) console.error(JSON.stringify(errors)); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close().catch(() => {});
  if (application) await application.close().catch(() => {});
  if (server) server.kill();
  fs.rmSync(scratch, { recursive: true, force: true });
});
