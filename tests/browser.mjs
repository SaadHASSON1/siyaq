// A small headless-Chrome driver for the tests (Chrome DevTools Protocol, no extra packages), and a static
// server for the app's page plus the test books.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';

const CHROMES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.pdf': 'application/pdf', '.epub': 'application/epub+zip', '.wasm': 'application/wasm',
  '.gz': 'application/gzip', '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream', '.ttf': 'font/ttf' };

// Serves `root` at /, and extra in-memory files (test books) at their own paths.
export function serve(root, extra = {}) {
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (extra[path]) { res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }); res.end(extra[path]); return; }
    const file = normalize(join(root, path === '/' ? 'index.html' : path));
    if (!file.startsWith(normalize(root)) || !existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() })));
}

export async function launch() {
  const exe = CHROMES.find(p => existsSync(p));
  if (!exe) throw new Error('Chrome not found; set CHROME_PATH');
  const profile = mkdtempSync(join(tmpdir(), 'siyaq-test-'));
  const chrome = spawn(exe, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((resolve, reject) => {
    let log = '';
    chrome.stderr.on('data', d => { log += d; const m = log.match(/DevTools listening on (ws:\/\/\S+)/); if (m) resolve(m[1]); });
    chrome.on('exit', code => reject(new Error(`Chrome exited (${code})`)));
  });
  const port = new URL(wsUrl).port;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let targets;
  for (let i = 0; i < 50 && !targets?.some(t => t.type === 'page'); i++) { await sleep(100); targets = await fetch(`http://127.0.0.1:${port}/json`).then(r => r.json()).catch(() => null); }
  const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0;
  const pending = {}, errors = [], events = { listener: null };
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description?.split('\n')[0] || m.params.exceptionDetails.text);
    if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id]; }
    if (m.method) events.listener?.(m.method, m.params);
  });
  const send = (method, params = {}) => new Promise(r => { pending[++id] = r; ws.send(JSON.stringify({ id, method, params })); }).then(m => {
    if (m.error) throw new Error(`${method}: ${m.error.message}`);
    return m.result;
  });
  await send('Runtime.enable');
  await send('Page.enable');

  const page = {
    errors,
    // Receives every DevTools event (method, params), e.g. screencast frames.
    set onEvent(fn) { events.listener = fn; },
    send,
    sleep,
    // Runs an expression (awaited) in the page and returns its value; a thrown error fails the call.
    // Runs like the DevTools console: top-level await works, and the last expression's value comes back.
    // Tests put statements in { } so their consts stay out of the app's global scope.
    async eval(expression) {
      let r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, replMode: true });
      // In REPL mode a promise the expression returns isn't awaited: wait for it here.
      if (!r.exceptionDetails && r.result?.subtype === 'promise' && r.result.objectId) {
        r = await send('Runtime.awaitPromise', { promiseObjectId: r.result.objectId, returnByValue: true });
      }
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result?.value;
    },
    async size(width, height = 900, scheme = 'light') {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
    },
    // Opens the app with fresh storage: `storage` is written before the page's own scripts run.
    async open(url, storage = {}, before = '') {
      const seed = Object.entries(storage).map(([k, v]) => `localStorage.setItem(${JSON.stringify('siyaq:' + k)}, ${JSON.stringify(JSON.stringify(v))});`).join('');
      const script = await send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.clear(); ${seed} ${before}` });
      await send('Page.navigate', { url });
      await page.waitFor('document.readyState === "complete" && typeof openBook === "function"');
      await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: script.identifier });
    },
    async waitFor(expression, timeout = 15000) {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        try { if (await page.eval(`!!(${expression})`)) return; } catch {}
        await sleep(100);
      }
      throw new Error(`timed out waiting for: ${expression}`);
    },
    async pdf(html) {
      await send('Page.navigate', { url: 'data:text/html;charset=utf-8,' + encodeURIComponent(html) });
      await sleep(500);
      return Buffer.from((await send('Page.printToPDF', { generateDocumentOutline: true })).data, 'base64');
    },
    async screenshot() { return Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'); },
    close() { ws.close(); chrome.kill(); setTimeout(() => rmSync(profile, { recursive: true, force: true }), 500); },
  };
  return page;
}
