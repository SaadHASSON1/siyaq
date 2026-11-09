// Highlights, notes and the selection bar.

// ---------- Highlights and notes ----------
// Kept per book. On a PDF a highlight is a set of boxes in page fractions, so it survives zooming; on an EPUB,
// whose text reflows, it is a stretch of a chapter's text by character positions.
let highlights = store.get('highlights', {}); // bookKey → [{ id, color, note, text, date, parts: [{ page, rects }] | chapter, start, end }]
const bookHighlights = () => highlights[bookKey] || [];
function saveHighlights(list) {
  highlights[bookKey] = list;
  if (!list.length) delete highlights[bookKey];
  store.set('highlights', highlights);
  $('#notesCount').textContent = list.length || '';
  if (!$('#notes').hidden) renderNotes();
}

// The selection bar: meaning, ask, highlight, note.
let barSelection = null; // { text, range } of the selection the bar is for
function selectionInBook() {
  const sel = window.getSelection();
  if (!sel.rangeCount || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0), node = range.commonAncestorContainer;
  const el = node.nodeType === 3 ? node.parentElement : node;
  if (!el?.closest('#viewer') || !el.closest('.page, .textLayer, .epub-chapter') && !el.matches('#viewer')) return null;
  const text = el.closest('.epub-chapter') ? sel.toString().replace(/\s+/g, ' ').trim() : selectedText(sel);
  return text ? { text, range: range.cloneRange() } : null;
}
function showSelBar() {
  const s = selectionInBook(), bar = $('#selBar');
  if (!s || askMode) { bar.hidden = true; barSelection = null; return; }
  barSelection = s;
  const r = s.range.getBoundingClientRect();
  bar.hidden = false;
  const w = bar.offsetWidth, h = bar.offsetHeight;
  bar.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
  // On a touch screen the system's own menu (Copy, Share…) sits above the selection: this bar goes below its handles.
  const below = r.bottom + (touchScreen ? 40 : 10);
  bar.style.top = (touchScreen ? (below + h < innerHeight - 8 ? below : r.top - h - 70) : r.top - h - 10 > 60 ? r.top - h - 10 : r.bottom + 10) + 'px';
}
viewer.addEventListener('mouseup', () => setTimeout(showSelBar, 0));
// A finger selects with a long press and the handles, and there is no mouseup: the bar comes once it stops changing.
const touchScreen = matchMedia('(pointer: coarse)').matches;
let selSettle = 0;
if (touchScreen) document.addEventListener('selectionchange', () => {
  clearTimeout(selSettle);
  selSettle = setTimeout(() => { if (selectionInBook()) showSelBar(); else $('#selBar').hidden = true; }, 350);
});
viewer.addEventListener('scroll', () => { $('#selBar').hidden = true; }, { passive: true });
document.addEventListener('mousedown', e => { if (!e.target.closest('#selBar')) $('#selBar').hidden = true; });

$('#selBar').addEventListener('mousedown', e => e.preventDefault()); // keep the selection while clicking the bar
$('#selBar').onclick = e => {
  const b = e.target.closest('[data-act]');
  if (!b || !barSelection) return;
  const { text, range } = barSelection;
  $('#selBar').hidden = true;
  if (b.dataset.act === 'meaning') lookup(text, sentenceForRange(range) || text);
  else if (b.dataset.act === 'ask') openAsk(text);
  else {
    const h = addHighlight(range, text, b.dataset.color || 'yellow');
    if (h && b.dataset.act === 'note') openHighlight(h.id);
  }
  window.getSelection().removeAllRanges();
};

// The sentence around the start of a selection, as for a clicked word.
function sentenceForRange(range) {
  const node = range.startContainer, el = node.nodeType === 3 ? node.parentElement : node;
  const span = el?.closest(PIECE);
  if (span) return sentenceAround(span, node.nodeType === 3 ? offsetIn(span, node, range.startOffset) : 0);
  const block = el?.closest(EPUB_BLOCKS);
  return block ? cutSentence(block.textContent, node.nodeType === 3 ? offsetIn(block, node, range.startOffset) : 0) : '';
}

function addHighlight(range, text, color) {
  const h = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), color, note: '', text, date: new Date().toISOString() };
  const startEl = range.startContainer.nodeType === 3 ? range.startContainer.parentElement : range.startContainer;
  const chapter = startEl.closest('.epub-chapter');
  if (chapter) {
    h.chapter = +chapter.dataset.page;
    h.start = offsetIn(chapter, range.startContainer, range.startOffset);
    h.end = chapter.contains(range.endContainer) ? offsetIn(chapter, range.endContainer, range.endOffset) : chapter.textContent.length;
  } else {
    const byPage = new Map();
    for (const rect of range.getClientRects()) {
      if (rect.width < 1 || rect.height < 1) continue;
      const page = document.elementsFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2).map(el => el.closest('.page')).find(Boolean);
      if (!page) continue;
      const pr = page.getBoundingClientRect(), n = +page.dataset.page;
      if (!byPage.has(n)) byPage.set(n, []);
      byPage.get(n).push([(rect.left - pr.left) / pr.width, (rect.top - pr.top) / pr.height, rect.width / pr.width, rect.height / pr.height].map(v => +v.toFixed(5)));
    }
    h.parts = [...byPage].map(([page, rects]) => ({ page, rects: mergeRects(rects) }));
    if (!h.parts.length) return null;
  }
  saveHighlights([...bookHighlights(), h]);
  drawHighlights();
  return h;
}

// Text layers give a box per piece of text; join those on the same line into one bar, across the spaces between
// words (justified lines have wide ones), but not across a gap as wide as a column's.
function mergeRects(rects) {
  rects.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const out = [];
  for (const r of rects) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[1] - r[1]) < last[3] * 0.5 && r[0] <= last[0] + last[2] + 0.06) {
      const right = Math.max(last[0] + last[2], r[0] + r[2]);
      last[0] = Math.min(last[0], r[0]); last[2] = right - last[0]; last[3] = Math.max(last[3], r[3]);
    } else out.push([...r]);
  }
  return out;
}

// ---------- The selection on PDF pages ----------
// The browser paints a PDF selection piece by piece, with gaps between words and ragged heights. It is drawn
// here instead, as the pages' readers do: one even bar per line, from where it starts to where it ends.
let selFrame = 0;
document.addEventListener('selectionchange', () => { if (!selFrame) selFrame = requestAnimationFrame(() => { selFrame = 0; drawSelection(); }); });
function drawSelection() {
  viewer.querySelectorAll('.sel-layer').forEach(l => l.remove());
  const sel = getSelection();
  if (!sel.rangeCount || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  for (const layer of viewer.querySelectorAll('.page .textLayer')) {
    if (!range.intersectsNode(layer)) continue;
    const page = layer.closest('.page'), pr = page.getBoundingClientRect(), boxes = [];
    // The selected part of each piece of text (not whole elements, whose boxes can be the whole page).
    const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.textContent.trim() || !range.intersectsNode(node)) continue;
      const part = document.createRange();
      part.selectNodeContents(node);
      if (node === range.startContainer) part.setStart(node, range.startOffset);
      if (node === range.endContainer) part.setEnd(node, range.endOffset);
      for (const r of part.getClientRects()) if (r.width >= 1 && r.height >= 1) boxes.push([r.left - pr.left, r.top - pr.top, r.width, r.height]);
    }
    const lines = selectionLines(boxes);
    if (!lines.length) continue;
    const div = document.createElement('div');
    div.className = 'sel-layer';
    div.innerHTML = lines.map(([x, y, w, h]) => `<div style="left:${x}px;top:${y}px;width:${w}px;height:${h}px"></div>`).join('');
    page.append(div);
  }
}
// Boxes on the same line (their middles close) become one bar, unless a gap wider than a few letters splits them
// (two columns). Each bar is as tall as the line's tallest box.
function selectionLines(boxes) {
  boxes.sort((a, b) => (a[1] + a[3] / 2) - (b[1] + b[3] / 2) || a[0] - b[0]);
  const lines = [];
  for (const b of boxes) {
    const mid = b[1] + b[3] / 2;
    const line = lines.find(l => Math.abs(l.mid - mid) < Math.min(l.h, b[3]) * 0.5);
    if (line) { line.boxes.push(b); line.h = Math.max(line.h, b[3]); } else lines.push({ mid, h: b[3], boxes: [b] });
  }
  // Lines set close together have boxes that reach into each other: they meet halfway instead of overlapping.
  lines.sort((a, b) => a.mid - b.mid);
  for (const l of lines) { l.top = Math.min(...l.boxes.map(b => b[1])); l.bottom = Math.max(...l.boxes.map(b => b[1] + b[3])); }
  for (let i = 1; i < lines.length; i++) {
    const up = lines[i - 1], down = lines[i];
    if (up.bottom > down.top) up.bottom = down.top = (Math.max(up.mid, down.top) + Math.min(down.mid, up.bottom)) / 2;
  }
  return lines.flatMap(l => {
    const bars = [];
    for (const b of l.boxes.sort((a, c) => a[0] - c[0])) {
      const last = bars[bars.length - 1];
      if (last && b[0] - (last[0] + last[2]) < l.h * 2.5) last[2] = Math.max(last[2], b[0] + b[2] - last[0]);
      else bars.push([b[0], 0, b[2], 0]);
    }
    return bars.map(([x, , w]) => [x, l.top, w, l.bottom - l.top]);
  });
}

const pin = h => `<button class="hl-pin c-${h.color}" data-hl="${h.id}" title="${esc(h.note || t('addNote'))}">${h.note ? icon('note') : ''}</button>`;

// Draws the open book's highlights: on PDF pages that are drawn, and in EPUB chapters.
function drawHighlights() {
  if (!pdfDoc) return;
  const list = bookHighlights();
  if (bookType === 'epub') {
    viewer.querySelectorAll('.epub-chapter mark.hl').forEach(m => m.replaceWith(...m.childNodes));
    viewer.querySelectorAll('.epub-chapter .hl-pin').forEach(p => p.remove());
    viewer.querySelectorAll('.epub-chapter').forEach(ch => ch.normalize());
    for (const h of list) markEpubHighlight(h);
    return;
  }
  viewer.querySelectorAll('.page[data-rendered]').forEach(div => drawPageHighlights(div, list));
}

function drawPageHighlights(div, list = bookHighlights()) {
  div.querySelector('.hl-layer')?.remove();
  const n = +div.dataset.page, here = list.flatMap(h => (h.parts || []).filter(p => p.page === n).map(p => [h, p]));
  if (!here.length) return;
  const layer = document.createElement('div');
  layer.className = 'hl-layer';
  const pct = v => (v * 100).toFixed(3) + '%';
  layer.innerHTML = here.map(([h, p]) => p.rects.map(([x, y, w, ht]) => `<div class="hl-box hl-${h.color}" style="left:${pct(x)};top:${pct(y)};width:${pct(w)};height:${pct(ht)}"></div>`).join('')
    + (h.parts[0] === p ? (() => { const [x, y, w] = p.rects[p.rects.length - 1]; return pin(h).replace('<button', `<button style="left:${pct(Math.min(x + w, 0.985))};top:${pct(y)}"`); })() : '')).join('');
  div.appendChild(layer);
}

// Wraps a chapter's text from `start` to `end` in marks (one per text node it crosses), with a pin at the end.
function markEpubHighlight(h) {
  const chapter = viewer.querySelector(`.epub-chapter[data-page="${h.chapter}"]`);
  if (!chapter) return;
  const walker = document.createTreeWalker(chapter, NodeFilter.SHOW_TEXT), nodes = [];
  let pos = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode, len = node.textContent.length;
    const a = Math.max(h.start, pos), b = Math.min(h.end, pos + len);
    if (a < b) nodes.push([node, a - pos, b - pos]);
    pos += len;
  }
  let last = null;
  for (const [node, a, b] of nodes) {
    const range = document.createRange();
    range.setStart(node, a); range.setEnd(node, b);
    const mark = document.createElement('mark');
    mark.className = `hl hl-${h.color}`;
    range.surroundContents(mark);
    last = mark;
  }
  last?.insertAdjacentHTML('afterend', pin(h));
}

// The editor for one highlight: colour, note, delete.
let openHl = null;
function openHighlight(id, anchor) {
  const h = bookHighlights().find(x => x.id === id);
  if (!h) return;
  openHl = id;
  const pop = $('#hlPop');
  $('#hlQuote').textContent = h.text;
  $('#hlNote').value = h.note || '';
  pop.querySelectorAll('[data-color]').forEach(d => d.classList.toggle('on', d.dataset.color === h.color));
  pop.hidden = false;
  const r = (anchor || viewer.querySelector(`[data-hl="${id}"]`) || viewer).getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(innerWidth - pop.offsetWidth - 8, r.left - pop.offsetWidth / 2)) + 'px';
  pop.style.top = Math.max(8, Math.min(innerHeight - pop.offsetHeight - 8, r.bottom + 8)) + 'px';
  $('#hlNote').focus();
}
function updateHighlight(id, change) {
  saveHighlights(bookHighlights().map(h => h.id === id ? { ...h, ...change } : h));
  drawHighlights();
}
$('#hlPop').onclick = e => {
  const c = e.target.closest('[data-color]');
  if (c && openHl) { updateHighlight(openHl, { color: c.dataset.color }); $('#hlPop').querySelectorAll('[data-color]').forEach(d => d.classList.toggle('on', d === c)); }
};
const closeHighlight = () => {
  if (openHl) updateHighlight(openHl, { note: $('#hlNote').value.trim() });
  openHl = null;
  $('#hlPop').hidden = true;
};
$('#hlDone').onclick = closeHighlight;
$('#hlDelete').onclick = () => { saveHighlights(bookHighlights().filter(h => h.id !== openHl)); openHl = null; $('#hlPop').hidden = true; drawHighlights(); };
document.addEventListener('mousedown', e => { if (!$('#hlPop').hidden && !e.target.closest('#hlPop, [data-hl]')) closeHighlight(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#hlPop').hidden) closeHighlight(); });
document.addEventListener('click', e => {
  const p = e.target.closest('[data-hl]');
  if (p) { e.stopPropagation(); openHighlight(p.dataset.hl, p); }
}, true);

// The Notes tab: this book's highlights and notes in page order.
function renderNotes() {
  const pane = $('#notes'), list = bookHighlights();
  $('#notesCount').textContent = list.length || '';
  if (!pdfDoc) { pane.innerHTML = stateCard('note', t('notesNoBook')); return; }
  if (!list.length) { pane.innerHTML = stateCard('note', t('notesEmpty')); return; }
  const where = h => h.parts ? h.parts[0].page : h.chapter;
  const sorted = [...list].sort((a, b) => where(a) - where(b) || (a.start || 0) - (b.start || 0));
  pane.innerHTML = `<div class="vocab-head"><span>${t('notesCount')(list.length)}</span></div>
    <ul class="note-list">${sorted.map(h => `<li class="note-item" data-goto="${h.id}">
      <div class="q c-${h.color}" dir="auto">${esc(h.text)}</div>
      ${h.note ? `<div class="n" dir="auto">${esc(h.note)}</div>` : ''}
      <div class="m">${bookType === 'epub' ? t('chapterN')(h.chapter) : t('pageN')(where(h))}</div></li>`).join('')}</ul>`;
  pane.onclick = e => {
    const item = e.target.closest('[data-goto]');
    if (!item) return;
    const h = list.find(x => x.id === item.dataset.goto);
    backTo = viewer.scrollTop; $('#backBtn').hidden = false;
    if (h.parts) goToPage(h.parts[0].page);
    else viewer.querySelector(`.epub-chapter[data-page="${h.chapter}"] [data-hl="${h.id}"]`)?.scrollIntoView({ block: 'center' });
    setTimeout(() => openHighlight(h.id), 700);
  };
}
