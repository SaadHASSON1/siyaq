// Writing and drawing on PDF pages: a pen, text typed anywhere on a page, an eraser, and undo.
// Kept per book like highlights, in page units (the page at 100%), so they stay put at any zoom.

let inks = store.get('inks', {}); // bookKey → [{ id, page, kind: 'pen', color, width, pts: [[x, y]…] } | { id, page, kind: 'text', color, size, x, y, w, h, text }]
const bookInks = () => inks[bookKey] || [];
function saveInks(list) {
  inks[bookKey] = list;
  if (!list.length) delete inks[bookKey];
  store.set('inks', inks);
}
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const INK = { tool: 'pen', color: '#1f2937', width: 2, size: 16 };
Object.assign(INK, store.get('inkTool', {}));
const SIZES = { pen: [1.2, 2.5, 5], text: [12, 16, 24] };
let inkMode = false;
const undoStack = []; // what each step did: { add: item } or { remove: item }

// ---------- Drawing them ----------
const isRtlText = s => /[֐-ࣿיִ-﷿ﹰ-﻿]/.test(s) && !/^[^֐-ࣿיִ-﷿ﹰ-﻿]*[A-Za-z]/.test(s);
// Smooth strokes: a curve through the middle of each pair of points.
function strokePath(pts) {
  if (pts.length < 2) { const [x, y] = pts[0]; return `M${x} ${y}l0.01 0`; }
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [x, y] = pts[i], [nx, ny] = pts[i + 1];
    d += `Q${x} ${y} ${(x + nx) / 2} ${(y + ny) / 2}`;
  }
  const [lx, ly] = pts[pts.length - 1];
  return d + `L${lx} ${ly}`;
}
// A stroke drawn with a pen that feels pressure (the S Pen and the like) keeps it in each point, [x, y, pressure],
// and is drawn as a filled outline whose width follows it: thin where the pen was light, full where pressed.
const hasPressure = pts => pts.length > 0 && pts[0].length > 2;
const pressWidth = (w, p) => w * (0.3 + 1.1 * p);
function pressurePath(pts, w) {
  if (pts.length < 2) { const [x, y, p] = pts[0], r = pressWidth(w, p) / 2; return `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`; }
  const left = [], right = [], n = pts.length;
  for (let i = 0; i < n; i++) {
    const [x, y, p] = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1, r = pressWidth(w, p) / 2;
    left.push([x - dy / len * r, y + dx / len * r]);
    right.push([x + dy / len * r, y - dx / len * r]);
  }
  const f = v => +v.toFixed(2), side = list => list.slice(1).map((q, i) => { const o = list[i]; return `Q${f(o[0])} ${f(o[1])} ${f((o[0] + q[0]) / 2)} ${f((o[1] + q[1]) / 2)}`; }).join('');
  const rEnd = pressWidth(w, pts[n - 1][2]) / 2, rStart = pressWidth(w, pts[0][2]) / 2, back = right.reverse();
  return `M${f(left[0][0])} ${f(left[0][1])}${side(left)}L${f(left[n - 1][0])} ${f(left[n - 1][1])}` +
    `A${f(rEnd)} ${f(rEnd)} 0 0 1 ${f(back[0][0])} ${f(back[0][1])}${side(back)}L${f(back[n - 1][0])} ${f(back[n - 1][1])}` +
    `A${f(rStart)} ${f(rStart)} 0 0 1 ${f(left[0][0])} ${f(left[0][1])}Z`;
}
const inkPathTag = i => hasPressure(i.pts)
  ? `<path data-ink="${i.id}" d="${pressurePath(i.pts, i.width)}" style="fill:${i.color};stroke:none"/>`
  : `<path data-ink="${i.id}" d="${strokePath(i.pts)}" stroke="${i.color}" stroke-width="${i.width}"/>`;

function drawPageInk(div) {
  div.querySelector('.ink-layer')?.remove();
  if (bookType === 'epub' || !div.dataset.w) return;
  const n = +div.dataset.page, w = +div.dataset.w, h = +div.dataset.h, here = bookInks().filter(i => i.page === n);
  const layer = document.createElement('div');
  layer.className = 'ink-layer';
  layer.innerHTML = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${here.filter(i => i.kind === 'pen').map(inkPathTag).join('')}</svg>`;
  for (const i of here.filter(i => i.kind === 'text')) layer.append(textBox(i));
  div.appendChild(layer);
}
function textBox(i) {
  const box = document.createElement('div');
  box.className = 'ink-text';
  box.dataset.ink = i.id;
  box.dir = 'auto';
  box.textContent = i.text;
  Object.assign(box.style, { left: i.x * scale + 'px', top: i.y * scale + 'px', color: i.color, fontSize: i.size * scale + 'px' });
  return box;
}
const drawAllInk = () => viewer.querySelectorAll('.page[data-rendered]').forEach(drawPageInk);

// ---------- The tools ----------
function setInkMode(on) {
  if (on && (!pdfDoc || bookType === 'epub')) return;
  inkMode = on;
  document.body.classList.toggle('ink-mode', on);
  document.body.dataset.inkTool = INK.tool;
  $('#inkBar').hidden = !on;
  $('#drawBtn').classList.toggle('on', on);
  if (on) { if (askMode) setAskMode(false); window.getSelection().removeAllRanges(); syncInkBar(); placeInkBar(); }
  else finishText();
}
// Over the middle of the pages (not the side panel).
const placeInkBar = () => {
  // (and never past the window's edge: a tablet turned upright leaves the pages less room than the bar)
  const bar = $('#inkBar'), half = bar.offsetWidth / 2, mid = viewer.offsetLeft + viewer.clientWidth / 2, room = bar.offsetParent?.clientWidth || innerWidth;
  bar.style.left = Math.max(half + 8, Math.min(room - half - 8, mid)) + 'px';
};
new ResizeObserver(() => { if (inkMode) placeInkBar(); }).observe(viewer);
function syncInkBar() {
  const bar = $('#inkBar');
  bar.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === INK.tool));
  bar.querySelectorAll('[data-ink-color]').forEach(b => b.classList.toggle('on', b.dataset.inkColor === INK.color));
  const sizes = SIZES[INK.tool === 'text' ? 'text' : 'pen'], now = INK.tool === 'text' ? INK.size : INK.width;
  bar.querySelectorAll('[data-size]').forEach((b, k) => b.classList.toggle('on', sizes[k] === now));
  bar.querySelector('.ink-sizes').hidden = bar.querySelector('.ink-colors').hidden = INK.tool === 'eraser';
  $('#inkUndo').disabled = !undoStack.length;
  document.body.dataset.inkTool = INK.tool;
}
$('#drawBtn').onclick = () => setInkMode(!inkMode);
$('#inkDone').onclick = () => setInkMode(false);
$('#inkBar').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.tool) INK.tool = b.dataset.tool;
  if (b.dataset.inkColor) INK.color = b.dataset.inkColor;
  if (b.dataset.size) { const v = SIZES[INK.tool === 'text' ? 'text' : 'pen'][+b.dataset.size]; INK.tool === 'text' ? INK.size = v : INK.width = v; }
  store.set('inkTool', { color: INK.color, width: INK.width, size: INK.size });
  finishText();
  syncInkBar();
});
$('#inkUndo').onclick = () => undoInk();

function addInk(item) { saveInks([...bookInks(), item]); undoStack.push({ add: item }); afterInk(item.page); }
function removeInk(id) {
  const item = bookInks().find(i => i.id === id);
  if (!item) return;
  saveInks(bookInks().filter(i => i.id !== id));
  undoStack.push({ remove: item });
  afterInk(item.page);
}
function undoInk() {
  const step = undoStack.pop();
  if (!step) return;
  if (step.add) saveInks(bookInks().filter(i => i.id !== step.add.id));
  else saveInks([...bookInks(), step.remove]);
  afterInk((step.add || step.remove).page);
}
function afterInk(page) {
  const div = viewer.querySelector(`.page[data-page="${page}"]`);
  if (div) drawPageInk(div);
  syncInkBar();
}

// Where a pointer is on a page, in page units (and, for a pen, how hard it presses).
function pagePoint(div, e) {
  const r = div.getBoundingClientRect();
  const pt = [+((e.clientX - r.left) / r.width * div.dataset.w).toFixed(2), +((e.clientY - r.top) / r.height * div.dataset.h).toFixed(2)];
  if (e.pointerType === 'pen' && e.pressure > 0) pt.push(+e.pressure.toFixed(2));
  return pt;
}

// ---------- A pen (the S Pen on Galaxy tablets, and other styluses) ----------
// Once a pen has drawn, it is the pen that draws: fingers move the page (one) and zoom it (two), so a hand resting
// on the screen leaves no marks. Holding the pen's side button (or turning it to its eraser end) erases.
let penSeen = false;
const penErases = e => e.pointerType === 'pen' && ((e.buttons & 2) || (e.buttons & 32) || e.button === 2 || e.button === 5);
// The pen near the screen (the S Pen is felt before it touches): from then on the page doesn't move under it, so a
// line starts where the pen comes down, and the hand resting on the screen does nothing but move the page.
let penNear = false, penAway = 0;
function feelPen(e) {
  if (e.pointerType !== 'pen' || !pdfDoc || bookType === 'epub') return;
  if (!penNear) { penNear = true; document.body.classList.add('pen-near'); }
  clearTimeout(penAway);
  penAway = setTimeout(() => { penNear = false; document.body.classList.remove('pen-near'); }, 2500);
}
for (const type of ['pointerover', 'pointermove', 'pointerdown']) viewer.addEventListener(type, feelPen, true);
const handOnly = () => inkMode && penSeen || penNear; // fingers move the page, the pen draws
let fingerPan = null;
viewer.addEventListener('pointerdown', e => {
  if (!handOnly() || e.pointerType !== 'touch') return;
  fingerPan = { id: e.pointerId, x: e.clientX, y: e.clientY, left: viewer.scrollLeft, top: viewer.scrollTop };
}, true);
viewer.addEventListener('pointermove', e => {
  if (!fingerPan || e.pointerId !== fingerPan.id || pinch) return;
  viewer.scrollTop = fingerPan.top - (e.clientY - fingerPan.y);
  viewer.scrollLeft = fingerPan.left - (e.clientX - fingerPan.x);
});
const endPan = e => { if (fingerPan && e.pointerId === fingerPan.id) fingerPan = null; };
viewer.addEventListener('pointerup', endPan);
viewer.addEventListener('pointercancel', endPan);
// While the pen hovers over the page, a dot shows where it will draw, in the colour and size it will draw with.
const penDot = Object.assign(document.createElement('div'), { className: 'pen-dot', hidden: true });
document.body.append(penDot);
viewer.addEventListener('pointermove', e => {
  if (!inkMode || e.pointerType !== 'pen' || e.buttons || INK.tool === 'text') { penDot.hidden = true; return; }
  const size = INK.tool === 'eraser' || penErases(e) ? 14 : Math.max(4, INK.width * scale * 0.9);
  Object.assign(penDot.style, { left: e.clientX + 'px', top: e.clientY + 'px', width: size + 'px', height: size + 'px', background: INK.tool === 'eraser' ? 'transparent' : INK.color });
  penDot.classList.toggle('erasing', INK.tool === 'eraser');
  penDot.hidden = false;
});
viewer.addEventListener('pointerleave', () => { penDot.hidden = true; });

// (a pointer the browser no longer tracks can't be captured: drawing goes on without it)
const capture = (el, e) => { try { el.setPointerCapture?.(e.pointerId); } catch {} };
let stroke = null;
// Not in writing mode: the pen still writes. It comes down, and once it moves a little it is a line (writing mode
// opens, with the pen's tools); lifted without moving, it was a tap, and the word under it is looked up as usual.
let penWaiting = null;
viewer.addEventListener('pointerdown', e => {
  if (inkMode || e.pointerType !== 'pen' || e.button !== 0 || !pdfDoc || bookType === 'epub' || askMode) return;
  const div = e.target.closest('.page[data-rendered]');
  if (div) penWaiting = { e, div, x: e.clientX, y: e.clientY };
}, true);
viewer.addEventListener('pointermove', e => {
  if (!penWaiting || e.pointerType !== 'pen' || Math.hypot(e.clientX - penWaiting.x, e.clientY - penWaiting.y) < 6) return;
  const { e: down } = penWaiting;
  penWaiting = null;
  window.getSelection().removeAllRanges();
  if (INK.tool === 'text') INK.tool = 'pen';
  setInkMode(true);
  startInk(down);
}, true);
viewer.addEventListener('pointerup', () => { penWaiting = null; }, true);
viewer.addEventListener('pointerdown', e => { if (inkMode) startInk(e); });
function startInk(e) {
  if (!inkMode) return;
  if (e.pointerType === 'pen') penSeen = true;
  else if (penSeen && e.pointerType === 'touch') return; // a finger, once a pen is in use: moves the page instead
  const erasing = penErases(e);
  if (e.button !== 0 && !erasing) return;
  penDot.hidden = true;
  const div = e.target.closest('.page[data-rendered]');
  if (!div || e.target.closest('.ink-text[contenteditable="true"]')) return;
  e.preventDefault();
  if (INK.tool === 'eraser' || erasing) { eraseAt(div, e); stroke = { erase: true, div }; capture(div, e); return; }
  if (INK.tool === 'text') {
    const hit = e.target.closest('.ink-text');
    finishText();
    if (hit) editText(hit); else startText(div, pagePoint(div, e));
    return;
  }
  // the pen
  const layer = div.querySelector('.ink-layer') || (drawPageInk(div), div.querySelector('.ink-layer'));
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  layer.querySelector('svg').append(path);
  stroke = { div, path, pts: [pagePoint(div, e)] };
  if (hasPressure(stroke.pts)) path.style.cssText = `fill:${INK.color};stroke:none`;
  else { path.setAttribute('stroke', INK.color); path.setAttribute('stroke-width', INK.width); }
  drawStroke(stroke);
  capture(div, e);
}
viewer.addEventListener('pointermove', e => {
  if (!stroke) return;
  if (stroke.erase) { eraseAt(stroke.div, e); return; }
  // every point the pen passed since the last frame (a pen reports far more often than the screen draws)
  const all = e.getCoalescedEvents?.();
  for (const ev of all?.length ? all : [e]) {
    const p = pagePoint(stroke.div, ev), last = stroke.pts[stroke.pts.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.8) continue;
    if (p.length > 2 && last.length > 2) p[2] = +((last[2] + p[2]) / 2).toFixed(2); // pressure, a little smoothed
    stroke.pts.push(p);
  }
  drawStroke(stroke);
});
function drawStroke(s) { s.path.setAttribute('d', hasPressure(s.pts) ? pressurePath(s.pts, INK.width) : strokePath(s.pts)); }
const endStroke = () => {
  if (!stroke) return;
  const s = stroke;
  stroke = null;
  if (s.erase) return;
  addInk({ id: newId(), page: +s.div.dataset.page, kind: 'pen', color: INK.color, width: INK.width, pts: s.pts });
};
viewer.addEventListener('pointerup', endStroke);
viewer.addEventListener('pointercancel', endStroke);

// The eraser takes whatever it touches: a stroke within a few points of it, or a piece of text.
function eraseAt(div, e) {
  const text = document.elementsFromPoint(e.clientX, e.clientY).find(el => el.classList?.contains('ink-text'));
  if (text) { removeInk(text.dataset.ink); return; }
  const [x, y] = pagePoint(div, e), n = +div.dataset.page;
  const near = bookInks().find(i => i.page === n && i.kind === 'pen' && i.pts.some(([px, py]) => Math.hypot(px - x, py - y) < 6 + i.width));
  if (near) removeInk(near.id);
}

// Text: a box where you click, typed straight on the page; it keeps its place and size at any zoom.
let editing = null; // { box, item (when editing one that exists), div, at }
function startText(div, [x, y]) {
  const layer = div.querySelector('.ink-layer') || (drawPageInk(div), div.querySelector('.ink-layer'));
  const box = textBox({ id: '', x, y: y - INK.size * 0.7, color: INK.color, size: INK.size, text: '' });
  layer.append(box);
  editing = { box, div, item: null };
  openBox(box);
}
function editText(box) {
  const item = bookInks().find(i => i.id === box.dataset.ink);
  if (!item) return;
  editing = { box, div: box.closest('.page'), item };
  openBox(box);
}
function openBox(box) {
  box.contentEditable = 'true';
  box.spellcheck = false;
  box.focus();
  const r = document.createRange(); r.selectNodeContents(box); r.collapse(false);
  getSelection().removeAllRanges(); getSelection().addRange(r);
}
function finishText() {
  if (!editing) return;
  const { box, div, item } = editing;
  editing = null;
  box.contentEditable = 'false';
  const text = box.innerText.replace(/\n+$/, '').trim();
  if (item) {
    if (!text) { removeInk(item.id); return; }
    if (text === item.text) return;
    saveInks(bookInks().map(i => i.id === item.id ? { ...i, text, w: box.offsetWidth / scale, h: box.offsetHeight / scale } : i));
    undoStack.push({ remove: item }, { add: bookInks().find(i => i.id === item.id) });
    afterInk(item.page);
    return;
  }
  if (!text) { box.remove(); return; }
  addInk({ id: newId(), page: +div.dataset.page, kind: 'text', color: INK.color, size: INK.size,
    x: +(parseFloat(box.style.left) / scale).toFixed(2), y: +(parseFloat(box.style.top) / scale).toFixed(2),
    w: +(box.offsetWidth / scale).toFixed(2), h: +(box.offsetHeight / scale).toFixed(2), text });
}
document.addEventListener('focusout', e => { if (editing && e.target === editing.box) setTimeout(() => { if (editing && document.activeElement !== editing.box) finishText(); }); });

document.addEventListener('keydown', e => {
  if (!inkMode) return;
  if (editing) { if (e.key === 'Escape') { e.preventDefault(); finishText(); } return; } // typing in a box
  if (e.key === 'Escape') { e.preventDefault(); setInkMode(false); }
  else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undoInk(); }
  else if (!e.metaKey && !e.ctrlKey && !e.altKey) {
    const tool = { p: 'pen', t: 'text', e: 'eraser' }[e.key.toLowerCase()];
    if (tool) { INK.tool = tool; syncInkBar(); }
  }
});
