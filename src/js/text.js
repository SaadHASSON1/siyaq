// Reading the text: the book's language, picking words, reading order, sentences.

// ---------- Book language ----------
const STOPWORDS = {
  en: ['the', 'and', 'of', 'to', 'in', 'is', 'that', 'was', 'he', 'it', 'with', 'for', 'as', 'his', 'on', 'you', 'her', 'she', 'they', 'but', 'had', 'at', 'not'],
  tr: ['ve', 'bir', 'bu', 'da', 'de', 'için', 'ile', 'ne', 'çok', 'gibi', 'ama', 'daha', 'o', 'ben', 'sen', 'değil', 'olarak', 'kadar', 'şey', 'her'],
};

function detectLanguage(text) {
  text = text.normalize('NFKC'); // shaped Arabic forms count as Arabic
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
    const content = await (await doc.getPage(i)).getTextContent(TEXT_OPTIONS);
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
// Arabic-Indic digits (٠-٩, and the Persian ۰-۹) sit in the Arabic block but, like all numbers, read left to right.
const DIGITS = /[\u0660-\u0669\u06F0-\u06F9]/g;
const isRtl = t => new RegExp(`[${RTL}]`).test(t.replace(DIGITS, '')), isLtr = t => new RegExp(`[${LTR}]`).test(t.replace(DIGITS, '0'));
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

// Many fonts draw Arabic letters with glyphs they share with Persian and Urdu, and PDFs then record those letters'
// codes: Farsi yeh (ی) for yeh, two-eyed heh (ھ) or heh goal (ہ) for heh, keheh (ک) for kaf. They look the same
// but aren't the same words, for lookups or search. On a line with none of the letters only Persian uses
// (پ چ ژ گ), they become the Arabic letters: ی is ي inside a word and ى at its end.
function arabicLetters(text) {
  if (!/[\u06CC\u06BE\u06C1\u06A9\u06F0-\u06F9]/.test(text) || /[\u067E\u0686\u0698\u06AF]/.test(text)) return text;
  return text
    .replace(/\u06CC(?=\p{M}*[\u0600-\u06FF])/gu, '\u064A').replace(/\u06CC/g, '\u0649')
    .replace(/[\u06BE\u06C1]/g, '\u0647').replace(/\u06A9/g, '\u0643')
    .replace(/[\u06F0-\u06F9]/g, d => String.fromCharCode(d.charCodeAt(0) - 0x06F0 + 0x0660)); // ۳ → ٣
}

// One line's pieces, put together as it reads. `pieces` are { text, left, right } in page order. Some PDFs give a
// diacritic (fatha, shadda, tanwin...) its own piece, drawn over its letter: each goes back after the letter it
// sits on. Right-to-left lines are ordered by where pieces are on the page, not the order they were drawn in.
// Returns the line's text and where each piece starts in it.
const MARKS_ONLY = /^[\s\u0000]*\p{M}[\p{M}\s\u0000]*$/u;
function arrangeLine(pieces) {
  const clean = pieces.map(p => plain(oneVowelEach(p.text.replace(/\u0000/g, ''))));
  const isMark = clean.map(t => MARKS_ONLY.test(t));
  const rtl = clean.some(t => isRtl(t));
  let bases = pieces.map((_, i) => i).filter(i => !isMark[i] && clean[i] !== '');
  if (rtl) bases = bases.sort((a, b) => (pieces[a].left + pieces[a].right) - (pieces[b].left + pieces[b].right));
  const order = readingOrder(bases.map(i => clean[i])).map(k => bases[k]);
  // Each diacritic joins its letter. Programs place marks differently: Chrome draws a zero-width mark at the left
  // edge of its letter, Core Text (Pages, TextEdit) centres a mark with a width over it. In a piece of several
  // letters, a letter's place is estimated from the piece's width shared among its letters (not its marks); the
  // first letter of a right-to-left piece is on its right.
  const letterCount = t => [...t].filter(c => !/\p{M}/u.test(c)).length;
  const marksOf = new Map();
  pieces.forEach((p, i) => {
    if (!isMark[i]) return;
    const edge = p.right - p.left <= 1, x = edge ? p.left : (p.left + p.right) / 2;
    let best = -1, after = 0, gap = Infinity;
    for (const b of bases) {
      if (!isRtl(clean[b])) continue;
      const boxes = pieces[b].letters; // each letter's measured [left, right], when the page could tell us
      if (boxes?.length) {
        boxes.forEach(([l, r], k) => {
          const d = edge ? Math.abs(l - x) : Math.max(0, x - r, l - x);
          if (d < gap) { gap = d; best = b; after = k + 1; }
        });
        continue;
      }
      // otherwise estimated: the piece's width shared among its letters, the first on the right
      const n = letterCount(clean[b]) || 1, w = (pieces[b].right - pieces[b].left) / n, from = pieces[b].right - x;
      const j = Math.min(n, Math.max(1, edge ? Math.round(from / (w || 1)) : Math.floor(from / (w || 1)) + 1));
      const d = edge ? Math.abs(from - j * w) : Math.max(0, x - pieces[b].right, pieces[b].left - x);
      if (d < gap) { gap = d; best = b; after = j; }
    }
    if (best < 0) return;
    if (!marksOf.has(best)) marksOf.set(best, []);
    marksOf.get(best).push([after, clean[i].replace(/\s/g, ''), i]);
  });
  const at = new Array(pieces.length).fill(-1);
  let text = '';
  for (const b of order) {
    const chars = [...clean[b]], marks = (marksOf.get(b) || []).sort((x, y) => x[0] - y[0]);
    // where the j-th letter ends, its own marks included
    const endOf = j => { let seen = 0, k = 0; for (; k < chars.length; k++) { if (!/\p{M}/u.test(chars[k])) { if (seen === j) break; seen++; } } return k; };
    at[b] = text.length;
    let done = 0;
    for (const [after, mark, i] of marks) {
      const cut = Math.max(done, endOf(after));
      text += chars.slice(done, cut).join('');
      done = cut;
      at[i] = text.length;
      text += mark;
    }
    text += chars.slice(done).join('');
  }
  // Marks combine in a fixed order whatever order they were drawn in (shadda + fatha = fatha + shadda). And "لا" is
  // one shape, so its lam's vowel comes out after the alef ("لاَ"); a bare alef takes no short vowel, so it goes
  // back on the lam ("لَا"). Tanwin al-fath stays: it is written on the alef ("كتاباً").
  // A diacritic never starts a word: a space before one is a gap left by its placement, not a real space.
  text = text.replace(/\s+(?=\p{M})/gu, '');
  return { text: arabicLetters(oneVowelEach(text).normalize('NFC').replace(/ل(ا)([\u064C-\u0652]+)/g, 'ل$2$1')), at };
}

// A letter carries one short vowel at most (a shadda may join it). Core Text (Pages, TextEdit) sometimes records a
// mark after the next letter, so a letter comes out with two and the one before it with none: "تحَْ" for "تَحْ",
// "ظَلٌَام" for "ظَلَامٌ". A tanwin ends the word; otherwise the mark recorded first belongs to the bare letter before
// (or the last one to a bare letter after). Run before Unicode normalisation, which would sort the marks and lose
// that order. Correct text never has two, so it is left as it is.
const VOWEL = /[\u064B-\u0650\u0652]/, ARABIC_LETTER = /[\u0620-\u064A\u066E-\u06D3\uFB50-\uFDFF\uFE70-\uFEFF]/;
function oneVowelEach(text) {
  if (!/[\u064B-\u0652]\p{M}*[\u064B-\u0652]|[\uFB50-\uFDFF\uFE70-\uFEFF]\p{M}|[\u0648\u064A][\u064F\u0650]/u.test(text)) return text;
  return text.replace(/[\u0620-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]+/g, all => {
    const lead = all.match(/^\p{M}*/u)[0], word = all.slice(lead.length); // marks with no letter here stay as they are
    // One shape for two letters ("ﳉ" is lam and jeem, "ﲐ" fa and yeh) records both letters' marks after it, in
    // their order: each letter gets its own, the first letter first ("فِي", the yeh lengthening the kasra). The
    // letters are written as Unicode normalisation would (the same length, for click offsets).
    const letters = [...word.matchAll(/(\P{M})(\p{M}*)/gu)].flatMap(([, c, m]) => {
      const parts = [...c.normalize('NFKC')], marks = [...m];
      if (parts.length < 2 || parts.some(x => /\p{M}/u.test(x)) || !marks.some(x => VOWEL.test(x))) return [[c, marks]];
      const out = parts.map(x => [x, []]);
      let k = 0;
      for (const x of marks) { out[k][1].push(x); if (VOWEL.test(x) && k < out.length - 1) k++; }
      return out;
    });
    const bare = k => letters[k] && ARABIC_LETTER.test(letters[k][0]) && !letters[k][1].some(c => VOWEL.test(c));
    for (let k = 0; k < letters.length; k++) {
      const marks = letters[k][1], vowels = marks.filter(c => VOWEL.test(c));
      // A yeh after kasra or a waw after damma lengthens the vowel: one drawn on that letter, its consonant bare,
      // belongs to the consonant ("فيِ" is "فِي").
      if (vowels.length === 1 && marks.length === 1 && /^(\u064A\u0650|\u0648\u064F)$/.test(letters[k][0] + vowels[0])
        && bare(k - 1) && !/[\u0621-\u0627\u0648\u0649\u064A]/.test(letters[k - 1][0].normalize('NFKC'))) {
        letters[k - 1][1].push(marks.pop());
        continue;
      }
      if (vowels.length < 2) continue;
      const move = (c, to, front) => { marks.splice(marks.lastIndexOf(c), 1); front ? letters[to][1].unshift(c) : letters[to][1].push(c); };
      const tanwin = vowels.find(c => c === '\u064C' || c === '\u064D'), last = letters.length - 1;
      if (tanwin && k < last && bare(last)) move(tanwin, last);
      else if (bare(k - 1)) { marks.splice(marks.indexOf(vowels[0]), 1); letters[k - 1][1].push(vowels[0]); }
      else if (bare(k + 1)) move(vowels.at(-1), k + 1, true);
    }
    return lead + letters.map(([c, m]) => c + m.join('')).join('');
  });
}

// The on-screen [left, right] of each letter (not diacritic) of a piece, in its text's order.
function letterBoxes(el) {
  const out = [], range = document.createRange(), walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode, text = node.textContent;
    for (let i = 0; i < text.length; i++) {
      if (/\p{M}/u.test(text[i])) continue;
      range.setStart(node, i); range.setEnd(node, i + 1);
      const b = range.getBoundingClientRect();
      // one shape for several letters ("ﻼ" is lam and alef): its width shared among them, the first on the right
      const n = [...text[i].normalize('NFKC')].filter(c => !/\p{M}/u.test(c)).length || 1, w = (b.right - b.left) / n;
      for (let k = 0; k < n; k++) out.push([b.right - (k + 1) * w, b.right - k * w]);
    }
  }
  return out;
}

// A text layer as lines: each with its pieces in reading order, the line's text, and where each piece starts in it.
function textLines(layer) {
  const lines = [];
  let raw = [];
  const finish = () => {
    if (!raw.length) return;
    // Positions are only needed for right-to-left lines (reading those is when page order matters).
    const rtl = raw.some(el => isRtl(el.textContent));
    const hasMarks = rtl && raw.some(el => MARKS_ONLY.test(el.textContent));
    const pieces = raw.map(el => {
      if (!rtl) return { text: el.textContent, left: 0, right: 0 };
      const r = el.getBoundingClientRect(), piece = { text: el.textContent, left: r.left, right: r.right };
      // Where each letter really is, for placing separate diacritics (letters differ a lot in width).
      if (hasMarks && isRtl(el.textContent) && !MARKS_ONLY.test(el.textContent)) piece.letters = letterBoxes(el);
      return piece;
    });
    const { text, at } = arrangeLine(pieces);
    const starts = new Map(), spans = [];
    raw.forEach((el, i) => { if (at[i] >= 0) { starts.set(el, at[i]); spans.push(el); } });
    spans.sort((a, b) => starts.get(a) - starts.get(b));
    lines.push({ spans, starts, text });
    raw = [];
  };
  for (const el of layer.querySelectorAll('span:not(.markedContent), br')) {
    if (el.tagName === 'BR') finish();
    else raw.push(el);
  }
  finish();
  return lines;
}

// The same for PDF.js text items (for the text shared with AI apps), placed by their transforms.
function itemsToText(items) {
  const out = [];
  let line = [];
  const finish = () => { if (line.length) out.push(arrangeLine(line).text); line = []; };
  for (const it of items) {
    const x = it.transform?.[4] ?? 0;
    line.push({ text: it.str, left: x, right: x + (it.width || 0) });
    if (it.hasEOL) finish();
  }
  finish();
  return out.join('\n');
}

// Where a point in a piece falls in its line (in reading order): the line and the position.
function lineAt(span, offset) {
  const line = textLines(span.closest('.textLayer')).find(l => l.starts.has(span));
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
  const lines = textLines(span.closest('.textLayer'));
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
    const span = (node?.nodeType === 3 ? node.parentElement : node)?.closest(PIECE);
    if (span && askMode) openAsk(selected);
    return; // the selection bar offers meaning, ask, highlight and note
  }
  // A plain click on a link follows it; selecting the link's text still translates it (above).
  const pageDiv = e.target.closest('.page');
  const link = pageDiv && linkAt(pageDiv, e.clientX, e.clientY);
  if (link) { goToDest(link.dest); return; }
  const span = e.target.closest(PIECE);
  if (!span) return;
  const pos = caretAt(e.clientX, e.clientY);
  if (!pos || pos.node.nodeType !== 3 || !span.contains(pos.node)) return;
  const at = offsetIn(span, pos.node, pos.offset);
  const word = wordAt(span, at);
  if (!word || !/\p{L}/u.test(word)) return;
  const sentence = sentenceAround(span, at);
  if (askMode) openAsk(sentence); else lookup(word, sentence);
});
