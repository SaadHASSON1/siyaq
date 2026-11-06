// Trackpad and keyboard: pinch to zoom (around the fingers), swipe sideways or press ← → to turn pages.

const ZOOM_MIN = ZOOM_STEPS[0], ZOOM_MAX = ZOOM_STEPS[ZOOM_STEPS.length - 1];
const clampZoom = z => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

// ---------- Pinch ----------
// While the fingers move, the pages are stretched as they are (no redrawing, so it follows at once) with the point
// under the fingers kept still; when they stop, the pages are drawn again, sharp, at the new size.
let pinch = null; // { zoom: where it is heading, anchor, done: timer }
function pinchTo(z, x, y) {
  if (!pdfDoc) return;
  z = clampZoom(z);
  if (!pinch) pinch = { zoom: zoom, anchor: null, done: 0 };
  if (bookType === 'epub') { pinch.zoom = z; zoomEpub(z); return; }
  const anchor = anchorAt(x, y);
  pinch.zoom = z;
  viewer.style.setProperty('--live-zoom', z / zoom);
  keepAnchor(anchor);
  pinch.anchor = anchorAt(x, y);
  $('#zoomLabel').textContent = Math.round(z * 100) + '%';
}
function endPinch() {
  if (!pinch) return;
  const { zoom: z, anchor } = pinch;
  pinch = null;
  if (bookType === 'epub') return;
  if (Math.abs(z - zoom) < 0.005) { viewer.style.removeProperty('--live-zoom'); updateZoomLabel(); return; }
  setZoom(z, false, anchor);
}

// Chrome and Windows (and a mouse wheel with Ctrl or ⌘): a pinch comes as wheel events with Ctrl held.
let gesturing = false; // Safari's own pinch events are on: its wheel events for the same pinch are left alone
viewer.addEventListener('wheel', e => {
  if (!(e.ctrlKey || e.metaKey) || !pdfDoc) return;
  e.preventDefault();
  if (gesturing) return;
  const d = Math.max(-40, Math.min(40, e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY));
  pinchTo((pinch?.zoom ?? zoom) * Math.exp(-d * 0.01), e.clientX, e.clientY);
  clearTimeout(pinch.done);
  pinch.done = setTimeout(endPinch, 220);
}, { passive: false });

// Safari's engine (the app on Macs): a pinch comes as gesture events with a scale.
let gestureBase = 1;
document.addEventListener('gesturestart', e => {
  if (!e.target.closest?.('#viewer')) { e.preventDefault(); return; } // no zooming the whole window
  e.preventDefault();
  gesturing = true;
  gestureBase = pinch?.zoom ?? zoom;
});
document.addEventListener('gesturechange', e => {
  e.preventDefault();
  if (!pdfDoc || !e.target.closest?.('#viewer')) return;
  pinchTo(gestureBase * e.scale, e.clientX, e.clientY);
  clearTimeout(pinch?.done);
});
document.addEventListener('gestureend', e => { e.preventDefault(); gesturing = false; if (pinch) pinch.done = setTimeout(endPinch, 60); });

// ---------- Turning pages ----------
// In a right-to-left book the next page is to the left, as when turning a paper book's pages.
const bookRtl = () => bookLang === 'ar';
function turnPage(dir) {
  if (!pdfDoc) return;
  goToPage(currentPage() + dir);
}

// Two fingers sideways turn the page, unless the page is wider than the window (then they move across it).
// One swipe is one page: its momentum is let to die down before the next.
let swipe = { sum: 0, quietAt: 0, used: false };
viewer.addEventListener('wheel', e => {
  if (e.ctrlKey || e.metaKey || !pdfDoc || inkMode || pinch) return;
  if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) * 1.2) return;
  if (viewer.scrollWidth > viewer.clientWidth + 2) return;
  e.preventDefault();
  const now = performance.now();
  if (now - swipe.quietAt > 260) swipe = { sum: 0, used: false };
  swipe.quietAt = now;
  if (swipe.used) return;
  swipe.sum += e.deltaX;
  if (Math.abs(swipe.sum) > 90) {
    swipe.used = true;
    const forward = swipe.sum > 0; // fingers moving left
    turnPage(forward !== bookRtl() ? 1 : -1);
  }
}, { passive: false });

// ← → turn pages too (when not typing), and Page Up / Page Down already scroll by a screen.
document.addEventListener('keydown', e => {
  if (!pdfDoc || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const el = document.activeElement;
  if (el?.closest?.('input, textarea, select, [contenteditable="true"]') || document.querySelector('dialog[open]')) return;
  if (viewer.scrollWidth > viewer.clientWidth + 2) return; // a wide page: the arrows move across it
  e.preventDefault();
  turnPage((e.key === 'ArrowRight') !== bookRtl() ? 1 : -1);
});
