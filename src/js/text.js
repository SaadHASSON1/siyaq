// Reading the text: the book's language, picking words, reading order, sentences.

// ---------- Book language ----------
const STOPWORDS = {
  en: ['the', 'and', 'of', 'to', 'in', 'is', 'that', 'was', 'he', 'it', 'with', 'for', 'as', 'his', 'on', 'you', 'her', 'she', 'they', 'but', 'had', 'at', 'not'],
  tr: ['ve', 'bir', 'bu', 'da', 'de', 'için', 'ile', 'ne', 'çok', 'gibi', 'ama', 'daha', 'o', 'ben', 'sen', 'değil', 'olarak', 'kadar', 'şey', 'her'],
};

function detectLanguage(text) {
  const arabic = (text.match(/[؀-ۿ]/g) || []).length;
  const latin = (text.match(/\p{Script=Latin}/gu) || []).length;
  if (arabic + latin < 200) return null; // scanned pages, or too little text to tell
  if (arabic > latin) return 'ar';
  const words = text.toLocaleLowerCase('tr').match(/\p{L}+/gu) || [];
  const share = list => words.filter(w => list.includes(w)).length / words.length;
  const en = share(STOPWORDS.en), tr = share(STOPWORDS.tr);
  const turkishLetters = (text.match(/[ığşİĞŞ]/g) || []).length / latin; // letters English and most others never use
  if (en >= 0.08 && en > tr) return 'en';
  if (tr >= 0.03 && turkishLetters > 0.003) return 'tr';
  return 'other';
}

// Reads the first pages' text; covers, title pages and contents rarely have enough on their own.
async function detectBookLanguage(doc) {
  let text = '';
  for (let i = 1; i <= Math.min(doc.numPages, 15) && text.length < 6000; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    text += content.items.map(it => it.str).join(' ') + ' ';
  }
  return detectLanguage(text);
}

const showBookLang = () => { $('#bookLang').textContent = bookLang ? t('langs')[bookLang] : t('auto'); };

// ---------- Word picking ----------
const isWordChar = c => /[\p{L}\p{M}\p{N}'’-]/u.test(c);

function caretAt(x, y) {
  if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    return p && { node: p.offsetNode, offset: p.offset };
  }
  if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y);
    return r && { node: r.startContainer, offset: r.startOffset };
  }
}

// Joins the page's text spans and cuts out the sentence around the clicked spot.
// ---------- Reading order ----------
// PDF text comes piece by piece in the order it sits on the page, left to right. Arabic (and Hebrew) lines read
// right to left, with English and numbers inside them still left to right: put each line's pieces in reading order.
const RTL = '\\u0590-\\u08FF\\uFB1D-\\uFDFF\\uFE70-\\uFEFF', LTR = 'A-Za-z0-9\\u00C0-\\u024F', LTR_LETTERS = 'A-Za-z\\u00C0-\\u024F';
const isRtl = t => new RegExp(`[${RTL}]`).test(t), isLtr = t => new RegExp(`[${LTR}]`).test(t);
const countOf = (texts, chars) => texts.reduce((n, t) => n + (t.match(new RegExp(`[${chars}]`, 'g')) || []).length, 0);
function readingOrder(texts) {
  const types = texts.map(t => isRtl(t) ? 'R' : isLtr(t) ? 'L' : 'N');
  const order = texts.map((_, i) => i);
  if (!types.includes('R')) return order;
  // Turn every run of `kind` pieces (and the spaces between them) around.
  const flipRuns = (list, kind) => {
    for (let i = 0; i < list.length; i++) {
      if (types[list[i]] !== kind) continue;
      let end = i, j = i;
      for (; j < list.length && types[list[j]] !== (kind === 'R' ? 'L' : 'R'); j++) if (types[list[j]] === kind) end = j;
      // English at the end of a right-to-left line keeps its trailing punctuation with it ("Hello world!";).
      if (kind === 'L' && j === list.length) end = list.length - 1;
      list.splice(i, end - i + 1, ...list.slice(i, end + 1).reverse());
      i = end;
    }
    return list;
  };
  // The line's direction comes from its letters; digits have none of their own ("سنة 2026" is right to left).
  return countOf(texts, RTL) >= countOf(texts, LTR_LETTERS) ? flipRuns(order.reverse(), 'L') : flipRuns(order, 'R');
}

// Some PDFs store Arabic letters as their shaped "presentation forms" (ﻟ for ل, ﻷ for لأ): turn them back into
// plain letters, so words can be read, looked up and searched. Positions inside a piece shift with it.
const plain = s => s.normalize('NFKC');
const plainAt = (s, offset) => plain(s.slice(0, offset)).length;

// A text layer as lines: each with its pieces in reading order, the line's text, and where each piece starts in it.
function textLines(layer) {
  const lines = [];
  let raw = [];
  const finish = () => {
    if (!raw.length) return;
    const spans = readingOrder(raw.map(el => el.textContent)).map(i => raw[i]);
    const starts = new Map();
    let text = '';
    for (const el of spans) { starts.set(el, text.length); text += plain(el.textContent); }
    lines.push({ spans, starts, text });
    raw = [];
  };
  for (const el of layer.children) {
    if (el.tagName === 'BR') finish();
    else if (el.tagName === 'SPAN') raw.push(el);
  }
  finish();
  return lines;
}

// The same for PDF.js text items (for the text shared with AI apps).
function itemsToText(items) {
  const out = [];
  let line = [];
  const finish = () => { if (line.length) out.push(readingOrder(line).map(i => line[i]).join('')); line = []; };
  for (const it of items) { line.push(plain(it.str)); if (it.hasEOL) finish(); }
  finish();
  return out.join('\n');
}

// Where a point in a piece falls in its line (in reading order): the line and the position.
function lineAt(span, offset) {
  const line = textLines(span.parentElement).find(l => l.starts.has(span));
  return line ? { line, at: line.starts.get(span) + plainAt(span.textContent, offset) } : null;
}

// The whole word around a point, read across pieces (some PDFs give every Arabic letter its own piece).
function wordAt(span, offset) {
  const hit = lineAt(span, offset);
  if (!hit) return '';
  const text = hit.line.text;
  let s = hit.at, e = hit.at;
  while (s > 0 && isWordChar(text[s - 1])) s--;
  while (e < text.length && isWordChar(text[e])) e++;
  return text.slice(s, e).replace(/^['’-]+|['’-]+$/g, '');
}

// Selected text in reading order. Only needed when it has right-to-left text; otherwise the browser's is right.
function selectedText(sel) {
  const plain = sel.toString().replace(/\s+/g, ' ').trim();
  if (!isRtl(plain) || !sel.rangeCount) return plain;
  const range = sel.getRangeAt(0), parts = [];
  for (const layer of viewer.querySelectorAll('.textLayer')) {
    if (!range.intersectsNode(layer)) continue;
    for (const line of textLines(layer)) {
      const hit = line.spans.filter(sp => range.intersectsNode(sp));
      if (hit.length) parts.push(hit.map(sp => plain(sp.textContent)).join(''));
    }
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim() || plain;
}

function sentenceAround(span, offset) {
  const lines = textLines(span.parentElement);
  // "Short" is relative to this page: in large print every line is short, and only headings are much shorter.
  const lengths = lines.map(l => l.text.length).filter(Boolean).sort((a, b) => a - b);
  const typical = lengths[Math.floor(lengths.length / 2)] || 60;
  const short = Math.min(45, typical * 0.6);
  let text = '', at = 0;
  lines.forEach((l, i) => {
    if (i) {
      const prev = lines[i - 1].text.trim();
      // "contin-" at a line end + "ue" on the next line → "continue"
      if (/\p{L}-$/u.test(text)) text = text.slice(0, -1);
      // A short line that doesn't carry on (a heading like "Down the Rabbit-Hole") ends a sentence.
      else if (prev.length < short && !/[,;:\-–—،]$/.test(prev)) text += '\n';
      else text += ' ';
    }
    if (l.starts.has(span)) at = text.length + l.starts.get(span) + plainAt(span.textContent, offset);
    text += l.text;
  });
  return cutSentence(text, at);
}

// The sentence around position `at`: back and forward to the nearest sentence end, at most 120 characters each way.
// Arabic text often runs on without full stops; a shorter limit keeps those lookups as quick as English ones,
// since the reply translates the whole sentence too.
function cutSentence(text, at) {
  let start = at, end = at;
  while (start > 0 && !/[.!?؟\n]/.test(text[start - 1]) && at - start < 120) start--;
  while (end < text.length && !/[.!?؟\n]/.test(text[end]) && end - at < 120) end++;
  // A very long sentence is cut at the limit: make that cut fall between words, not inside one.
  if (start > 0 && !/[.!?؟\n]/.test(text[start - 1])) { const sp = text.indexOf(' ', start); if (sp > 0 && sp < at) start = sp + 1; }
  if (end < text.length && !/[.!?؟\n]/.test(text[end])) { const sp = text.lastIndexOf(' ', end); if (sp > at) end = sp - 1; }
  return text.slice(start, end + 1).replace(/\s+/g, ' ').trim();
}

// Characters from the start of a text span up to a point inside it (spans can hold <mark> children).
function offsetIn(span, node, offset) {
  const r = document.createRange();
  r.setStart(span, 0);
  r.setEnd(node, offset);
  return r.toString().length;
}

let clickPage = null; // the page of the last word clicked, saved with it
viewer.addEventListener('click', e => {
  clickPage = +e.target.closest('.page')?.dataset.page || null;
  const sel = window.getSelection();
  const chapter = e.target.closest('.epub-chapter');
  const selected = chapter ? sel.toString().replace(/\s+/g, ' ').trim() : selectedText(sel);
  if (chapter) { clickEpub(e, sel, selected); return; }
  if (selected) {
    const node = sel.anchorNode;
    const span = (node?.nodeType === 3 ? node.parentElement : node)?.closest('.textLayer > span');
    if (span && askMode) openAsk(selected);
    return; // the selection bar offers meaning, ask, highlight and note
  }
  // A plain click on a link follows it; selecting the link's text still translates it (above).
  const pageDiv = e.target.closest('.page');
  const link = pageDiv && linkAt(pageDiv, e.clientX, e.clientY);
  if (link) { goToDest(link.dest); return; }
  const span = e.target.closest('.textLayer > span');
  if (!span) return;
  const pos = caretAt(e.clientX, e.clientY);
  if (!pos || pos.node.nodeType !== 3 || !span.contains(pos.node)) return;
  const at = offsetIn(span, pos.node, pos.offset);
  const word = wordAt(span, at);
  if (!word || !/\p{L}/u.test(word)) return;
  const sentence = sentenceAround(span, at);
  if (askMode) openAsk(sentence); else lookup(word, sentence);
});
