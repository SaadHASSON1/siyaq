// End-to-end tests: the real page in headless Chrome, with the AI and the desktop app replaced by stand-ins.
// Run with `npm test`. Needs Google Chrome (or set CHROME_PATH).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { launch, serve } from './browser.mjs';
import { englishHtml, arabicHtml, epub } from './fixtures.mjs';

let page, server, url;

// Stand-ins, installed before the app's scripts: a fake AI that answers instantly, and (for some tests) a fake
// desktop bridge that records what the app asks of the Rust side.
const FAKE_AI = `window.__fakeAI = true;`;
const FAKE_DESKTOP = `window.__calls = []; window.__saved = {};
window.__TAURI__ = { app: { getVersion: async () => '9.9.9' }, event: { listen: () => {} }, core: { invoke: async (cmd, args) => { __calls.push([cmd, args]);
  if (cmd === 'pick_file') return args.extensions.includes('json') ? '/backup.json' : '/books/english.pdf';
  if (cmd === 'read_book') { if (args.path === '/backup.json') return new TextEncoder().encode(__saved.backup).buffer; const r = await fetch(args.path); if (!r.ok) throw 'No such file'; return r.arrayBuffer(); }
  if (cmd === 'save_file') { __saved[args.name.endsWith('.json') ? 'backup' : 'csv'] = args.contents; return '/saved/' + args.name; }
  if (cmd === 'mcp_take_inbox') return [];
  return null; } } };`;

// Helpers inside the page: fake AI answers, clicking a word where it is drawn, selecting text.
const HELPERS = `
window.askModel = async prompt => /The reader asks/.test(prompt) ? { answer: 'An answer.\\n\\nSecond paragraph.' }
  : { translation: 'T-' + settings.lang, explanation: 'E', base_form: 'b', part_of_speech: 'noun', other_meanings: ['o1'], sentence_translation: 'ST' };
window.spanWith = text => [...document.querySelectorAll('.textLayer > span')].find(s => s.textContent.includes(text));
window.clickAt = (el, frac = 0.5) => { const r = el.getBoundingClientRect(), x = r.left + r.width * frac, y = r.top + r.height / 2;
  document.elementFromPoint(x, y).dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y })); };
window.clickWord = (text, word = text) => { const sp = spanWith(text), node = [...sp.childNodes].find(n => n.textContent.includes(word)) || sp.firstChild;
  const r = document.createRange(), i = node.textContent.indexOf(word); r.setStart(node, i + 1); r.setEnd(node, i + 2);
  const b = r.getBoundingClientRect(), x = b.left + 1, y = b.top + b.height / 2;
  document.elementFromPoint(x, y).dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y })); };
// The text node holding the text (saved words are wrapped in marks, which splits a piece's text).
window.textNode = (root, text) => { const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); while (w.nextNode()) if (w.currentNode.textContent.includes(text)) return w.currentNode; };
window.selectText = text => { const node = textNode(spanWith(text), text), r = document.createRange(), i = node.textContent.indexOf(text);
  r.setStart(node, i); r.setEnd(node, i + text.length); getSelection().removeAllRanges(); getSelection().addRange(r);
  viewer.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); };
window.openTestBook = async (path, name = path.split('/').pop()) => { await openBook(new Uint8Array(await (await fetch(path)).arrayBuffer()), name); };
1`;

async function fresh(storage = { toured: true, settings: { uiLang: 'en', lang: 'ar', apiKey: 'x' } }, before = FAKE_AI) {
  await page.open(url, storage, before);
  await page.eval(HELPERS);
}
const openPdf = async (path = '/books/english.pdf') => {
  await page.eval(`openTestBook(${JSON.stringify(path)})`);
  await page.waitFor(`document.querySelector('.page[data-page="1"] .textLayer span')`);
};

before(async () => {
  page = await launch();
  await page.size(1400, 900);
  const books = {
    '/books/english.pdf': await page.pdf(englishHtml),
    '/books/arabic.pdf': await page.pdf(arabicHtml),
    '/books/test.epub': epub(),
  };
  server = await serve(fileURLToPath(new URL('../src/', import.meta.url)), books);
  url = server.url;
});
after(() => { page?.close(); server?.close(); });

test('first run: the welcome tour, its language switch, and Later', async () => {
  await fresh({}, FAKE_AI);
  assert.equal(await page.eval(`document.querySelector('#setup').open && SLIDES[slide]`), 'hello');
  await page.eval(`{ for (let i = 0; i < 4; i++) document.querySelector('#tourNext').click() }`);
  assert.equal(await page.eval('SLIDES[slide]'), 'key');
  await page.eval(`document.querySelector('#setup [data-l="tr"]').click()`);
  assert.equal(await page.eval('document.documentElement.lang'), 'tr');
  await page.eval(`document.querySelector('#setupLater').click()`);
  assert.equal(await page.eval(`document.querySelector('#setup').open`), false);
});

test('PDF: clicking a word shows its meaning in its sentence and saves it', async () => {
  await fresh();
  await openPdf();
  await page.eval(`clickWord('bank of the river', 'bank')`);
  await page.waitFor(`document.querySelector('#lookup .tr')`);
  assert.equal(await page.eval(`document.querySelector('#lookup .tr').textContent`), 'T-ar');
  assert.equal(await page.eval(`document.querySelector('#lookup .sentence').textContent`), 'She sat on the bank of the river, watching the water.');
  assert.deepEqual(await page.eval(`[vocab[0].word, vocab[0].page, vocab[0].lang]`), ['bank', 1, 'ar']);
  assert.ok(await page.eval(`!!document.querySelector('mark.known')`), 'the saved word is underlined');
});

test('changing the translation language translates the open word again', async () => {
  await page.eval(`{ const s = document.querySelector('#target'); s.value = 'tr'; s.dispatchEvent(new Event('change')) }`);
  await page.waitFor(`document.querySelector('#lookup .tr')?.textContent === 'T-tr'`);
});

test('My words: a tab per language pair, and the arrow back to the page', async () => {
  await page.eval(`showTab('vocab')`);
  const tabs = await page.eval(`[...document.querySelectorAll('#vocab .v-pairs button')].map(b => b.dataset.pair)`);
  assert.deepEqual(tabs, ['all', 'en>tr', 'en>ar']);
  await page.eval(`document.querySelector('#vocab [data-go]').click()`);
  assert.equal(await page.eval(`$('#backBtn').hidden`), false);
});

test('review cards turn over to show the answer', async () => {
  await page.eval(`vocab.forEach(v => v.due = 0); showTab('vocab'); document.querySelector('#reviewBtn').click(); document.querySelector('#revealBtn').click()`);
  assert.ok(await page.eval(`document.querySelector('#rcard').classList.contains('on') && !!document.querySelector('#goodBtn')`));
  await page.eval(`document.querySelector('#listBtn').click()`);
});

test('Ask: the button, a click on a sentence, and an answer', async () => {
  await page.eval(`document.querySelector('#askBtn').click()`);
  assert.ok(await page.eval('askMode'));
  await page.eval(`clickAt(spanWith('considering'))`);
  await page.waitFor(`document.querySelector('#lookup .ask')`);
  assert.match(await page.eval(`document.querySelector('.passage').textContent`), /^So she was considering/);
  await page.eval(`document.querySelector('.ask-quick [data-q]').click()`);
  await page.waitFor(`document.querySelectorAll('.ask-turn .explain').length === 2`);
});

test('highlights: colour, note, survives zoom, listed in Notes', async () => {
  await page.eval(`selectText('watching the water')`);
  assert.equal(await page.eval(`document.querySelector('#selBar').hidden`), false);
  await page.eval(`document.querySelector('#selBar [data-color="green"]').click()`);
  assert.ok(await page.eval(`document.querySelectorAll('.hl-box.hl-green').length > 0`));
  await page.eval(`document.querySelector('.hl-pin').click(); document.querySelector('#hlNote').value = 'my note'; document.querySelector('#hlDone').click()`);
  assert.equal(await page.eval(`bookHighlights()[0].note`), 'my note');
  await page.eval('zoomStep(1)');
  await page.waitFor(`document.querySelector('.page[data-page="1"] .hl-box')`);
  await page.eval(`zoomStep(-1); showTab('notes')`);
  assert.equal(await page.eval(`document.querySelectorAll('#notes .note-item').length`), 1);
});

test('contents: levels, page numbers, the section you are in, jumping', async () => {
  await page.eval(`showTab('toc')`);
  await page.waitFor(`document.querySelector('#toc .toc-go .p')`);
  assert.ok(await page.eval(`document.querySelectorAll('#toc .toc ul li').length >= 1`), 'sections sit under chapters');
  await page.eval(`[...document.querySelectorAll('#toc .toc-go')].find(b => b.textContent.includes('Chapter Two')).click()`);
  await page.waitFor('currentPage() >= 2');
  assert.ok(await page.eval(`!!document.querySelector('#toc li.current')`));
});

test('search finds words in the book', async () => {
  await page.eval(`{ openSearch(); const i = document.querySelector('#searchInput'); i.value = 'cheshire'; i.dispatchEvent(new Event('input')) }`);
  await page.waitFor(`/\\d/.test(document.querySelector('#searchCount').textContent)`);
  await page.eval('closeSearch()');
});

test('the logo goes back to the start screen', async () => {
  await page.eval(`document.querySelector('#homeBtn').click()`);
  assert.ok(await page.eval(`!pdfDoc && !!document.querySelector('#viewer #empty') && document.querySelector('#tools').hidden`));
});

test('EPUB: contents, a word, and a highlight across formatting', async () => {
  await page.eval(`openTestBook('/books/test.epub')`);
  await page.waitFor(`bookType === 'epub' && document.querySelector('.epub-chapter p')`);
  await page.eval(`showTab('toc')`);
  assert.equal(await page.eval(`document.querySelectorAll('#toc .toc-go').length`), 2);
  await page.eval(`{ const p = document.querySelector('.epub-chapter p'), r = document.createRange(), t = textNode(p, 'She sat');
    r.setStart(t, t.textContent.indexOf('sat')); r.setEnd(p.querySelector('em').firstChild, 5);
    getSelection().removeAllRanges(); getSelection().addRange(r); viewer.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })) }`);
  await page.eval(`document.querySelector('#selBar [data-color="yellow"]').click()`);
  assert.ok(await page.eval(`document.querySelectorAll('.epub-chapter mark.hl').length >= 2 && bookHighlights()[0].text.includes('river')`));
});

test('Arabic PDF: a click picks the whole word, and the sentence reads right to left', async () => {
  await fresh();
  await openPdf('/books/arabic.pdf');
  // Found through its line, so it works whether the PDF gives a piece per word or per letter (Chrome on Linux).
  const [word, sentence] = await page.eval(`(() => { for (const layer of document.querySelectorAll('.textLayer')) for (const line of textLines(layer)) {
    const i = line.text.indexOf('بيطبع'); if (i < 0) continue;
    const span = line.spans.find(sp => line.starts.get(sp) <= i + 2 && i + 2 < line.starts.get(sp) + sp.textContent.length);
    const at = i + 2 - line.starts.get(span); return [wordAt(span, at), sentenceAround(span, at)]; } return ['(not found)', textLines(document.querySelector('.textLayer')).map(l => l.text).join(' | ')]; })()`);
  assert.equal(word, 'بيطبع', `lines: ${JSON.stringify(sentence)} codes: ${[...String(sentence).slice(0, 40)].map(c => c.codePointAt(0).toString(16)).join(' ')}`);
  assert.match(sentence, /^الأمر اللي بيطبع على الشاشة/);
});

test('settings: four tabs, each with its own part', async () => {
  await page.eval(`document.querySelector('#settingsBtn').click()`);
  for (const pane of ['general', 'ai', 'connect', 'about']) {
    await page.eval(`document.querySelector('#settings .set-tabs [data-pane="${pane}"]').click()`);
    assert.equal(await page.eval(`[...document.querySelectorAll('#settings .set-pane')].filter(p => !p.hidden).map(p => p.dataset.pane).join()`), pane);
  }
  await page.eval(`document.querySelector('#settings').close('cancel')`);
});

test('quota messages name the reader’s own provider', async () => {
  const daily = `{ error: { message: 'You exceeded your current quota', status: 'RESOURCE_EXHAUSTED', details: [{ violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] } }`;
  assert.match(await page.eval(`settings.provider = 'gemini'; quotaMessage(429, ${daily})`), /Gemini/);
  assert.match(await page.eval(`settings.provider = 'anthropic'; quotaMessage(429, ${daily})`), /Claude/);
  assert.equal(await page.eval(`quotaMessage(503, { error: { message: 'overloaded' } })`), null);
  await page.eval(`settings.provider = 'gemini'`);
});

test('desktop app: recent books, backup and restore, sharing with AI apps', async () => {
  await fresh(undefined, FAKE_AI + FAKE_DESKTOP);
  await page.eval(`document.querySelector('#empty label.btn').click()`);
  await page.waitFor(`pdfDoc && library()[0]?.path === '/books/english.pdf'`);
  await page.eval(`vocab = [{ word: 'bank', translation: 'T', explanation: '', sentence: 'S', book: 'english.pdf', date: new Date().toISOString(), box: 1 }]; store.set('vocab', vocab); openSettings(); document.querySelector('#backupSave').click()`);
  await page.waitFor('__saved.backup');
  assert.equal(await page.eval(`'apiKey' in JSON.parse(__saved.backup).settings`), false, 'the key stays out of backups');
  await page.eval(`{ const b = JSON.parse(__saved.backup); b.vocab.push({ word: 'river', translation: 'R', explanation: '', sentence: 'S2', book: 'english.pdf', date: new Date().toISOString() }); __saved.backup = JSON.stringify(b); document.querySelector('#backupLoad').click() }`);
  await page.waitFor('vocab.length === 2');
  await page.eval('setSharing(true)');
  await page.waitFor(`__calls.some(c => c[0] === 'mcp_share_book')`);
});

test('no JavaScript errors anywhere above', () => {
  assert.deepEqual(page.errors, []);
});
