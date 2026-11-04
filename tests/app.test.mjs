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
window.__realAskModel = window.__realAskModel || askModel;
window.askModel = async prompt => /The reader asks/.test(prompt) ? { answer: 'An answer.\\n\\nSecond paragraph.' }
  : { translation: 'T-' + settings.lang, explanation: 'E', base_form: 'b', part_of_speech: 'noun', other_meanings: ['o1'], sentence_translation: 'ST' };
window.spanWith = text => [...document.querySelectorAll('.textLayer span:not(.markedContent)')].find(s => s.textContent.includes(text));
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
  await page.sleep(700); // the turn takes .6 s
  // The back must sit exactly where the front does (it once took the Back button's styles from a shared class name).
  const [front, back] = await page.eval(`['#rcard', '#rcard .rcard-back'].map(s => { const b = document.querySelector(s).getBoundingClientRect(); return [b.left, b.top, b.width, b.height].map(Math.round); })`);
  assert.deepEqual(back, front);
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

test('motion: the tab pill follows the chosen tab, page jumps glide, dark mode crossfades', async () => {
  const pillUnder = bar => page.eval(`(() => { const p = document.querySelector('${bar} .pill').getBoundingClientRect(), b = document.querySelector('${bar} button.on').getBoundingClientRect();
    return Math.abs(p.left - b.left) < 1.5 && Math.abs(p.width - b.width) < 1.5; })()`);
  await page.eval(`showTab('vocab')`); await page.sleep(450);
  assert.ok(await pillUnder('.seg'), 'pill under My words');
  await page.eval(`showTab('lookup')`); await page.sleep(450);
  assert.ok(await pillUnder('.seg'), 'pill under Meaning');
  await page.eval('goToPage(2)');
  await page.waitFor('currentPage() === 2', 3000);
  const dark = await page.eval('isDark()');
  await page.eval(`document.querySelector('#themeBtn').click()`);
  await page.waitFor(`isDark() === ${!dark} && !document.querySelector('.page canvas.stand-in')`, 5000);
  await page.eval(`document.querySelector('#themeBtn').click()`);
  await page.waitFor(`isDark() === ${dark} && !document.querySelector('.page canvas.stand-in')`, 5000);
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

test('streaming: the meaning shows before the whole answer has arrived', async () => {
  await fresh();
  await openPdf();
  // Gemini's streaming endpoint, faked: the reply comes in four pieces, 250 ms apart.
  await page.eval(`{
    askModel = __realAskModel; // the app's own, which streams
    settings.provider = 'gemini'; geminiWorking = 'gemini-test-flash-lite';
    const reply = '{"translation": "ضفّة النهر", "explanation": "Here it is the land by a river.", "base_form": "bank", "part_of_speech": "noun", "other_meanings": ["بنك"], "sentence_translation": "جلست على ضفّة النهر."}';
    const pieces = [reply.slice(0, 40), reply.slice(40, 90), reply.slice(90, 150), reply.slice(150)];
    window.__seen = [];
    const realFetch = window.fetch;
    window.fetch = async (url, init) => {
      if (!String(url).includes(':streamGenerateContent')) return realFetch(url, init);
      const enc = new TextEncoder();
      const stream = new ReadableStream({ async start(c) {
        for (const p of pieces) { await new Promise(r => setTimeout(r, 250)); c.enqueue(enc.encode('data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: p }] } }] }) + '\\r\\n\\r\\n')); }
        c.close(); } });
      return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    };
    new MutationObserver(() => { const tr = document.querySelector('#lookup .tr'); if (tr) __seen.push([!!document.querySelector('#lookup .streaming'), tr.textContent]); }).observe(document.querySelector('#lookup'), { childList: true, subtree: true });
  }`);
  await page.eval(`clickWord('bank of the river', 'bank')`);
  await page.waitFor(`document.querySelector('#lookup .result:not(.streaming) .tr')`, 5000);
  const seen = await page.eval('__seen');
  assert.ok(seen.some(([streaming, tr]) => streaming && tr === 'ضفّة النهر'), 'the meaning appeared while the answer was still streaming');
  assert.equal(await page.eval(`document.querySelector('#lookup .tr').textContent`), 'ضفّة النهر');
  assert.ok(await page.eval(`[...document.querySelectorAll('#lookup .chip')].some(c => c.textContent === 'بنك')`), 'the full answer, other meanings included, arrives at the end');
});

test('demo book: dotted words have ready meanings without a key', async () => {
  await fresh({ toured: true, setupSkipped: true, settings: { uiLang: 'ar', lang: 'ar' } });
  await page.eval(`document.querySelector('#empty [data-demo]').click()`);
  await page.waitFor(`demoOpen() && document.querySelectorAll('.demo-word').length >= 8`);
  const clickIn = word => `{ const el = [...document.querySelectorAll('.epub-chapter p')].map(p => textNode(p, '${word}')).find(Boolean);
    const r = document.createRange(), i = el.textContent.indexOf('${word}'); r.setStart(el, i + 1); r.setEnd(el, i + 2);
    const b = r.getBoundingClientRect(); document.elementFromPoint(b.left + 1, b.top + b.height / 2).dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: b.left + 1, clientY: b.top + b.height / 2 })); }`;
  await page.eval(clickIn('peeped'));
  await page.waitFor(`document.querySelector('#lookup .tr')`);
  assert.equal(await page.eval(`document.querySelector('#lookup .tr').textContent`), 'اختلست النظر');
  assert.ok(await page.eval(`!!document.querySelector('#lookup .demo-note') && vocab[0]?.word === 'peeped'`), 'saved, with a note about getting a key');
  assert.equal(await page.eval(`document.querySelector('#setup').open`), false, 'no setup pops up in the demo');
  await page.eval(clickIn('sister'));
  await page.waitFor(`document.querySelector('#lookup .state')`);
  assert.equal(await page.eval(`document.querySelector('#lookup .state p').textContent`), await page.eval(`t('demoOnly')`));
});

test('demo button: on the start screen for new readers only', async () => {
  await fresh({ toured: true, setupSkipped: true, settings: { uiLang: 'en', lang: 'ar' } });
  assert.equal(await page.eval(`document.querySelector('#empty [data-demo]').offsetParent !== null`), true, 'shown to someone new');
  await openPdf();
  await page.eval(`document.querySelector('#homeBtn').click()`);
  assert.equal(await page.eval(`document.querySelector('#empty [data-demo]').offsetParent`), null, 'gone once a book was opened');
  assert.ok(await page.eval(`!!document.querySelector('#setup [data-demo]')`), 'still at the end of the tour');
});

test('side panel: hidden and back, wider and narrower, remembered', async () => {
  await fresh();
  await openPdf();
  const width = () => page.eval(`Math.round(document.querySelector('#panel').getBoundingClientRect().width)`);
  assert.equal(await width(), 380);
  // the keyboard on its edge: right arrow widens it in English (it is on the left)
  await page.eval(`{ const g = document.querySelector('#panelGrip'); for (let i = 0; i < 3; i++) g.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); }`);
  assert.equal(await width(), 440);
  assert.equal(await page.eval(`store.get('panelWidth')`), 440);
  // hiding it leaves the pages as they are: no redrawing, no blur, the same place on the page
  const fit = await page.eval(`fitScale`), drawn = await page.eval(`document.querySelector('.page[data-page="1"] canvas')`);
  await page.eval(`window.__canvas = document.querySelector('.page[data-page="1"] canvas'); document.querySelector('#panelHide').click()`);
  await page.sleep(900);
  assert.equal(await page.eval(`fitScale`), fit, 'the same size');
  assert.ok(await page.eval(`document.querySelector('.page[data-page="1"] canvas') === __canvas && !viewer.style.getPropertyValue('--live-zoom')`), 'not drawn again');
  assert.ok(await page.eval(`document.querySelector('#panel').classList.contains('closed') && !document.querySelector('#panelShow').hidden && store.get('panelHidden')`));
  // a word brings it back
  await page.eval(`clickWord('bank')`);
  await page.waitFor(`document.querySelector('#lookup .tr')`);
  assert.ok(await page.eval(`!document.querySelector('#panel').classList.contains('closed') && document.querySelector('#panelShow').hidden`));
  await page.eval(`document.querySelector('#panelGrip').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
  assert.equal(await width(), 380, 'a double-click puts it back');
  // a panel so wide the pages no longer fit across: they are drawn again, smaller, once
  await page.eval(`{ setPanelWidth(720, true); }`);
  await page.waitFor(`fitScale < ${fit} - 0.01 && Math.abs(fitWidthScale() - fitScale) < 0.01`, 3000);
  await page.eval(`setPanelWidth(380, true)`);
});

test('reading mode: only the page, the meaning in a card over the word, Esc to leave', async () => {
  await fresh();
  await openPdf();
  await page.sleep(600); // the book settles at its page first
  await page.eval(`{ viewer.scrollTop = 120; window.__before = [fitScale, document.querySelector('.page[data-page="1"]').getBoundingClientRect().top]; }`);
  await page.eval(`document.querySelector('#readBtn').click()`);
  await page.sleep(450);
  assert.ok(await page.eval(`document.body.classList.contains('reading') && !document.querySelector('#readBar').hidden`));
  assert.ok(await page.eval(`document.querySelector('.bar').getBoundingClientRect().bottom <= 1 && document.querySelector('#panel').offsetParent === null`), 'no bar, no panel');
  assert.ok(await page.eval(`Math.abs(viewer.getBoundingClientRect().width - innerWidth) < 2`), 'the page has the whole width');
  assert.deepEqual(await page.eval(`[fitScale, Math.round(document.querySelector('.page[data-page="1"]').getBoundingClientRect().top)]`), [await page.eval(`__before[0]`), Math.round(await page.eval(`__before[1]`))], 'the page stays where it was');
  // the bar comes down at the top of the window
  await page.eval(`document.dispatchEvent(new PointerEvent('pointermove', { clientX: 300, clientY: 4, bubbles: true }))`);
  await page.sleep(400);
  assert.ok(await page.eval(`Math.round(document.querySelector('.bar').getBoundingClientRect().top) === 0`));
  await page.eval(`document.dispatchEvent(new PointerEvent('pointermove', { clientX: 300, clientY: 400, bubbles: true }))`);
  // a word: its card, under it, with the meaning only
  await page.eval(`clickWord('bank')`);
  await page.waitFor(`document.querySelector('#wordCard .wc-tr')?.textContent === 'T-ar'`);
  const card = await page.eval(`(() => { const c = document.querySelector('#wordCard').getBoundingClientRect(), w = spanWith('bank').getBoundingClientRect();
    return { below: c.top > w.top, near: c.top - w.bottom < 30, small: c.width <= 330 && c.height < 120, text: document.querySelector('#wordCard').innerText.trim().split(/\\n+/) }; })()`);
  assert.deepEqual(card, { below: true, near: true, small: true, text: ['bank', 'T-ar'] });
  assert.ok(await page.eval(`vocab.some(v => v.word === 'bank')`), 'still saved to My words');
  await page.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  assert.ok(await page.eval(`document.querySelector('#wordCard').hidden && document.body.classList.contains('reading')`), 'first Esc: the card goes');
  await page.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await page.sleep(400);
  assert.ok(await page.eval(`!document.body.classList.contains('reading') && document.querySelector('#readBar').hidden`), 'second Esc: back to normal');
  assert.ok(await page.eval(`Math.abs(document.querySelector('.page[data-page="1"]').getBoundingClientRect().top - __before[1]) < 2 && fitScale === __before[0] && document.querySelector('#panel').offsetParent !== null`), 'everything as it was');
  // the reading colour: off unless chosen; once chosen, on whenever reading mode is, and only then
  assert.equal(await page.eval(`settings.readTint || 'none'`), 'none');
  await page.eval(`document.querySelector('#readBtn').click()`);
  assert.equal(await page.eval(`/tint-(sepia|sage)/.test(document.body.className)`), false, 'no colour by default');
  await page.eval(`document.querySelector('#readBar [data-tint="sepia"]').click()`);
  assert.ok(await page.eval(`document.body.classList.contains('tint-sepia') && store.get('settings').readTint === 'sepia'`));
  assert.notEqual(await page.eval(`getComputedStyle(document.querySelector('.page canvas')).filter`), 'none', 'the pages are tinted');
  await page.eval(`document.querySelector('#readExit').click()`);
  assert.equal(await page.eval(`/tint-(sepia|sage)/.test(document.body.className)`), false, 'gone outside reading mode');
  await page.eval(`document.querySelector('#readBtn').click()`);
  assert.ok(await page.eval(`document.body.classList.contains('tint-sepia')`), 'back with reading mode');
  await page.eval(`{ document.querySelector('#readBar [data-tint="none"]').click(); document.querySelector('#readExit').click(); }`);
});

// Nothing on top of anything else, and no label cut off: the bar, the panel and the key steps, in every language,
// from a wide window to a phone.
const LAYOUT_CHECK = `window.overlaps = root => {
  const shown = el => { const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const name = e => e.id || (typeof e.className === 'string' && e.className) || e.tagName, out = [];
  for (const g of [root, ...root.querySelectorAll('*')]) {
    if (g.closest('svg') || g.children.length < 2) continue;
    const kids = [...g.children].filter(k => !(k instanceof SVGElement) && shown(k) && !['absolute', 'fixed'].includes(getComputedStyle(k).position));
    for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
      const a = kids[i].getBoundingClientRect(), b = kids[j].getBoundingClientRect();
      if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1.5) out.push(name(kids[i]) + ' × ' + name(kids[j]));
    }
  }
  for (const el of root.querySelectorAll('button, .btn, select, .seg button > span')) if (shown(el) && el.scrollWidth > el.clientWidth + 1) out.push('cut off: ' + (el.id || el.textContent.trim().slice(0, 30)));
  return out;
}; 1`;
test('layout: nothing overlaps or is cut off, in every language and width', async () => {
  await fresh();
  await openPdf();
  await page.eval(LAYOUT_CHECK);
  const found = [];
  for (const width of [1400, 1024, 860, 700, 420]) {
    await page.size(width, 900);
    for (const lang of ['ar', 'en', 'tr']) {
      await page.eval(`{ settings.uiLang = '${lang}'; applyUiLanguage(); }`);
      await page.sleep(150);
      for (const part of ['.bar', '#panel']) for (const o of await page.eval(`overlaps(document.querySelector('${part}'))`)) found.push(`${width}px ${lang} ${part}: ${o}`);
    }
  }
  await page.size(1400, 900);
  for (const lang of ['ar', 'en', 'tr']) {
    await page.eval(`{ settings.uiLang = '${lang}'; applyUiLanguage(); openSetup(); }`);
    await page.sleep(350);
    assert.equal(await page.eval(`document.querySelectorAll('#setup .steps .shot').length`), 3, 'a picture for each key step');
    for (const o of await page.eval(`overlaps(document.querySelector('#setup .slide.on'))`)) found.push(`${lang} key steps: ${o}`);
    await page.eval(`document.querySelector('#setup').close()`);
  }
  assert.deepEqual(found, []);
});

test('no JavaScript errors anywhere above', () => {
  assert.deepEqual(page.errors, []);
});
