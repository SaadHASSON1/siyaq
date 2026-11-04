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
  revealPanel(word);
  const pane = $('#lookup');
  if (!settings.apiKey && settings.provider !== 'openai') {
    lastLookup = { word, sentence };
    // The demo book answers its dotted words without a key; any other word there says how to get one.
    const demo = demoAnswer(word);
    if (demo) {
      renderResult(word, sentence, demo);
      $('#lookup .result').insertAdjacentHTML('beforeend', `<p class="demo-note">${icon('sparkle')}<span>${t('demoNote')}</span> <button class="link-btn" id="keyBtn">${t('getKey')}</button></p>`);
      $('#keyBtn').onclick = () => openSetup();
      saveWord(word, sentence, demo);
      return;
    }
    pane.innerHTML = wordHead(word) + stateCard('key', t(demoOpen() ? 'demoOnly' : 'needKey'), `<button class="btn primary" id="keyBtn">${t(demoOpen() ? 'getKey' : 'openSettings')}</button>`);
    $('#keyBtn').onclick = () => openSetup();
    if (!demoOpen()) openSetup();
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
    // While the answer streams in, show what has arrived (the meaning first), with the rest still loading.
    let frame = 0, latest = '';
    const r = cache.get(key) || await askAI(word, sentence, text => {
      latest = text;
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        const p = partialFields(latest);
        if (id === lookupId && p.translation) renderPartial(word, sentence, p);
      });
    });
    cancelAnimationFrame(frame);
    if (!fromCache) countUse('words');
    const { _took, ...kept } = r;
    cache.set(key, kept); // a saved answer shows no time: it took none
    if (!fromCache) r._took = { model: lastModel, failed: [...lastFailed], ms: Math.round(performance.now() - started) };
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

// ---------- The answer, flowing in ----------
// One layout, filled as the answer arrives: each new word fades in from a soft blur, a section glides in when it
// first has something, and nothing already on screen moves or is drawn again. Words appear only once whole, so
// Arabic letters always join.
function startFlow(word, sentence) {
  const d = `dir="${LANGS[settings.lang].dir}"`;
  $('#lookup').innerHTML = `
    <article class="result streaming flow-view">
      ${wordHead(word, '<div class="meta" data-slot="meta"></div>')}
      <p class="tr" ${d} data-slot="translation"></p>
      <p class="explain" ${d} data-slot="explanation"></p>
      <div class="skeleton" data-wait><span></span><span class="short"></span></div>
      ${sentenceBlock(word, sentence)}
      <button class="link-btn" type="button" data-ask-sentence>${icon('sparkle')}${t('askSentence')}</button>
      <section data-wrap="sentence_translation" hidden><h3 class="label">${t(sameLanguage() ? 'sentenceSimple' : 'sentenceTr')}</h3><p ${d} data-slot="sentence_translation"></p></section>
      <section data-wrap="other_meanings" hidden><h3 class="label">${t('others')}</h3><div class="chips" ${d} data-slot="other_meanings"></div></section>
    </article>`;
}

// Shows `text` in `el`, adding only what is new, a word at a time. Until `done`, a last word still being written
// waits for the space after it.
function flowText(el, text, done) {
  if (!el || text == null) return;
  text = String(text);
  const ready = done ? text : text.slice(0, text.search(/\s\S*$/) + 1);
  let shown = el.dataset.shown || '';
  if (!ready.startsWith(shown)) { el.textContent = ''; shown = ''; } // the answer changed course: start over
  const add = ready.slice(shown.length);
  if (!add) return;
  let delay = 0;
  for (const part of add.split(/(\s+)/)) {
    if (!part) continue;
    if (/^\s+$/.test(part)) { el.append(part); continue; }
    const w = document.createElement('span');
    w.className = 'flow';
    w.style.animationDelay = delay + 'ms';
    delay = Math.min(delay + 32, 480);
    w.textContent = part;
    el.append(w);
  }
  el.dataset.shown = ready;
  const wrap = el.closest('[data-wrap]');
  if (wrap?.hidden) { wrap.hidden = false; wrap.classList.add('glide'); }
}

// Fills the layout with what the answer has so far (`closed`: the fields that are complete; none means all).
function fillFlow(word, r, closed, final = false) {
  const pane = $('#lookup'), slot = name => pane.querySelector(`[data-slot="${name}"]`);
  const done = name => final || !closed || closed.has(name);
  for (const name of ['translation', 'explanation', 'sentence_translation']) flowText(slot(name), r[name], done(name));
  const meta = slot('meta');
  if (meta && !meta.childElementCount && (done('part_of_speech') && r.part_of_speech || final)) {
    const d = `dir="${LANGS[settings.lang].dir}"`;
    const base = r.base_form && r.base_form.toLowerCase() !== word.toLowerCase() ? `<span dir="auto">${esc(r.base_form)}</span>` : '';
    meta.innerHTML = `${r.part_of_speech ? `<span class="pos" ${d}>${esc(r.part_of_speech)}</span>` : ''}${base}`;
    meta.classList.add('glide');
  }
  if (!final) return;
  const chips = slot('other_meanings');
  if (chips && r.other_meanings?.length && !chips.childElementCount) {
    chips.innerHTML = r.other_meanings.map((m, i) => `<span class="chip rise" style="animation-delay:${120 + i * 70}ms">${esc(m)}</span>`).join('');
    chips.closest('[data-wrap]').hidden = false;
    chips.closest('[data-wrap]').classList.add('glide');
  }
  pane.querySelector('[data-wait]')?.remove();
  pane.querySelector('.result')?.classList.remove('streaming');
  if (r._took) pane.querySelector('.result').insertAdjacentHTML('beforeend', `<p class="took glide" dir="ltr">${(r._took.failed || []).map(m => `<s>${esc(m)}</s> → `).join('')}${esc(r._took.model.replace(/^models\//, ''))} · ${(r._took.ms / 1000).toFixed(1)}s</p>`);
}

// The whole answer at once (saved, from the demo, or from a provider that doesn't stream), flowing in the same way.
function renderResult(word, sentence, r) {
  if (!$('#lookup .flow-view.streaming')) startFlow(word, sentence);
  fillFlow(word, r, null, true);
}

// Part of an answer while it streams.
function renderPartial(word, sentence, p) {
  if (!$('#lookup .flow-view.streaming')) startFlow(word, sentence);
  fillFlow(word, p, p._closed);
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
