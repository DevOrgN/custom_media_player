/* Production regressions driven by Chromium input, not dispatched key/click
   events. Run through run.sh for an isolated display and silent audio. */
const H = require('./lib/harness.cjs');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const metrics = {};
const { performance } = require('node:perf_hooks');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let failures = 0;
const check = (name, yes) => {
  console.log(`${yes ? 'ok' : 'FAIL'} ${name}`);
  if (!yes) failures++;
};
async function until(win, expression, limit = 5000) {
  const end = Date.now() + limit;
  do {
    if (await H.run(win, expression)) return true;
    await wait(50);
  } while (Date.now() < end);
  return false;
}
async function press(win, keyCode, modifiers = []) {
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  await wait(100);
}
async function click(win, selector) {
  const point = await H.run(win, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  })()`);
  win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
  win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
  await wait(100);
}
async function main() {
  const start = performance.now();
  const win = await H.open({ width: 1280, height: 800 });
  win.webContents.setBackgroundThrottling(false);
  metrics.coldBootMs = Math.round(performance.now() - start);
  await H.fresh(win);
  await H.run(win, `(async () => {
    const dt = new DataTransfer();
    for (const [src, name] of [['clip.mp4', 'first.mp4'], ['long.mp4', 'second.mp4']]) {
      const blob = await (await fetch('http://127.0.0.1:8123/' + src)).blob();
      dt.items.add(new File([blob], name, { type: 'video/mp4' }));
    }
    document.getElementById('stage').dispatchEvent(new DragEvent('drop', {
      dataTransfer: dt, bubbles: true, cancelable: true,
    }));
  })()`);
  check('real media becomes playable', await until(win, 'MediaBridge.duration > 1 && MediaBridge.playing'));
  await click(win, '#loop');
  check('pointer click enables playlist loop', await H.run(win, 'document.getElementById("loop").getAttribute("aria-pressed") === "true"'));
  await H.run(win, 'MediaBridge.seekBy(MediaBridge.duration - 0.4 - MediaBridge.currentTime); MediaBridge.play();');
  check('loop advances to the next actual media file', await until(win, 'document.getElementById("title").textContent === "second.mp4"', 5000));
  // Independently select the last row so a failure above cannot skip wrap testing.
  await H.run(win, 'document.querySelectorAll("#list li")[1].click()');
  await until(win, 'MediaBridge.duration > 20 && MediaBridge.playing');
  await H.run(win, 'MediaBridge.seekBy(MediaBridge.duration - 0.4 - MediaBridge.currentTime); MediaBridge.play();');
  check('loop wraps after the last actual media file', await until(win, 'document.getElementById("title").textContent === "first.mp4"', 5000));
  await H.run(win, 'MediaBridge.pause(); MediaMenu.send("info");');
  const muted = await H.run(win, 'MediaBridge.muted');
  await press(win, 'M');
  check('instructions own letter shortcuts', await H.run(win, 'MediaBridge.muted') === muted);
  await press(win, 'Escape');
  await press(win, ',', ['control']);
  await click(win, '[data-shortcut-cell="mute"]');
  await press(win, 'B', ['control']);
  check('modified binding is saved', await H.run(win, 'MediaMenu.bindings.mute[0] === "Control+B"'));
  await press(win, 'Escape');
  const before = await H.run(win, 'MediaBridge.muted');
  await press(win, 'B', ['control']);
  check('modified custom shortcut runs', await H.run(win, 'MediaBridge.muted') !== before);
  await H.run(win, 'MediaBridge.pause(); MediaMenu.send("clear-playlist");');
  await click(win, '#clear-ok');
  const added = performance.now();
  await H.run(win, `(async () => {
    const blob = await (await fetch('http://127.0.0.1:8123/still.png')).blob();
    const dt = new DataTransfer();
    for (let i = 0; i < 100; i++) dt.items.add(new File([blob], 'image-' + i + '.png', { type: 'image/png' }));
    document.getElementById('stage').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  })()`);
  check('100-file drop completes', await until(win, 'document.querySelectorAll("#list li").length === 100'));
  metrics.drop100ImagesMs = Math.round(performance.now() - added);
  check('100 thumbnails complete', await until(win, 'document.querySelectorAll("#list .thumb img").length === 100', 10000));
  metrics.thumbnails100ImagesMs = Math.round(performance.now() - added);
  const panelBefore = await H.run(win, 'document.getElementById("stage").classList.contains("list")');
  await press(win, 'P');
  check('keyboard remains responsive with 100 rows', await H.run(win, 'document.getElementById("stage").classList.contains("list")') !== panelBefore);
  await H.run(win, 'MediaMenu.send("clear-playlist");');
  await click(win, '#clear-ok');
  await H.run(win, `(() => {
    window.__corruptErrors = 0;
    MediaBridge.on('error', () => window.__corruptErrors++);
    const dt = new DataTransfer();
    for (let i = 0; i < 2; i++) dt.items.add(new File(['broken'], 'corrupt-' + i + '.mp4', { type: 'video/mp4' }));
    document.getElementById('stage').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  })()`);
  check('corrupt files are attempted', await until(win, 'window.__corruptErrors >= 2'));
  const errorCount = await H.run(win, 'window.__corruptErrors');
  metrics.corruptState = await H.run(win, `({ errors: window.__corruptErrors,
    rows: document.querySelectorAll('#list li').length,
    title: document.getElementById('title').textContent,
    kind: document.getElementById('stage').dataset.kind,
    nativeError: document.querySelector('video, audio')?.error?.code || 0 })`);
  await wait(300);
  check('loop stops after every corrupt file fails', errorCount === 2
    && await H.run(win, 'window.__corruptErrors === 2 && !MediaBridge.playing && !document.getElementById("notice").hidden'));
  const reportDir = path.join(os.tmpdir(), 'mt-e2e');
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(path.join(reportDir, 'production.json'), JSON.stringify({ failures, metrics }, null, 2));
  win.destroy();
  console.log(failures ? `FAILED ${failures} production checks` : 'PASSED all production checks');
  H.app.exit(failures ? 1 : 0);
}
main().catch((err) => { console.error('FAIL production suite:', err.message); H.app.exit(1); });
