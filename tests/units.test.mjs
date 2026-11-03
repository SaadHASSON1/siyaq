// Unit tests for the app's text and language functions, run inside the real page so they test the code as shipped.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { launch, serve } from './browser.mjs';

let page, server;
before(async () => {
  page = await launch();
  server = await serve(fileURLToPath(new URL('../src/', import.meta.url)));
  await page.open(server.url, { toured: true, settings: { uiLang: 'en', lang: 'ar', apiKey: 'x' } });
});
after(() => { page?.close(); server?.close(); });

const call = (fn, ...args) => page.eval(`${fn}(...${JSON.stringify(args)})`);

test('readingOrder: right-to-left lines, with English and numbers kept left to right', async () => {
  const order = async (pieces) => (await call('readingOrder', pieces)).map(i => pieces[i]).join('');
  const visual = s => [...s].reverse(); // a piece per letter, as some PDFs lay them out, left to right on the page
  assert.equal(await order(visual('الأمر اللي بيطبع على الشاشة')), 'الأمر اللي بيطبع على الشاشة');
  assert.equal(await order(['cout << "Hello world!";', ' ', ':الشاشة', ' ', 'على', ' ', 'بيطبع']), 'بيطبع على :الشاشة cout << "Hello world!";');
  assert.equal(await order(['She sat on', ' ', 'the bank']), 'She sat on the bank', 'English lines are left alone');
  assert.equal(await order(['The word', ' ', 'كتاب', ' ', 'means book']), 'The word كتاب means book');
  assert.equal(await order(['2026', ' ', 'سنة']), 'سنة 2026');
  assert.deepEqual(await call('readingOrder', []), []);
});

test('itemsToText: PDF.js items joined line by line in reading order', async () => {
  const text = await call('itemsToText', [{ str: 'العالم', hasEOL: false }, { str: ' ', hasEOL: false }, { str: 'مرحبا', hasEOL: true }, { str: 'Hello', hasEOL: true }]);
  assert.equal(text, 'مرحبا العالم\nHello');
});

test('presentation forms: shaped Arabic letters read as plain letters', async () => {
  const text = await call('itemsToText', [{ str: 'ﺑﻴﻄﺒﻊ', hasEOL: false }, { str: ' ', hasEOL: false }, { str: 'اﻷﻣﺮ', hasEOL: true }]);
  assert.equal(text, 'الأمر بيطبع');
});

test('cutSentence: to the nearest sentence end, at most 120 characters each side, cut between words', async () => {
  const text = 'First one. She sat on the bank of the river. Third one!';
  assert.equal(await call('cutSentence', text, text.indexOf('bank')), 'She sat on the bank of the river.');
  assert.equal(await call('cutSentence', 'سؤال؟ هذا جواب قصير. ثم شيء آخر', 9), 'هذا جواب قصير.');
  const long = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ');
  const cut = await call('cutSentence', long, long.indexOf('word40'));
  assert.ok(cut.length <= 245, `at most about 240 characters (got ${cut.length})`);
  assert.match(cut, /^word\d+ .* word\d+$/, 'starts and ends on whole words');
  assert.ok(cut.includes('word40'));
});

test('isWordChar: letters, marks and numbers in any script, plus apostrophes and hyphens', async () => {
  for (const c of ['a', 'Z', 'ş', 'ب', 'ً', '٣', '7', "'", '’', '-']) assert.equal(await call('isWordChar', c), true, c);
  for (const c of [' ', '.', ',', '،', '(', '"', '؟']) assert.equal(await call('isWordChar', c), false, c);
});

test('detectLanguage: Arabic, English, Turkish, or unknown when there is too little text', async () => {
  const en = 'The river was quiet and the old friends spoke of the towns they had seen in the long years of their travels. '.repeat(3);
  const tr = 'Bu kitap çok güzel ve ben her gün okuyorum, çünkü değil mi ama daha iyi bir şey yok gibi olarak kadar. '.repeat(3);
  const ar = 'هذا كتاب جميل جدا وأنا أقرأ فيه كل يوم لأنه يساعدني على فهم اللغة بشكل أفضل من أي شيء آخر. '.repeat(3);
  assert.equal(await call('detectLanguage', en), 'en');
  assert.equal(await call('detectLanguage', tr), 'tr');
  assert.equal(await call('detectLanguage', ar), 'ar');
  assert.equal(await call('detectLanguage', 'Short.'), null);
});

test('guessLang: the language of a saved word from its letters', async () => {
  assert.equal(await call('guessLang', 'ضفّة النهر'), 'ar');
  assert.equal(await call('guessLang', 'kıyı'), 'tr');
  assert.equal(await call('guessLang', 'riverbank'), 'en');
});

test('quotaMessage: daily and per-minute quotas, empty credit, and ordinary errors', async () => {
  const quota = id => ({ error: { message: 'You exceeded your current quota', status: 'RESOURCE_EXHAUSTED', details: [{ violations: [{ quotaId: id }] }] } });
  await page.eval(`settings.provider = 'gemini'`);
  assert.equal(await call('quotaMessage', 429, quota('GenerateRequestsPerDayPerProjectPerModel-FreeTier')), await page.eval(`t('quotaDay')('Gemini')`));
  assert.equal(await call('quotaMessage', 429, quota('GenerateRequestsPerMinutePerProjectPerModel-FreeTier')), await page.eval(`t('quotaMinute')`));
  await page.eval(`settings.provider = 'anthropic'`);
  assert.equal(await call('quotaMessage', 400, { error: { type: 'invalid_request_error', message: 'Your credit balance is too low' } }), await page.eval(`t('noCredit')('Claude')`));
  await page.eval(`settings.provider = 'openai'; settings.baseUrl = 'https://openrouter.ai/api/v1'`);
  assert.match(await call('quotaMessage', 429, { error: { code: 'insufficient_quota', message: 'x' } }), /openrouter\.ai/);
  assert.equal(await call('quotaMessage', 503, { error: { message: 'The model is overloaded' } }), null);
  assert.equal(await call('quotaMessage', 400, { error: { message: 'API key not valid' } }), null);
  await page.eval(`settings.provider = 'gemini'`);
});

test('mergeRects: boxes on the same line join; boxes on other lines stay apart', async () => {
  const merged = await call('mergeRects', [[0.1, 0.2, 0.1, 0.02], [0.2, 0.2, 0.1, 0.02], [0.1, 0.3, 0.2, 0.02]]);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged[0].map(v => +v.toFixed(3)), [0.1, 0.2, 0.2, 0.02]);
});

test('every interface string exists in all three languages', async () => {
  const missing = await page.eval(`(() => {
    const used = new Set([...document.documentElement.outerHTML.matchAll(/data-i18n(?:-title|-ph)?="([^"]+)"/g)].map(m => m[1]));
    return ['ar', 'tr'].flatMap(l => [...Object.keys(STRINGS.en), ...used].filter(k => !(k in STRINGS[l])).map(k => l + '.' + k))
      .concat([...used].filter(k => !(k in STRINGS.en)).map(k => 'en.' + k));
  })()`);
  assert.deepEqual(missing, []);
});
