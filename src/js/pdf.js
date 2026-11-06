// Opening and drawing PDF books: pages, dark mode, zoom, files.

// ---------- PDF ----------
const viewer = $('#viewer');
const observer = new IntersectionObserver(entries => {
  for (const e of entries) if (e.isIntersecting) renderPage(e.target);
}, { root: viewer, rootMargin: '600px 0px' });

const isZip = data => data[0] === 0x50 && data[1] === 0x4b; // EPUB files are zip archives

async function openBook(data, name) {
  try {
    const opened = await (isZip(data) ? openEpub(data, name) : openPdf(data, name));
    store.set('demoDone', true);
    return opened;
  } catch (err) {
    console.error(err);
    showToast(t('openFailed') + (err?.message || err), { label: t('fbBug'), run: () => reportProblem(`${t('openFailed')}${err?.message || err}`) });
  }
}

function canvasIsBlank(canvas) {
  const probe = document.createElement('canvas');
  probe.width = probe.height = 48;
  const ctx = probe.getContext('2d');
  ctx.drawImage(canvas, 0, 0, 48, 48);
  const px = ctx.getImageData(0, 0, 48, 48).data;
  for (let i = 0; i < px.length; i += 4) if (px[i] < 235 || px[i + 1] < 235 || px[i + 2] < 235) return false;
  return true;
}

function showPageError(div, err) {
  console.error(err);
  const box = document.createElement('div');
  box.className = 'page-error';
  box.innerHTML = `${icon('alert')}<p>${t('pageError')}</p><code dir="ltr">${esc(String(err?.message || err))}</code><button class="btn small">${icon('alert')}${t('fbBug')}</button>`;
  box.querySelector('button').onclick = () => reportProblem(`${t('pageError')}\n${err?.message || err}`);
  div.appendChild(box);
}

async function openPdf(data, name) {
  const lib = await pdfjsReady;
  const doc = await lib.getDocument({ data, cMapUrl: vendorUrl('cmaps/'), standardFontDataUrl: vendorUrl('standard_fonts/'),
    iccUrl: vendorUrl('iccs/'), wasmUrl: vendorUrl('wasm/') }).promise;
  pdfDoc = doc;
  bookType = 'pdf';
  viewer.style.removeProperty('--epub-zoom');
  bookName = name;
  $('#bookTitle').textContent = name.replace(/\.pdf$/i, '');
  $('#bookTitle').title = name;
  viewer.replaceChildren();
  const base = (await doc.getPage(1)).getViewport({ scale: 1 });
  pageSize = { w: base.width, h: base.height };
  fitScale = fitWidthScale();
  zoom = 1;
  scale = fitScale;
  for (let i = 1; i <= doc.numPages; i++) {
    const div = document.createElement('div');
    div.className = 'page';
    div.dataset.page = i;
    div.style.width = pageSize.w * scale + 'px';
    div.style.height = pageSize.h * scale + 'px';
    viewer.appendChild(div);
    observer.observe(div);
  }
  await finishOpening(doc, name);
}

// Everything that's the same for PDFs and EPUBs once the pages are in place.
async function finishOpening(doc, name) {
  viewer.scrollTop = 0;
  bookKey = name + '|' + doc.numPages;
  rememberBook(doc);
  ocrCache.clear();
  pageTexts.clear();
  closeSearch();
  easeIn(viewer);
  loadToc(doc);
  queueBookShare();
  $('#notesCount').textContent = bookHighlights().length || '';
  if (bookType === 'epub') setTimeout(() => { drawHighlights(); markDemoWords(); });
  restorePosition();
  backTo = null;
  $('#backBtn').hidden = true;
  $('#tools').hidden = false;
  // Writing, drawing and Save as are for PDF pages (an EPUB's text reflows).
  $('#drawBtn').hidden = $('#exportBtn').hidden = bookType === 'epub';
  undoStack.length = 0;
  $('#pageTotal').textContent = doc.numPages;
  updatePageLabel();
  updateZoomLabel();
  bookLang = null;
  showBookLang();
  const lang = await detectBookLanguage(doc);
  if (pdfDoc === doc) { bookLang = lang; showBookLang(); }
}

const fitWidthScale = () => Math.max(Math.min((viewer.clientWidth - 48) / pageSize.w, 1.8), 0.4);

async function renderPage(div) {
  if (div.dataset.rendered) return;
  div.dataset.rendered = '1';
  const s = scale, doc = pdfDoc;
  const page = await doc.getPage(+div.dataset.page);
  if (s !== scale || doc !== pdfDoc) return; // zoomed or switched book meanwhile
  const vp = page.getViewport({ scale: s });
  const dpr = window.devicePixelRatio || 1;
  div.dataset.w = vp.width / s;
  div.dataset.h = vp.height / s;
  div.style.width = vp.width + 'px';
  div.style.height = vp.height + 'px';

  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(vp.width * dpr);
  canvas.height = Math.floor(vp.height * dpr);
  canvas.style.width = vp.width + 'px';
  canvas.style.height = vp.height + 'px';
  // After a zoom the old picture stays on show, stretched, while this one is drawn out of sight.
  const stale = div.querySelector('canvas.stale');
  if (stale) canvas.style.visibility = 'hidden';
  div.appendChild(canvas);
  if (!stale) div.classList.add('loading'); // heavy pages (scans) can take a while on older computers
  try {
    await page.render({ canvas, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null }).promise;
  } catch (err) {
    // Say so on the page instead of leaving it blank, with the reason, so it can be reported.
    div.classList.remove('loading');
    stale?.remove();
    showPageError(div, err);
    return;
  }
  div.classList.remove('loading');
  if (s !== scale || !canvas.isConnected) return;
  if (isDark()) await darkenPage(canvas, page, vp, dpr);
  if (s !== scale || !canvas.isConnected) return;
  canvas.style.visibility = '';
  stale?.remove();

  const layer = document.createElement('div');
  layer.className = 'textLayer';
  layer.style.setProperty('--scale-factor', s);
  layer.style.setProperty('--total-scale-factor', s);
  div.appendChild(layer);
  const textContent = await page.getTextContent(TEXT_OPTIONS);
  await new pdfjsLib.TextLayer({ textContentSource: textContent, container: layer, viewport: vp }).render();
  layer.dataset.ready = '1'; // all its text is in place (PDF.js adds it in batches)
  if (s !== scale || !layer.isConnected) return;
  highlightSearch(div);
  drawPageHighlights(div);
  drawPageInk(div);
  // Scanned pages are pictures of text: almost no text, and an image covering most of the page.
  const chars = textContent.items.reduce((n, it) => n + it.str.replace(/\s/g, '').length, 0);
  // A page with plenty of text that drew nothing at all means the drawing failed quietly.
  if (chars > 80 && !isDark() && canvasIsBlank(canvas)) showPageError(div, new Error(`blank page with ${chars} characters of text · ${navigator.userAgent}`));
  if (chars < 20 && (await imageCoverage(page)) > 0.5) queueOcr(div, canvas, layer);

  // Links inside the book (table of contents, footnotes), in page pixels.
  div._links = (await page.getAnnotations())
    .filter(a => a.subtype === 'Link' && a.dest)
    .map(a => {
      const [x1, y1, x2, y2] = vp.convertToViewportRectangle(a.rect);
      return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1), dest: a.dest };
    });
}

function linkAt(pageDiv, clientX, clientY) {
  const r = pageDiv.getBoundingClientRect(), x = clientX - r.left, y = clientY - r.top;
  return (pageDiv._links || []).find(l => x >= l.x && x <= l.x + l.w && y >= l.y && y <= l.y + l.h);
}

let backTo = null; // where to return after following a link
async function goToDest(dest, remember = true) {
  if (dest?.epub) { epubGoTo(dest.epub, remember); return; }
  const explicit = typeof dest === 'string' ? await pdfDoc.getDestination(dest) : dest;
  if (!Array.isArray(explicit)) return;
  const index = typeof explicit[0] === 'object' ? await pdfDoc.getPageIndex(explicit[0]) : explicit[0];
  const div = viewer.querySelector(`.page[data-page="${index + 1}"]`);
  if (!div) return;
  if (remember) {
    backTo = viewer.scrollTop;
    $('#backBtn').hidden = false;
  }
  const top = explicit[1]?.name === 'XYZ' ? explicit[3] : null; // PDF units, measured from the page bottom
  const h = +div.dataset.h || pageSize.h;
  viewer.scrollTop = div.offsetTop + (top != null ? Math.max(0, (h - top) * scale - 16) : -24);
}

// ---------- Dark pages ----------
// Dark mode inverts the page so text is light on dark, then paints the pictures back in their real colours.
// After a switch between light and dark: pages already drawn get an instant stand-in (inverted with CSS), then
// are drawn again in the new colours behind it, each swapped in when ready, so a page is never blank.
// Pages further away are simply drawn again when they come into view.
async function recolorPages() {
  if (!pdfDoc || bookType === 'epub') return;
  const doc = pdfDoc, s = scale, dpr = window.devicePixelRatio || 1;
  const drawn = [...viewer.querySelectorAll('.page[data-rendered]')];
  drawn.forEach(div => div.querySelector('canvas')?.classList.toggle('stand-in'));
  for (const div of drawn) {
    const old = div.querySelector('canvas');
    if (!old) continue;
    const page = await doc.getPage(+div.dataset.page);
    if (doc !== pdfDoc || s !== scale) return; // another book, or zoomed: those redraw everything anyway
    const vp = page.getViewport({ scale: s }), canvas = document.createElement('canvas');
    canvas.width = old.width; canvas.height = old.height;
    canvas.style.width = old.style.width; canvas.style.height = old.style.height;
    await page.render({ canvas, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null }).promise;
    if (isDark()) await darkenPage(canvas, page, vp, dpr);
    if (old.isConnected) old.replaceWith(canvas);
  }
}

async function darkenPage(canvas, page, vp, dpr) {
  const boxes = await imageBoxes(page, vp, dpr);
  const original = document.createElement('canvas');
  original.width = canvas.width;
  original.height = canvas.height;
  original.getContext('2d').drawImage(canvas, 0, 0);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // Done by hand: canvas filters don't work in every web engine (Safari's, which the Mac app uses).
  // Flipping lightness but not hue: white → near-black, black → near-white, blue links stay blue.
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const shift = 255 - Math.max(r, g, b) - Math.min(r, g, b);
    d[i] = 27 + (r + shift) * 0.79;
    d[i + 1] = 27 + (g + shift) * 0.79;
    d[i + 2] = 27 + (b + shift) * 0.79;
  }
  ctx.putImageData(img, 0, 0);
  for (const [x, y, w, h] of boxes) ctx.drawImage(original, x, y, w, h, x, y, w, h);
}

// Where (in canvas pixels) the page paints pictures. Walks the drawing commands, tracking the transform.
async function imageBoxes(page, vp, dpr) {
  const { OPS, Util } = pdfjsLib;
  const IMAGE_OPS = [OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageXObjectRepeat];
  const ops = await page.getOperatorList();
  let ctm = Util.transform([dpr, 0, 0, dpr, 0, 0], vp.transform);
  const stack = [], boxes = [];
  ops.fnArray.forEach((fn, i) => {
    const args = ops.argsArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() || ctm;
    else if (fn === OPS.transform) ctm = Util.transform(ctm, args);
    else if (fn === OPS.paintFormXObjectBegin) { stack.push(ctm); if (args[0]) ctm = Util.transform(ctm, args[0]); }
    else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || ctm;
    else if (IMAGE_OPS.includes(fn)) {
      // Images are drawn into the unit square of the current transform.
      const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(p => Util.applyTransform(p, ctm));
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      const x = Math.floor(Math.min(...xs)), y = Math.floor(Math.min(...ys));
      boxes.push([x, y, Math.ceil(Math.max(...xs)) - x, Math.ceil(Math.max(...ys)) - y]);
    }
  });
  return boxes;
}

// ---------- Page number and zoom ----------
function currentPage() {
  const line = viewer.scrollTop + viewer.clientHeight / 3;
  let n = 1;
  for (const p of viewer.children) {
    if (p.offsetTop > line) break;
    n = +p.dataset.page || n;
  }
  return n;
}

function updatePageLabel() {
  const input = $('#pageInput');
  if (pdfDoc && document.activeElement !== input) input.value = currentPage();
  markTocCurrent();
  queueShare();
}

// Glides to a page close by; a far one fades out and back in rather than racing past hundreds of pages.
// (Restoring where you were, and zooming, still jump straight there.)
function goToPage(n, smooth = true) {
  const page = viewer.querySelector(`.page[data-page="${Math.min(Math.max(1, n | 0), pdfDoc.numPages)}"]`);
  if (!page) return;
  const top = page.offsetTop - 24, far = Math.abs(top - viewer.scrollTop) > viewer.clientHeight * 6;
  if (!smooth || matchMedia('(prefers-reduced-motion: reduce)').matches) { viewer.scrollTop = top; return; }
  if (!far) { viewer.scrollTo({ top, behavior: 'smooth' }); return; }
  viewer.classList.add('dip');
  setTimeout(() => { viewer.scrollTop = top; viewer.classList.remove('dip'); }, 160);
}

let scrollQueued = false;
viewer.addEventListener('scroll', () => {
  if (scrollQueued) return;
  scrollQueued = true;
  requestAnimationFrame(() => { scrollQueued = false; updatePageLabel(); savePosition(); });
}, { passive: true });

$('#pageInput').addEventListener('change', e => { goToPage(+e.target.value); e.target.blur(); });
$('#pageInput').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
$('#pageInput').addEventListener('blur', updatePageLabel);

$('#backBtn').onclick = () => {
  if (backTo != null) viewer.scrollTop = backTo;
  backTo = null;
  $('#backBtn').hidden = true;
};

const ZOOM_STEPS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const zoomStep = dir => setZoom(dir > 0 ? ZOOM_STEPS.find(z => z > zoom + 0.001) ?? zoom : [...ZOOM_STEPS].reverse().find(z => z < zoom - 0.001) ?? zoom);

// The point of the page at (x, y) on screen, to keep it there through a change of size.
function anchorAt(x = viewer.getBoundingClientRect().left + viewer.clientWidth / 2, y = viewer.getBoundingClientRect().top + viewer.clientHeight / 3) {
  for (const div of viewer.querySelectorAll('.page')) {
    const r = div.getBoundingClientRect();
    if (r.bottom < y) continue;
    return { div, x, y, fx: (x - r.left) / r.width, fy: Math.max(0, (y - r.top) / r.height) };
  }
  return null;
}
function keepAnchor(a) {
  if (!a?.div.isConnected) return;
  const r = a.div.getBoundingClientRect();
  viewer.scrollTop += r.top + a.fy * r.height - a.y;
  viewer.scrollLeft += r.left + a.fx * r.width - a.x;
}

// A new zoom; the point at `anchor` (the middle of the view, or where fingers pinched) stays where it was.
function setZoom(z, keepFit = false, anchor = anchorAt()) {
  if (!pdfDoc) return;
  if (bookType === 'epub') { zoomEpub(z); return; }
  if (!keepFit) zoom = z;
  scale = fitScale * zoom;
  // The pages in view keep their old picture, stretched to the new size, until the new one is drawn (no blank
  // moment, no flash); pages further away are simply cleared.
  const vr = viewer.getBoundingClientRect(), near = new Set([...viewer.children].filter(div => {
    const r = div.getBoundingClientRect();
    return r.bottom > vr.top - vr.height && r.top < vr.bottom + vr.height;
  }));
  for (const div of viewer.children) {
    const shown = [...div.querySelectorAll('canvas')].find(c => !c.classList.contains('stale') && c.style.visibility !== 'hidden') || div.querySelector('canvas.stale');
    div.replaceChildren(...(shown && near.has(div) ? [shown] : []));
    if (shown && near.has(div)) shown.classList.add('stale');
    delete div.dataset.rendered;
    div.style.width = (+div.dataset.w || pageSize.w) * scale + 'px';
    div.style.height = (+div.dataset.h || pageSize.h) * scale + 'px';
    observer.unobserve(div);
    observer.observe(div); // re-observing re-renders the pages in view
  }
  viewer.style.removeProperty('--live-zoom');
  keepAnchor(anchor);
  updateZoomLabel();
}

const updateZoomLabel = () => { $('#zoomLabel').textContent = Math.round(zoom * 100) + '%'; };
$('#zoomIn').onclick = () => zoomStep(1);
$('#zoomOut').onclick = () => zoomStep(-1);
document.addEventListener('keydown', e => {
  if (!(e.metaKey || e.ctrlKey)) return;
  if (e.key === '=' || e.key === '+') { e.preventDefault(); zoomStep(1); }
  else if (e.key === '-') { e.preventDefault(); zoomStep(-1); }
  else if (e.key === '0') { e.preventDefault(); setZoom(1); }
  else if (e.key.toLowerCase() === 'f' && !e.shiftKey && pdfDoc) { e.preventDefault(); openSearch(); }
});

// Keep "100%" meaning "fits the width" when the window is resized. While it is being resized, the pages
// already drawn are stretched (CSS zoom, no redrawing) so they follow the window at once; once it stops
// they are redrawn sharp at the new size.
let resizeTimer, resizeFrame = 0;
const keepScrollPlace = change => {
  const at = viewer.scrollTop / Math.max(viewer.scrollHeight, 1);
  change();
  viewer.scrollTop = at * viewer.scrollHeight;
};
// One CSS variable for every page, at most once a frame: touching each page of a long book on every resize
// event kept the main thread too busy for the window to redraw while it was being dragged.
addEventListener('resize', () => {
  if (!pdfDoc || bookType === 'epub') return; // EPUB text reflows by itself
  if (!resizeFrame) resizeFrame = requestAnimationFrame(() => {
    resizeFrame = 0;
    const ratio = fitWidthScale() / fitScale;
    keepScrollPlace(() => viewer.style.setProperty('--live-zoom', Math.abs(ratio - 1) > 0.01 ? ratio : 1));
  });
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(refit, 200);
});
function refit() {
  const fit = fitWidthScale();
  keepScrollPlace(() => viewer.style.removeProperty('--live-zoom'));
  if (Math.abs(fit - fitScale) > 0.01) { fitScale = fit; setZoom(zoom, true); }
}
// The room beside the panel changes too: hiding it, reading mode, dragging its edge. Then the pages keep their
// size (redrawing them flickers and blurs, and the place on the page moves), unless they no longer fit across;
// those are drawn again once, after the change.
let roomTimer;
new ResizeObserver(() => {
  if (!pdfDoc || bookType === 'epub') return;
  clearTimeout(roomTimer);
  roomTimer = setTimeout(() => {
    if (document.body.classList.contains('resizing')) return; // after the drag
    if (fitWidthScale() < fitScale - 0.01) refit();
  }, 400);
}).observe(viewer);

// ---------- Opening files ----------
document.querySelectorAll('.file-input').forEach(input => input.addEventListener('change', async e => {
  const f = e.target.files[0];
  bookPath = null; // a browser-picked file has no place on disk we can open again
  if (f) openBook(new Uint8Array(await f.arrayBuffer()), f.name);
  e.target.value = '';
}));
// Books double-clicked in Finder / Explorer, or opened with "Open with Siyaq".
async function openFromOS(path) {
  if (!path) return;
  let bytes;
  try { bytes = await tauri.core.invoke('read_book', { path }); }
  catch {
    forgetBook(path);
    showToast(t('bookMissing'));
    return;
  }
  bookPath = path;
  openBook(new Uint8Array(bytes), path.split(/[\\/]/).pop());
}
// Books the OS hands over (double-click, Open with) are taken in ui.js, once every script has loaded.

viewer.addEventListener('dragover', e => { e.preventDefault(); $('#empty')?.classList.add('drag'); });
viewer.addEventListener('dragleave', () => $('#empty')?.classList.remove('drag'));
viewer.addEventListener('drop', async e => {
  e.preventDefault();
  const f = [...e.dataTransfer.files].find(f => /\.(pdf|epub)$/i.test(f.name) || /pdf|epub/.test(f.type));
  bookPath = null;
  if (f) openBook(new Uint8Array(await f.arrayBuffer()), f.name);
});
