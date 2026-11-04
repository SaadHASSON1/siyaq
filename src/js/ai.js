// Talking to the AI provider, and Ask about a passage.

// ---------- AI ----------
// Reading a book in the same language you asked for: explain in simpler words instead of translating.
const sameLanguage = () => bookLang === settings.lang;

function buildPrompt(word, sentence) {
  const lang = LANGS[settings.lang].english;
  const same = sameLanguage();
  return `You help someone understand a word while they read a book.
Word or phrase: "${word}"
The sentence it appears in: "${sentence}"
Language of the book: ${LANGS[bookLang]?.english || 'detect it from the sentence'}
Answer in: ${lang}
${same ? `The reader reads ${lang} but doesn't know this word, so explain it in simpler ${lang} rather than translating it.\n` : ''}
Give the meaning of the word AS USED IN THIS SENTENCE, not just its most common meaning.
Reply with JSON only, no markdown fences, in exactly this shape:
{"translation": "${same ? `a simpler ${lang} word or short phrase that means the same here` : `short translation of the word as used in this sentence, in ${lang}`}",
 "explanation": "one or two sentences in ${lang} explaining what it means here and why",
 "base_form": "dictionary form of the word in its original language",
 "part_of_speech": "part of speech, in ${lang}",
 "other_meanings": ["up to 3 other common meanings, in ${lang}"],
 "sentence_translation": "${same ? `the sentence rephrased in simpler ${lang}` : `translation of the whole sentence into ${lang}`}"}`;
}

const BUSY = [429, 503, 529]; // rate limited, high demand, overloaded

// Turns "out of quota" and "out of credit" replies into a plain sentence saying what to do.
// The reader's provider by name, for messages: Gemini, Claude, or the server they set (Ollama and others).
function providerName() {
  if (settings.provider === 'gemini') return 'Gemini';
  if (settings.provider === 'anthropic') return 'Claude';
  try { const host = new URL(settings.baseUrl).hostname; return /^(localhost|127\.0\.0\.1)$/.test(host) ? t('yourProvider') : host; }
  catch { return t('yourProvider'); }
}

function quotaMessage(status, json) {
  const e = json?.error || {}, text = `${e.message || ''} ${e.status || ''} ${e.type || ''} ${e.code || ''}`;
  if (/credit balance|insufficient_quota|billing/i.test(text)) return t('noCredit')(providerName());
  if (status === 429 && /quota|RESOURCE_EXHAUSTED/i.test(text)) {
    return /PerDay|per day|daily/i.test(JSON.stringify(e.details || '') + text) ? t('quotaDay')(providerName()) : t('quotaMinute');
  }
  return null;
}

// In the app, requests go through Rust so AI servers needn't allow browser (CORS) calls.
let lastRequest = 0;
async function requestJson(method, url, headers, body) {
  lastRequest = performance.now();
  if (tauri) {
    const r = await tauri.core.invoke('ai_request', { method, url, headers, body: body ?? null });
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: r.body };
  }
  const res = await fetch(url, { method, headers: { 'content-type': 'application/json', ...headers }, body: body && JSON.stringify(body) });
  return { ok: res.ok, status: res.status, json: await res.json() };
}

// One short retry for busy servers; anything longer defeats the point of a quick lookup.
async function postJson(url, headers, body) {
  let r = await requestJson('POST', url, headers, body);
  if (BUSY.includes(r.status)) {
    await new Promise(res => setTimeout(res, 800));
    r = await requestJson('POST', url, headers, body);
  }
  if (BUSY.includes(r.status)) throw new Error(quotaMessage(r.status, r.json) || t('busy'));
  return r;
}

// ----- Gemini: the fastest model that answers, chosen by itself -----
// Google's models are often busy (503), retired for new keys (404), or slow for minutes at a time; which ones
// changes from day to day. So the app keeps a note of how each model did (how long it took to start answering, and
// when it last failed), asks the best one first, and if that hasn't started answering after a moment, asks the
// next one too: whichever answers first is used. A busy or retired model costs well under a second.
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/';
const MAX_MODELS = 6;
// How long to wait for a model before asking the next one too: a little longer than it usually takes.
const hedgeAfter = model => Math.max(1200, Math.min(2500, (geminiStats[model]?.ms ?? 2500) * 1.5));
let geminiModels = null; // Flash and Flash-Lite models this key can use
let geminiStats = store.get('geminiStats', {}); // model → { ms: time to first text, failedAt, think }

async function listGeminiModels() {
  if (geminiModels) return geminiModels;
  const r = await requestJson('GET', GEMINI + 'models?pageSize=1000', { 'x-goog-api-key': settings.apiKey });
  geminiModels = (r.json?.models || [])
    .filter(m => m.supportedGenerationMethods?.includes('generateContent') && /^models\/gemini-[\d.]+-flash(-lite)?$/.test(m.name))
    .map(m => m.name.slice(7));
  return geminiModels;
}

const today = () => new Date().toISOString().slice(0, 10);
// Best first: a model out of today's free quota goes last, then one that failed in the last ten minutes; then the fastest seen lately; models not
// tried yet get a fair guess (Flash-Lite is meant to be quick, newer versions first).
function rankGemini(models) {
  const now = Date.now(), version = n => parseFloat(n.match(/gemini-([\d.]+)/)?.[1] || 0);
  const score = m => {
    const st = geminiStats[m] || {};
    return (st.outFor === today() ? 1e7 : 0) + (st.failedAt && now - st.failedAt < 600000 ? 1e6 : 0) + (st.ms ?? (m.endsWith('-lite') ? 3000 : 3500) - version(m) * 50);
  };
  return [...new Set(models)].filter(m => !geminiStats[m]?.gone).sort((a, b) => score(a) - score(b));
}
function noteGemini(model, ms) {
  const st = geminiStats[model] ||= {};
  if (ms == null) st.failedAt = Date.now();
  else { st.ms = st.ms == null ? ms : Math.round(st.ms * 0.6 + ms * 0.4); delete st.failedAt; }
  store.set('geminiStats', geminiStats);
}

// One answer from Gemini, streamed. onText gets the answer so far, from whichever model is answering.
async function askGemini(prompt, onText) {
  const listing = listGeminiModels().catch(() => []);
  // Start at once with the best model known from before; the list is only needed if that one fails.
  let order = rankGemini(Object.keys(geminiStats));
  if (!order.length) order = rankGemini(await listing);
  listing.then(all => { if (all.length) order = [...order, ...rankGemini(all).filter(m => !order.includes(m))]; });
  return new Promise((resolve, reject) => {
    let next = 0, live = 0, winner = null, finished = false, lastError = t('busy');
    const running = new Map(); // model → when it was asked, while it has said nothing
    const give = (fn, v) => { if (!finished) { finished = true; fn(v); } };
    const start = async () => {
      if (finished || winner) return;
      if (next >= order.length) await listing; // a moment for the full list, if it isn't in yet
      if (next >= Math.min(order.length, MAX_MODELS)) { if (!live) give(reject, new Error(lastError)); return; }
      const model = order[next++], t0 = performance.now();
      live++;
      running.set(model, t0);
      // nothing yet: ask the next one too (two at most at once: each costs a little of the free quota)
      const hedge = setTimeout(() => { if (!winner && live < 2) start(); }, hedgeAfter(model));
      let first = 0;
      geminiStream(model, prompt, text => {
        if (!first) { first = performance.now() - t0; clearTimeout(hedge); running.delete(model); }
        if (!winner) winner = model;
        if (winner === model) onText?.(text);
      }).then(text => {
        if (!/\{[\s\S]*\}/.test(text)) throw new Error(t('badReply')); // not the JSON asked for: try another
        live--;
        noteGemini(model, Math.round(first || performance.now() - t0));
        if (!winner || winner === model) {
          winner = model; lastModel = model; give(resolve, text);
          // the ones still silent lost the race: at least this slow, so they go after the winner next time
          for (const [m, at] of running) if (m !== model) noteGemini(m, Math.round(performance.now() - at));
        }
      }).catch(err => {
        live--;
        clearTimeout(hedge);
        running.delete(model);
        noteGemini(model, null);
        const { status, message } = geminiError(err);
        if (!lastFailed.includes(model)) lastFailed.push(model);
        lastWhy[model] = status || message.slice(0, 60);
        if (status === 404) { geminiStats[model].gone = true; store.set('geminiStats', geminiStats); } // retired: not asked again
        if (status === 429 && /PerDay|per day|daily/i.test(message)) { geminiStats[model].outFor = today(); store.set('geminiStats', geminiStats); } // out of today's quota
        // A wrong or blocked key fails every model: say so now.
        if (status === 400 && /API key|API_KEY/i.test(message) || status === 401 || status === 403) { give(reject, new Error(message)); return; }
        lastError = quotaMessage(status, { error: { message, status: status === 429 ? 'RESOURCE_EXHAUSTED' : '' } }) || (BUSY.includes(status) ? t('busy') : message);
        if (winner === model) winner = null;
        start();
      });
    };
    start();
  });
}
// What a failed stream said: Gemini's JSON error, or the plain message.
function geminiError(err) {
  const text = String(err?.message ?? err);
  try { const e = JSON.parse(text.slice(text.indexOf('{'))).error; return { status: e.code, message: e.message || text }; }
  catch { return { status: 0, message: text }; }
}

// ----- Streaming: the answer shows while it is still being written -----
// Reads Gemini's server-sent events and calls onText with all of the answer so far; returns the whole answer.
// A word lookup needs no step-by-step reasoning, and skipping it saves seconds. Models take different settings
// for that ("minimal" isn't allowed on some): the first one a model accepts is remembered for it.
const THINK = [{ thinkingLevel: 'minimal' }, { thinkingLevel: 'low' }, null];
async function geminiStream(model, prompt, onText) {
  const st = geminiStats[model] ||= {};
  let level = /gemini-2\./.test(model) ? -1 : st.think ?? 0;
  for (;;) {
    try { return await geminiStreamOnce(model, prompt, onText, level < 0 ? { thinkingBudget: 0 } : THINK[level]); }
    catch (err) {
      if (level < 0 || level >= THINK.length - 1 || !/thinking/i.test(geminiError(err).message)) throw err;
      st.think = ++level;
    }
  }
}
async function geminiStreamOnce(model, prompt, onText, thinkingConfig) {
  const url = `${GEMINI}models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
  const body = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.2, ...(thinkingConfig ? { thinkingConfig } : {}) } };
  const headers = { 'x-goog-api-key': settings.apiKey, 'content-type': 'application/json' };
  let buffer = '', text = '';
  const feed = chunk => {
    buffer += chunk;
    for (let i; (i = buffer.indexOf('\n')) >= 0;) {
      const line = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      try {
        const part = JSON.parse(line.slice(5));
        text += (part.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('');
        onText(text);
      } catch {} // a keep-alive or an unfinished line
    }
  };
  lastRequest = performance.now();
  if (tauri) {
    // In the app, through Rust (no CORS); pieces come over a channel, ending with a NUL.
    const channel = new tauri.core.Channel();
    const ended = new Promise(resolve => { channel.onmessage = m => (m === '\0' ? resolve() : feed(m)); });
    await tauri.core.invoke('ai_stream', { url, headers, body, onChunk: channel });
    await ended;
  } else {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(await res.text());
    const reader = res.body.getReader(), decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      feed(decoder.decode(value, { stream: true }));
    }
  }
  feed('\n');
  if (!text) throw new Error(t('badReply'));
  return text;
}

// A connection to Gemini, opened (and its TLS handshake done) while the reader's pointer is over the book, so the
// next lookup doesn't wait for one. Kept connections are dropped after 30 s idle: open one again after 25 s.
// The models list is free: it costs no quota.
function warmUp() {
  if (!tauri || settings.provider !== 'gemini' || !settings.apiKey || performance.now() - lastRequest < 25000) return;
  requestJson('GET', GEMINI + 'models?pageSize=1', { 'x-goog-api-key': settings.apiKey }).catch(() => {});
}
viewer.addEventListener('pointermove', () => { if (pdfDoc) warmUp(); }, { passive: true });

// The string fields an unfinished JSON reply already has: {"translation": "…", "explanation": "half a sen…
function partialFields(text) {
  const out = {}, closed = new Set();
  for (const m of text.matchAll(/"(\w+)"\s*:\s*"((?:[^"\\]|\\.)*)("?)/g)) {
    const raw = m[2].replace(/\\(u[0-9a-fA-F]{0,3})?$/, ''); // an escape cut off at the end
    try { out[m[1]] = JSON.parse(`"${raw}"`); } catch { out[m[1]] = raw; }
    if (m[3]) closed.add(m[1]);
  }
  Object.defineProperty(out, '_closed', { value: closed }); // which fields are complete
  return out;
}

let lastModel = '', lastFailed = [], lastWhy = {}; // the model that gave the last answer, and any that failed first: shown under it

async function askAI(word, sentence, onPartial) {
  return askModel(buildPrompt(word, sentence), 800, onPartial);
}

// Sends a prompt that asks for JSON to the chosen provider and returns the parsed reply.
// onPartial (Gemini only) gets the reply so far while it streams in. Streaming uses the model that answered
// last; the first lookup, or one whose stream fails, goes the usual way, which also finds a working model.
async function askModel(prompt, maxTokens = 800, onPartial) {
  const model = settings.model || DEFAULT_MODELS[settings.provider];
  lastModel = model;
  lastFailed = []; lastWhy = {};
  let r, text;
  if (settings.provider === 'gemini') {
    text = await askGemini(prompt, onPartial);
  } else if (settings.provider === 'anthropic') {
    r = await postJson('https://api.anthropic.com/v1/messages',
      { 'x-api-key': settings.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      { model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] });
    if (!r.ok) throw new Error(quotaMessage(r.status, r.json) || r.json?.error?.message || r.status);
    text = (r.json.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  } else {
    const headers = settings.apiKey ? { authorization: 'Bearer ' + settings.apiKey } : {};
    r = await postJson(settings.baseUrl.replace(/\/+$/, '') + '/chat/completions', headers,
      { model, temperature: 0.2, messages: [{ role: 'user', content: prompt }] });
    if (!r.ok) throw new Error(quotaMessage(r.status, r.json) || r.json?.error?.message || r.status);
    text = r.json.choices?.[0]?.message?.content || '';
  }
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(t('badReply'));
  return JSON.parse(m[0]);
}

// ---------- Ask about a passage ----------
// Selecting more than a phrase offers a question about it. It costs more of the reader's own
// AI quota than a word does (the whole passage is sent), so the button says so.
const ASK_LIMIT = 4000; // characters of the passage sent with a question
let askPassage = '', askId = 0;

function buildAskPrompt(passage, question) {
  const lang = LANGS[settings.lang].english;
  return `You help someone understand a passage from the book they are reading.
Passage: \"\"\"${passage.slice(0, ASK_LIMIT)}\"\"\"
Language of the book: ${LANGS[bookLang]?.english || 'detect it from the passage'}
The reader asks: "${question}"
Answer in ${lang}, clearly and briefly (under 150 words unless they ask for more). Plain text, no markdown; separate paragraphs with a blank line.
Reply with JSON only, no markdown fences, in exactly this shape: {"answer": "..."}`;
}

const askForm = () => `
  <div class="ask-quick">${['askExplain', 'askSummary', 'askTranslate', 'askGrammar'].map(k => `<button class="chip" type="button" data-q="${k}">${t(k)}</button>`).join('')}</div>
  <form class="ask-form" id="askForm">
    <textarea id="askInput" rows="2" dir="auto" placeholder="${t('askPh')}"></textarea>
    <button class="btn primary ask-send" type="submit">
      <span class="ask-label">${icon('sparkle')}${t('askSend')}</span>
      <small class="ask-cost">${t('askCost')}</small>
    </button>
  </form>`;

// The Ask button: with text already selected it asks about it; otherwise the next selection
// (or a click on a sentence) does. Long selections open Ask on their own too.
let askMode = false, askHeld = '';
function setAskMode(on) {
  askMode = on;
  document.body.classList.toggle('ask-mode', on);
  if (on) showToast(t('askPick'), { label: t('cancel'), run: () => { setAskMode(false); $('#toast').hidden = true; } });
  else if ($('#toast').textContent.includes(t('askPick'))) $('#toast').hidden = true;
}
// Read the selection before the click on the button can clear it.
$('#askBtn').addEventListener('mousedown', () => { askHeld = window.getSelection().toString().replace(/\s+/g, ' ').trim(); });
$('#askBtn').onclick = () => {
  if (askHeld) { openAsk(askHeld); askHeld = ''; return; }
  setAskMode(!askMode);
};
document.addEventListener('keydown', e => { if (e.key === 'Escape' && askMode) setAskMode(false); });
document.addEventListener('click', e => { if (e.target.closest('[data-ask-sentence]') && lastLookup) openAsk(lastLookup.sentence); });

function openAsk(passage) {
  if (askMode) setAskMode(false);
  showTab('lookup');
  askPassage = passage;
  lastLookup = null;
  ++lookupId; // a word answer still on its way shouldn't replace this
  $('#lookup').innerHTML = `<article class="result ask">
    <header class="result-head"><h2 class="word">${t('askTitle')}</h2></header>
    <blockquote class="sentence passage" dir="auto">${esc(passage.length > 600 ? passage.slice(0, 600) + '…' : passage)}</blockquote>
    ${askForm()}
    <div id="askAnswers"></div>
  </article>`;
  wireAsk();
  $('#askInput').focus();
}

function wireAsk() {
  $('#askForm').onsubmit = e => { e.preventDefault(); ask($('#askInput').value.trim()); };
  $('#askInput').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#askForm').requestSubmit(); } });
  document.querySelectorAll('.ask-quick [data-q]').forEach(b => b.onclick = () => ask(t(b.dataset.q)));
}

async function ask(question) {
  if (!question) { $('#askInput').focus(); return; }
  if (!settings.apiKey && settings.provider !== 'openai') { openSetup(); return; }
  const id = ++askId, box = document.createElement('section');
  box.className = 'ask-turn';
  box.innerHTML = `<h3 class="label" dir="auto">${esc(question)}</h3><div class="skeleton"><span></span><span></span><span class="short"></span></div>`;
  $('#askAnswers').prepend(box);
  $('#askInput').value = '';
  try {
    const d = `dir="${LANGS[settings.lang].dir}"`;
    const body = document.createElement('div');
    box.querySelector('.skeleton').before(body);
    // The answer flows in paragraph by paragraph, word by word; the skeleton stays until it is complete.
    const flowAnswer = (answer, done) => {
      const parts = String(answer || '').split(/\n\s*\n/);
      parts.forEach((text, i) => {
        if (!text.trim()) return;
        let p = body.children[i];
        if (!p) { p = document.createElement('p'); p.className = 'explain glide'; p.setAttribute('dir', LANGS[settings.lang].dir); body.append(p); }
        flowText(p, text.trim(), done || i < parts.length - 1);
      });
    };
    const r = await askModel(buildAskPrompt(askPassage, question), 1500, text => {
      const p = partialFields(text);
      if (p.answer) flowAnswer(p.answer, p._closed.has('answer'));
    });
    countUse('asks');
    if (!box.isConnected) return;
    flowAnswer(r.answer, true);
    box.querySelector('.skeleton')?.remove();
  } catch (err) {
    box.querySelector('.skeleton').outerHTML = stateCard('alert', esc(err.message), '', 'error');
  }
}
