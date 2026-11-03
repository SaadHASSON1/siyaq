// The meaning panel, pronunciation and My words.

// ---------- Lookup panel ----------
const canSpeak = 'speechSynthesis' in window;
const speakBtn = word => canSpeak ? `<button class="icon-btn speak" data-say="${esc(word)}" title="${t('speak')}" aria-label="${t('speak')}">${icon('volume')}</button>` : '';
const wordHead = (word, meta = '') => `<header class="result-head"><h2 class="word" dir="auto">${esc(word)}</h2>${speakBtn(word)}${meta}</header>`;
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const markWord = (sentence, word) => esc(sentence).replace(new RegExp(escRe(esc(word)), 'i'), m => `<mark>${m}</mark>`);
const section = (title, body) => `<section><h3 class="label">${title}</h3>${body}</section>`;
const stateCard = (iconName, text, action = '', cls = '') => `<div class="state ${cls}">${icon(iconName)}<p>${text}</p>${action}</div>`;

function sentenceBlock(word, sentence) {
  return section(t('sentence'), `<blockquote class="sentence" dir="auto">${markWord(sentence, word)}</blockquote>`);
}

async function lookup(word, sentence, fresh = false) {
  showTab('lookup');
  const pane = $('#lookup');
  if (!settings.apiKey && settings.provider !== 'openai') {
    lastLookup = { word, sentence };
    pane.innerHTML = wordHead(word) + stateCard('key', t('needKey'), `<button class="btn primary" id="keyBtn">${t('openSettings')}</button>`);
    $('#keyBtn').onclick = openSetup;
    openSetup();
    return;
  }
  const id = ++lookupId;
  lastLookup = { word, sentence };
  const key = settings.lang + '|' + word.toLowerCase() + '|' + sentence;
  // A word looked up before in another sentence: show what we know right away, spending nothing.
  const saved = !fresh && !cache.has(key) && !word.includes(' ') && vocab.find(v => v.word.toLowerCase() === word.toLowerCase() && wordTo(v) === settings.lang);
  if (saved) { renderSaved(word, sentence, saved); return; }
  if (!cache.has(key)) {
    pane.innerHTML = `<article class="result">${wordHead(word)}<div class="skeleton"><span></span><span></span><span class="short"></span></div>${sentenceBlock(word, sentence)}</article>`;
  }
  try {
    const fromCache = cache.has(key), started = performance.now();
    const r = cache.get(key) || await askAI(word, sentence);
    if (!fromCache) countUse('words');
    const { _took, ...kept } = r;
    cache.set(key, kept); // a saved answer shows no time: it took none
    if (!fromCache) r._took = { model: lastModel, ms: Math.round(performance.now() - started) };
    store.set('cache', [...cache].slice(-500));
    if (id !== lookupId) return;
    renderResult(word, sentence, r);
    saveWord(word, sentence, r);
  } catch (err) {
    if (id !== lookupId) return;
    pane.innerHTML = `<article class="result">${wordHead(word)}${stateCard('alert', esc(err.message), `<button class="btn" id="retryBtn">${t('retry')}</button>`, 'error')}${sentenceBlock(word, sentence)}</article>`;
    $('#retryBtn').onclick = () => lookup(word, sentence);
  }
}

function renderResult(word, sentence, r) {
  const d = `dir="${LANGS[settings.lang].dir}"`;
  const pos = r.part_of_speech ? `<span class="pos" ${d}>${esc(r.part_of_speech)}</span>` : '';
  const base = r.base_form && r.base_form.toLowerCase() !== word.toLowerCase() ? `<span dir="auto">${esc(r.base_form)}</span>` : '';
  const others = (r.other_meanings || []).map(m => `<span class="chip">${esc(m)}</span>`).join('');
  $('#lookup').innerHTML = `
    <article class="result">
      ${wordHead(word, pos || base ? `<div class="meta">${pos}${base}</div>` : '')}
      <p class="tr" ${d}>${esc(r.translation)}</p>
      <p class="explain" ${d}>${esc(r.explanation)}</p>
      ${sentenceBlock(word, sentence)}
      <button class="link-btn" type="button" data-ask-sentence>${icon('sparkle')}${t('askSentence')}</button>
      ${r.sentence_translation ? section(t(sameLanguage() ? 'sentenceSimple' : 'sentenceTr'), `<p ${d}>${esc(r.sentence_translation)}</p>`) : ''}
      ${others ? section(t('others'), `<div class="chips" ${d}>${others}</div>`) : ''}
      ${r._took ? `<p class="took" dir="ltr">${esc(r._took.model.replace(/^models\//, ''))} · ${(r._took.ms / 1000).toFixed(1)}s</p>` : ''}
    </article>`;
}

function renderSaved(word, sentence, v) {
  const d = `dir="${LANGS[settings.lang].dir}"`;
  $('#lookup').innerHTML = `
    <article class="result">
      ${wordHead(word)}
      <p class="tr" ${d}>${esc(v.translation)}</p>
      <p class="explain" ${d}>${esc(v.explanation || '')}</p>
      <p class="saved-note">${t('savedMeaning')}</p>
      <button class="btn" id="hereBtn">${t('explainHere')}</button>
      ${sentenceBlock(word, sentence)}
    </article>`;
  $('#hereBtn').onclick = () => lookup(word, sentence, true);
}

// ---------- Pronunciation ----------
function speak(text) {
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const lang = LANGS[bookLang] ? bookLang : /[\u0600-\u06FF]/.test(text) ? 'ar' : null;
  const voice = lang && speechSynthesis.getVoices().find(v => v.lang.toLowerCase().startsWith(lang));
  if (voice) u.voice = voice;
  if (lang) u.lang = voice?.lang || lang;
  u.rate = 0.9;
  speechSynthesis.speak(u);
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-say]');
  if (b) speak(b.dataset.say);
});

// ---------- Vocabulary ----------
// Which language a saved word is from and into. Words saved before this was recorded are guessed from their letters.
const guessLang = text => /[\u0600-\u06FF]/.test(text) ? 'ar' : /[çğıöşüİĞŞ]/.test(text) ? 'tr' : 'en';
const wordTo = v => v.lang || guessLang(v.translation || '');
const wordFrom = v => v.from || guessLang(v.word || '');

function saveWord(word, sentence, r) {
  vocab = vocab.filter(v => !(v.word.toLowerCase() === word.toLowerCase() && v.sentence === sentence && wordTo(v) === settings.lang));
  vocab.unshift({ word, translation: r.translation, explanation: r.explanation, sentence, book: bookName, bookKey, page: clickPage,
    lang: settings.lang, from: LANGS[bookLang] ? bookLang : guessLang(word), date: new Date().toISOString() });
  store.set('vocab', vocab);
  updateVocabCount();
  refreshKnown();
}

const updateVocabCount = () => { $('#vocabCount').textContent = vocab.length || ''; };

// My words, grouped by book (the open one first), each with its sentence, review progress, and an arrow
// back to the page it was looked up on.
let vocabFilter = '', vocabPair = 'all';
const pairOf = v => wordFrom(v) + '>' + wordTo(v);
function renderVocab() {
  updateVocabCount();
  const pane = $('#vocab');
  if (!vocab.length) { pane.innerHTML = stateCard('bookmark', t('vocabEmpty')); return; }
  const q = vocabFilter.toLowerCase();
  // One tab per language pair, "from English to Arabic", when there is more than one.
  const pairs = [...new Set(vocab.map(pairOf))];
  if (!pairs.includes(vocabPair)) vocabPair = 'all';
  const pairName = p => { const [a, b] = p.split('>'); return t('pairLabel')(LANG_NAMES[a] || a, LANG_NAMES[b] || b); };
  const pairTabs = pairs.length > 1 ? `<nav class="v-pairs">${['all', ...pairs].map(p => `<button type="button" data-pair="${p}" class="${p === vocabPair ? 'on' : ''}">${p === 'all' ? t('allWords') : pairName(p)}<span>${p === 'all' ? vocab.length : vocab.filter(v => pairOf(v) === p).length}</span></button>`).join('')}</nav>` : '';
  const shown = vocab.map((v, i) => [v, i]).filter(([v]) => (vocabPair === 'all' || pairOf(v) === vocabPair)
    && (!q || [v.word, v.translation, v.book].some(x => String(x || '').toLowerCase().includes(q))));
  const groups = new Map();
  for (const [v, i] of shown) {
    const key = v.book || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push([v, i]);
  }
  const isOpen = name => name && name === bookName;
  const ordered = [...groups].sort(([a], [b]) => isOpen(b) - isOpen(a));
  const when = d => { const days = Math.round((Date.parse(d) - Date.now()) / 864e5); return Number.isFinite(days) ? new Intl.RelativeTimeFormat(settings.uiLang, { numeric: 'auto' }).format(days, 'day') : ''; };
  const item = (v, i) => `
    <li data-open="${i}">
      <div class="v-body">
        <div class="v-main"><span class="w" dir="auto">${esc(v.word)}</span><span class="v-tr" dir="auto">${esc(v.translation)}</span></div>
        ${v.sentence ? `<div class="v-sent" dir="auto">${markWord(v.sentence, v.word)}</div>` : ''}
        <div class="v-meta">
          ${v.page ? `<span>${t('pageN')(v.page)}</span>` : ''}
          <span>${when(v.date)}</span>
          <span class="v-dots" title="${t('progress')}">${[1, 2, 3, 4, 5].map(n => `<span class="${(v.box || 0) >= n ? 'on' : ''}"></span>`).join('')}</span>
        </div>
      </div>
      <div class="v-acts">
        ${v.page ? `<button class="icon-btn go" data-go="${i}" title="${t('goToWord')}" aria-label="${t('goToWord')}">${icon('arrow')}</button>` : ''}
        <button class="icon-btn x" data-x="${i}" title="${t('remove')}" aria-label="${t('remove')}">${icon('x')}</button>
      </div>
    </li>`;
  pane.innerHTML = `
    <div class="vocab-head"><span>${t('count')(vocab.length)}</span><span class="btns">
      <button class="btn small primary" id="reviewBtn">${icon('repeat')}${t('review')}<span class="badge">${dueWords().length || ''}</span></button>
      <button class="btn small" id="exportBtn" title="${t('export')}">${icon('download')}</button></span></div>
    ${pairTabs}
    ${vocab.length > 8 ? `<input class="vocab-filter" id="vocabFilter" type="search" dir="auto" placeholder="${t('vocabFilterPh')}" value="${esc(vocabFilter)}">` : ''}
    ${ordered.map(([book, list]) => `<section class="v-group">
      <h3 class="v-group-head${isOpen(book) ? ' open-book' : ''}" dir="auto">${icon('book')}<span>${esc(book.replace(/\.(pdf|epub)$/i, '') || t('noBookName'))}</span><span class="n">${list.length}</span></h3>
      <ul class="vocab-list">${list.map(([v, i]) => item(v, i)).join('')}</ul></section>`).join('') || stateCard('search', t('noMatches'))}`;
  $('#exportBtn').onclick = exportCsv;
  $('#reviewBtn').onclick = startReview;
  const filter = $('#vocabFilter');
  if (filter) filter.oninput = () => { vocabFilter = filter.value; const at = filter.selectionStart; renderVocab(); const f = $('#vocabFilter'); f.focus(); f.setSelectionRange(at, at); };
  pane.onclick = e => {
    const x = e.target.closest('[data-x]'), go = e.target.closest('[data-go]'), open = e.target.closest('[data-open]'), pair = e.target.closest('[data-pair]');
    if (pair) { vocabPair = pair.dataset.pair; renderVocab(); }
    else if (x) { vocab.splice(+x.dataset.x, 1); store.set('vocab', vocab); refreshKnown(); renderVocab(); }
    else if (go) goToWord(vocab[+go.dataset.go]);
    else if (open) { const v = vocab[+open.dataset.open]; lastLookup = { word: v.word, sentence: v.sentence }; showTab('lookup'); renderSaved(v.word, v.sentence, v); }
  };
}

// Back to the page a word was looked up on, with the word flashing there; or say which book to open.
function goToWord(v) {
  const sameBook = pdfDoc && (v.bookKey ? v.bookKey === bookKey : v.book === bookName);
  if (!sameBook) { showToast(t('openBookFirst')(String(v.book || '').replace(/\.(pdf|epub)$/i, ''))); return; }
  backTo = viewer.scrollTop;
  $('#backBtn').hidden = false;
  goToPage(v.page);
  setTimeout(() => {
    const page = viewer.querySelector(`.page[data-page="${v.page}"]`);
    const marks = [...(page?.querySelectorAll('mark.known') || [])].filter(m => m.textContent.toLowerCase() === v.word.toLowerCase());
    marks.forEach(m => { m.classList.remove('blink'); void m.offsetWidth; m.classList.add('blink'); });
    marks[0]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, 600);
}

function exportCsv() {
  const q = s => '"' + String(s ?? '').replace(/"/g, '""') + '"';
  const rows = vocab.map(v => [v.word, `${v.translation} — ${v.explanation}`, v.sentence, v.book].map(q).join(','));
  saveText('siyaq-vocab.csv', '﻿' + rows.join('\n'), 'text/csv;charset=utf-8').catch(err => showToast(String(err)));
}
