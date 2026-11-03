// Records the short demo of Siyaq for the website and README: the demo book (no AI key needed), driven by a
// pretend mouse, captured frame by frame from headless Chrome. Then scripts/frames-to-video.swift makes the files.
//   node scripts/record-demo.mjs   →   docs/demo.mp4 and docs/demo.gif
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launch, serve } from '../tests/browser.mjs';

const W = 1440, H = 860, frames = 'build/demo-frames';
rmSync(frames, { recursive: true, force: true });
mkdirSync(frames, { recursive: true });

const page = await launch();
await page.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
const server = await serve(fileURLToPath(new URL('../src/', import.meta.url)));
await page.open(server.url, { toured: true, setupSkipped: true, settings: { uiLang: 'en', lang: 'ar', theme: 'light' } });

// The pretend mouse: an arrow that glides to a point, and a ripple where it clicks.
await page.eval(`{
  const c = document.createElement('div'); c.id = 'rec-cursor';
  c.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M5 3l14 8-6 1.5L10 19z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  c.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;pointer-events:none;transition:transform .7s cubic-bezier(.4,0,.2,1);transform:translate(${W / 2}px,${H - 120}px)';
  document.body.append(c);
  const s = document.createElement('style');
  s.textContent = '.rec-ripple{position:fixed;z-index:99998;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;background:rgba(31,158,102,.35);pointer-events:none;animation:rec-r .5s ease-out forwards}@keyframes rec-r{from{transform:scale(.3);opacity:1}to{transform:scale(1.4);opacity:0}}';
  document.head.append(s);
  window.recMove = (x, y) => { c.style.transform = 'translate(' + x + 'px,' + y + 'px)'; };
  window.recClick = (x, y) => { const r = document.createElement('div'); r.className = 'rec-ripple'; r.style.left = x + 'px'; r.style.top = y + 'px'; document.body.append(r); setTimeout(() => r.remove(), 600);
    const el = document.elementFromPoint(x, y); el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: x, clientY: y })); el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x, clientY: y })); el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y })); };
  // Where something is on screen: the middle of an element, or of a word inside the book.
  window.recAt = sel => { const b = document.querySelector(sel).getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; };
  window.recWord = word => { const w = document.createTreeWalker(document.querySelector('.epub-chapter'), NodeFilter.SHOW_TEXT);
    while (w.nextNode()) { const i = w.currentNode.textContent.indexOf(word); if (i >= 0) { const r = document.createRange(); r.setStart(w.currentNode, i); r.setEnd(w.currentNode, i + word.length); const b = r.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2, r]; } } };
}`);

// Capture: Chrome sends a frame whenever the page changes; keep each with its time.
const sleep = ms => new Promise(r => setTimeout(r, ms));
const frameLog = [];
let recording = true;
page.onEvent = (method, params) => {
  if (method !== 'Page.screencastFrame') return;
  if (recording) frameLog.push({ t: params.metadata.timestamp, data: params.data });
  page.send('Page.screencastFrameAck', { sessionId: params.sessionId }).catch(() => {});
};
await page.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: W, maxHeight: H, everyNthFrame: 1 });

const move = async (expr, wait = 750) => { const [x, y] = await page.eval(expr); await page.eval(`recMove(${x}, ${y})`); await sleep(wait); return [x, y]; };
const click = async (expr, wait = 900) => { const [x, y] = await move(expr); await page.eval(`recClick(${x}, ${y})`); await sleep(wait); };

await sleep(900);
await click(`recAt('#empty [data-demo]')`, 1300);                       // open the demo book
await click(`recWord('bank').slice(0, 2)`, 2200);                        // a word: its meaning in this sentence
await click(`recWord('peeped').slice(0, 2)`, 1800);
await move(`recAt('#target')`, 600);                                     // translate into Turkish instead
await page.eval(`{ const s = document.querySelector('#target'); s.value = 'tr'; s.dispatchEvent(new Event('change')); }`);
await sleep(1600);
await page.eval(`{ const s = document.querySelector('#target'); s.value = 'ar'; s.dispatchEvent(new Event('change')); }`);
await sleep(400);
// Select a phrase, then highlight it from the bar that appears.
const [sx, sy] = await move(`(() => { const a = recWord('pleasure of making'); return [a[0] - 60, a[1]]; })()`, 500);
await page.eval(`{ const a = recWord('pleasure of making'); const s = getSelection(); s.removeAllRanges(); s.addRange(a[2]); recMove(a[0] + 70, a[1]); viewer.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); }`);
await sleep(900);
await click(`recAt('#selBar [data-color="yellow"]')`, 1200);
await click(`recAt('.seg [data-tab="vocab"]')`, 1600);                   // My words
await click(`recAt('#reviewBtn')`, 1000);                                // review: the card turns over
await click(`recAt('#revealBtn')`, 1800);
await sleep(600);
recording = false;
await page.send('Page.stopScreencast');

let n = 0;
const t0 = frameLog[0].t, list = [];
for (const f of frameLog) {
  const file = `${frames}/${String(n++).padStart(5, '0')}.jpg`;
  writeFileSync(file, Buffer.from(f.data, 'base64'));
  list.push(`${(f.t - t0).toFixed(3)} ${file}`);
}
writeFileSync(`${frames}/frames.txt`, list.join('\n') + '\n');
console.log(`${n} frames over ${(frameLog.at(-1).t - t0).toFixed(1)} s`);
page.close();
server.close();

execFileSync('swift', [fileURLToPath(new URL('./frames-to-video.swift', import.meta.url)), `${frames}/frames.txt`, 'docs/demo.mp4', 'docs/demo.gif'], { stdio: 'inherit' });
