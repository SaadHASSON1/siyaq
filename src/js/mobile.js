// Android: the system's Back button and gesture, two-finger pinch and one-finger swipes on a touch screen.

if (onAndroid) {
  // The app zooms the pages itself (sharp, around the fingers): the window as a whole doesn't zoom.
  document.querySelector('meta[name="viewport"]').content = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';
  document.documentElement.classList.add('android');
}
// The sizes of the status bar, navigation bar and keyboard, from the Android side whenever they change.
function siyaqInsets(i) {
  if (!i) return;
  const root = document.documentElement.style;
  for (const side of ['top', 'right', 'bottom', 'left']) root.setProperty('--inset-' + side, (i[side] || 0) + 'px');
  document.documentElement.classList.toggle('keyboard', !!i.keyboard);
}
// ...and, asked for once the page is ready (and with each change of theme), with the bars' icons light or dark.
const tellBars = () => onAndroid && tauri.core.invoke('android_bars', { dark: isDark() }).then(siyaqInsets).catch(() => {});

// ---------- Back ----------
// Back closes what is open, the innermost first, then the book, and only then (pressed again) leaves the app.
function goBack() {
  const dlg = [...document.querySelectorAll('dialog[open]')].pop();
  if (dlg) { dlg.close('cancel'); return true; }
  if (!$('#openMenu').hidden) { $('#openMenu').hidden = true; return true; }
  if (!$('#exportMenu').hidden) { $('#exportMenu').hidden = true; return true; }
  if (!$('#hlPop').hidden) { closeHighlight(); return true; }
  if (!$('#wordCard').hidden) { hideWordCard(); return true; }
  if (askMode) { setAskMode(false); return true; }
  if (!$('#searchBar').hidden) { closeSearch(); return true; }
  if (inkMode) { setInkMode(false); return true; }
  if (reading) { setReading(false); return true; }
  if (pdfDoc && phoneScreen() && !panel.classList.contains('closed')) { setPanelHidden(true, false); return true; } // the sheet at the bottom
  if (pdfDoc) { goHome(); return true; }
  return false;
}
if (onAndroid && tauri.app?.onBackButtonPress) {
  let listener = null, leaving = 0;
  const listen = async () => { listener = await tauri.app.onBackButtonPress(() => {
    if (goBack()) return;
    // Nothing left to close: the next Back, within two seconds, leaves the app (Android's own Back does that).
    showToast(t('backAgain'));
    listener?.unregister();
    listener = null;
    clearTimeout(leaving);
    leaving = setTimeout(listen, 2000);
  }); };
  listen();
}

// ---------- Touch ----------
// Two fingers: zoom around them, the pages following at once (as pictures) and drawn sharp when they let go.
const fingerGap = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
let touchPinch = null, swipeStart = null;
viewer.addEventListener('touchstart', e => {
  if (!pdfDoc || inkMode && !penSeen) return; // drawing with a finger: every finger draws (with a pen, two zoom)
  if (e.touches.length === 2) {
    const [a, b] = e.touches;
    touchPinch = { gap: Math.max(1, fingerGap(a, b)), from: pinch?.zoom ?? zoom };
    swipeStart = null;
    e.preventDefault();
  } else if (e.touches.length === 1 && !inkMode) {
    const p = e.touches[0];
    swipeStart = { x: p.clientX, y: p.clientY, at: performance.now(), scroll: viewer.scrollTop };
  }
}, { passive: false });
viewer.addEventListener('touchmove', e => {
  if (!touchPinch || e.touches.length < 2) return;
  e.preventDefault();
  const [a, b] = e.touches;
  pinchTo(touchPinch.from * fingerGap(a, b) / touchPinch.gap, (a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
}, { passive: false });
const touchDone = e => {
  if (touchPinch && e.touches.length < 2) { touchPinch = null; endPinch(); swipeStart = null; return; }
  // One finger, quickly sideways (not scrolling, not selecting text): the next or previous page.
  if (!swipeStart || e.touches.length || !e.changedTouches.length) return;
  const p = e.changedTouches[0], dx = p.clientX - swipeStart.x, dy = p.clientY - swipeStart.y;
  const quick = performance.now() - swipeStart.at < 700, start = swipeStart;
  swipeStart = null;
  if (!quick || Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 2 || Math.abs(viewer.scrollTop - start.scroll) > 30) return;
  if (viewer.scrollWidth > viewer.clientWidth + 2) return; // a wide page: the finger moves across it
  if (!getSelection().isCollapsed) return;
  const forward = dx < 0; // finger moving left
  turnPage(forward !== bookRtl() ? 1 : -1);
};
viewer.addEventListener('touchend', touchDone);
viewer.addEventListener('touchcancel', () => { if (touchPinch) { touchPinch = null; endPinch(); } swipeStart = null; });
