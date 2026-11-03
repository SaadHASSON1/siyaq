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
async function requestJson(method, url, headers, body) {
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

// ----- Gemini: when one model is busy or retired, move straight on to another -----
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/';
let geminiModels = null; // Flash models this key can use, newest first
let geminiWorking = store.get('geminiWorking', null); // the Flash-Lite model that answered last, tried first

async function listGeminiModels() {
  if (geminiModels) return geminiModels;
  const r = await requestJson('GET', GEMINI + 'models?pageSize=1000', { 'x-goog-api-key': settings.apiKey });
  const version = n => parseFloat(n.match(/gemini-([\d.]+)/)[1]);
  geminiModels = (r.json?.models || [])
    .filter(m => m.supportedGenerationMethods?.includes('generateContent') && /^models\/gemini-[\d.]+-flash(-lite)?$/.test(m.name))
    .map(m => m.name.slice(7))
    .sort((a, b) => b.endsWith('-lite') - a.endsWith('-lite') || version(b) - version(a));
  return geminiModels;
}

async function geminiCall(model, prompt, noThinking) {
  const generationConfig = { responseMimeType: 'application/json', temperature: 0.2 };
  // A word lookup needs no step-by-step reasoning, and skipping it saves seconds.
  if (noThinking) generationConfig.thinkingConfig = /gemini-2\./.test(model) ? { thinkingBudget: 0 } : { thinkingLevel: 'minimal' };
  return requestJson('POST', `${GEMINI}models/${encodeURIComponent(model)}:generateContent`,
    { 'x-goog-api-key': settings.apiKey }, { contents: [{ parts: [{ text: prompt }] }], generationConfig });
}

// ----- Streaming: the answer shows while it is still being written -----
// Reads Gemini's server-sent events and calls onText with all of the answer so far; returns the whole answer.
async function geminiStream(model, prompt, onText) {
  const url = `${GEMINI}models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
  const thinkingConfig = /gemini-2\./.test(model) ? { thinkingBudget: 0 } : { thinkingLevel: 'minimal' };
  const body = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.2, thinkingConfig } };
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

// The string fields an unfinished JSON reply already has: {"translation": "…", "explanation": "half a sen…
function partialFields(text) {
  const out = {};
  for (const m of text.matchAll(/"(\w+)"\s*:\s*"((?:[^"\\]|\\.)*)("?)/g)) {
    const raw = m[2].replace(/\\(u[0-9a-fA-F]{0,3})?$/, ''); // an escape cut off at the end
    try { out[m[1]] = JSON.parse(`"${raw}"`); } catch { out[m[1]] = raw; }
  }
  return out;
}

// People type names like "Gemini Flash Lite": turn that into an id, or match it to a model the key has.
async function resolveGeminiModel(name) {
  const id = name.trim().toLowerCase().replace(/^models\//, '').replace(/\s+/g, '-');
  if (/^gemini-\d[\w.-]*$/.test(id)) return id;
  const words = id.split('-').filter(w => w && w !== 'gemini');
  return (await listGeminiModels()).find(m => words.every(w => m.split('-').includes(w))) || null;
}

let lastModel = ''; // the model that gave the last answer, shown under it
async function askGemini(prompt) {
  const chosen = settings.model && await resolveGeminiModel(settings.model);
  const queue = [chosen, geminiWorking].filter(Boolean);
  const tried = new Set();
  let listed = false, lastError = t('busy');
  while (tried.size < 5) {
    const model = queue.find(m => !tried.has(m));
    if (!model) {
      if (listed) break;
      listed = true;
      queue.push(...await listGeminiModels());
      continue;
    }
    tried.add(model);
    let r = await geminiCall(model, prompt, true);
    if (r.status === 400 && /thinking/i.test(r.json?.error?.message || '')) r = await geminiCall(model, prompt, false);
    if (r.ok) {
      // Only remember Flash-Lite: a stand-in Flash model would burn its much smaller daily quota.
      if (model.endsWith('-lite') && geminiWorking !== model) store.set('geminiWorking', geminiWorking = model);
      lastModel = model;
      return (r.json.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('');
    }
    const msg = r.json?.error?.message || String(r.status);
    const suggested = msg.match(/\buse\s+models\/(gemini-[\w.-]*\w)/i)?.[1];
    if (suggested) queue.unshift(suggested);
    // A wrong key is worth stopping for; a model we can't use just means trying the next one.
    else if (!BUSY.includes(r.status) && r.status !== 404 && !/model/i.test(msg)) throw new Error(msg);
    lastError = quotaMessage(r.status, r.json) || (BUSY.includes(r.status) ? t('busy') : msg);
  }
  throw new Error(lastError);
}

async function askAI(word, sentence, onPartial) {
  return askModel(buildPrompt(word, sentence), 800, onPartial);
}

// Sends a prompt that asks for JSON to the chosen provider and returns the parsed reply.
// onPartial (Gemini only) gets the reply so far while it streams in. Streaming uses the model that answered
// last; the first lookup, or one whose stream fails, goes the usual way, which also finds a working model.
async function askModel(prompt, maxTokens = 800, onPartial) {
  const model = settings.model || DEFAULT_MODELS[settings.provider];
  lastModel = model;
  let r, text;
  if (settings.provider === 'gemini') {
    const streamModel = onPartial && ((settings.model && await resolveGeminiModel(settings.model)) || geminiWorking);
    if (streamModel) {
      try { text = await geminiStream(streamModel, prompt, onPartial); lastModel = streamModel; }
      catch { text = null; }
    }
    if (!text) text = await askGemini(prompt);
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
    const paragraphs = answer => String(answer || '').split(/\n\s*\n/).filter(p => p.trim()).map(p => `<p class="explain" ${d}>${esc(p.trim())}</p>`).join('');
    const body = document.createElement('div');
    box.querySelector('.skeleton').before(body);
    // The answer fills in as it is written; the skeleton stays until it is complete.
    const r = await askModel(buildAskPrompt(askPassage, question), 1500, text => {
      const p = partialFields(text);
      if (p.answer) body.innerHTML = paragraphs(p.answer);
    });
    countUse('asks');
    if (!box.isConnected) return;
    body.innerHTML = paragraphs(r.answer);
    box.querySelector('.skeleton')?.remove();
  } catch (err) {
    box.querySelector('.skeleton').outerHTML = stateCard('alert', esc(err.message), '', 'error');
  }
}
