// Sharing the open book and My words with AI apps such as Claude Desktop.

// ---------- AI apps (MCP) ----------
// With "Connect to AI apps" on, Claude Desktop and similar apps can read the open page and My words
// through `siyaq --mcp` (src-tauri/src/mcp.rs), and add words. Nothing is shared while it is off.
let shareTimer = null;
function queueShare() {
  if (!tauri || !settings.mcp) return;
  clearTimeout(shareTimer);
  shareTimer = setTimeout(shareState, 800);
}

// A page's text as it reads: scanned pages from OCR, broken lines and hyphenated words joined.
async function readablePageText(doc, n) {
  const ocr = ocrCache.get(n);
  if (ocr) return ocr.map(line => line.map(w => w.text).join(' ')).join(' ');
  try {
    const items = (await (await doc.getPage(n)).getTextContent()).items;
    return itemsToText(items).replace(/-\n(?=\p{Ll})/gu, '').replace(/\s*\n\s*/g, ' ').replace(/ {2,}/g, ' ').trim();
  } catch { return ''; }
}

// The whole open book for AI apps, so they can read any chapter, search it, or summarise it.
let bookShare = { token: 0, timer: null };
function queueBookShare(delay = 1500) {
  if (!tauri || !settings.mcp) return;
  clearTimeout(bookShare.timer);
  bookShare.timer = setTimeout(shareBook, delay);
}

async function shareBook() {
  const doc = pdfDoc, token = ++bookShare.token;
  if (!doc) return;
  const text = [];
  for (let n = 1; n <= doc.numPages; n++) {
    text.push(await readablePageText(doc, n));
    if (n % 20 === 0) {
      await new Promise(res => setTimeout(res)); // stay responsive on long books
      if (token !== bookShare.token || pdfDoc !== doc) return;
    }
  }
  const book = { title: bookName.replace(/\.(pdf|epub)$/i, ''), format: bookType, language: LANGS[bookLang]?.english || null,
    pages: doc.numPages, contents: await bookContents(doc), text };
  if (token === bookShare.token && pdfDoc === doc) tauri.core.invoke('mcp_share_book', { book }).catch(() => {});
}

// The table of contents, flattened, with the page each entry starts on.
async function bookContents(doc) {
  const out = [];
  const walk = async (list, depth) => {
    for (const it of list) {
      out.push({ title: it.title, depth, page: await destPage(doc, it.dest) });
      if (it.items?.length && depth < 3) await walk(it.items, depth + 1);
    }
  };
  await walk((await doc.getOutline().catch(() => null)) || [], 0);
  return out;
}

async function destPage(doc, dest) {
  try {
    if (dest?.epub) {
      const section = [...viewer.children].find(c => c.dataset.path === dest.epub.split('#')[0]);
      return section ? +section.dataset.page : null;
    }
    const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
    if (!Array.isArray(explicit)) return null;
    return (typeof explicit[0] === 'object' ? await doc.getPageIndex(explicit[0]) : explicit[0]) + 1;
  } catch { return null; }
}

async function shareState() {
  let book = null;
  if (pdfDoc) {
    const page = currentPage(), text = [];
    for (let n = page; n <= Math.min(page + 2, pdfDoc.numPages); n++) text.push({ page: n, text: await readablePageText(pdfDoc, n) });
    book = { title: bookName.replace(/\.(pdf|epub)$/i, ''), format: bookType, page, pages: pdfDoc.numPages, language: LANGS[bookLang]?.english || null, text };
  }
  const words = vocab.map(v => ({ word: v.word, translation: v.translation, explanation: v.explanation, sentence: v.sentence,
    book: v.book, date: v.date, saved: Date.parse(v.date) || 0, box: v.box || 0, due: v.due || 0 }));
  tauri.core.invoke('mcp_share', { state: { lang: LANGS[settings.lang].english, book, words } }).catch(() => {});
}

function setSharing(on) {
  if (!tauri || on === !!settings.mcp) return;
  settings.mcp = on;
  if (on) { shareState(); queueBookShare(0); }
  else tauri.core.invoke('mcp_share', { state: null }).catch(() => {});
}

// Words an AI app saved while Siyaq was open (or since it was last open).
async function takeInbox() {
  if (!tauri || !settings.mcp || document.hidden) return;
  const added = await tauri.core.invoke('mcp_take_inbox').catch(() => []);
  if (!added.length) return;
  for (const w of added) {
    vocab = vocab.filter(v => !(v.word.toLowerCase() === w.word.toLowerCase() && v.sentence === w.sentence));
    vocab.unshift({ word: w.word, translation: w.translation, explanation: w.explanation, sentence: w.sentence, book: bookName, date: new Date().toISOString() });
  }
  store.set('vocab', vocab);
  updateVocabCount();
  refreshKnown();
  if (!$('#vocab').hidden && !reviewQueue) renderVocab();
  showToast(t('mcpAdded').replace('{n}', added.length));
}
setInterval(takeInbox, 4000);
document.addEventListener('visibilitychange', takeInbox);

function mcpMessage(text, error = false) {
  const el = $('#mcpMsg');
  el.textContent = text;
  el.classList.toggle('error', error);
  el.hidden = false;
}
$('#mcpClaude').onclick = async () => {
  try {
    await tauri.core.invoke('mcp_add_to_claude');
    form.mcp.checked = true;
    setSharing(true);
    store.set('settings', settings);
    mcpMessage(t('mcpDone'));
  } catch (err) {
    mcpMessage(String(err) === 'not-installed' ? t('mcpNotInstalled') : String(err), true);
  }
};
$('#mcpCopy').onclick = async () => {
  try {
    await navigator.clipboard.writeText(await tauri.core.invoke('mcp_config'));
    mcpMessage(t('mcpCopied'));
  } catch (err) { mcpMessage(String(err), true); }
};
