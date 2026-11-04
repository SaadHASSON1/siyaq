// The side panel (wider, narrower, hidden) and reading mode (the book alone; a word's meaning slides in over it).

// ---------- The side panel ----------
const panel = $('#panel'), PANEL_WIDTH = 380;
// As narrow as the four tabs allow, and never so wide that the book gets cramped.
const panelLimits = () => [300, Math.max(300, Math.min(720, innerWidth - 420))];
function setPanelWidth(w, save = false) {
  const [lo, hi] = panelLimits();
  w = Math.round(Math.min(hi, Math.max(lo, w)));
  panel.style.setProperty('--panel-w', w + 'px');
  if (save) store.set('panelWidth', w);
}
setPanelWidth(store.get('panelWidth', PANEL_WIDTH));
addEventListener('resize', () => setPanelWidth(store.get('panelWidth', PANEL_WIDTH)));

function setPanelHidden(hidden, save = true) {
  panel.classList.toggle('closed', hidden);
  panel.inert = hidden;
  $('#panelShow').hidden = !hidden;
  if (save) store.set('panelHidden', hidden);
  if (!hidden) requestAnimationFrame(() => window.movePill?.(document.querySelector('.seg')));
}
setPanelHidden(store.get('panelHidden', false), false);
$('#panelHide').onclick = () => (reading ? closeFloat() : setPanelHidden(true));
$('#panelShow').onclick = () => setPanelHidden(false);

// Dragging the panel's edge. The panel is on the reading side's start: on the left in English, the right in Arabic.
const grip = $('#panelGrip');
grip.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  e.preventDefault();
  grip.setPointerCapture(e.pointerId);
  document.body.classList.add('resizing');
  const box = panel.getBoundingClientRect(), rtl = document.dir === 'rtl';
  const move = ev => setPanelWidth(rtl ? box.right - ev.clientX : ev.clientX - box.left);
  const up = ev => {
    grip.removeEventListener('pointermove', move);
    document.body.classList.remove('resizing');
    setPanelWidth(parseFloat(panel.style.getPropertyValue('--panel-w')), true);
    grip.releasePointerCapture(ev.pointerId);
  };
  grip.addEventListener('pointermove', move);
  grip.addEventListener('pointerup', up, { once: true });
  grip.addEventListener('pointercancel', up, { once: true });
});
grip.addEventListener('dblclick', () => setPanelWidth(PANEL_WIDTH, true));
// The keyboard too: arrows change the width, Enter puts it back.
grip.tabIndex = 0;
grip.addEventListener('keydown', e => {
  const step = (e.key === 'ArrowRight') - (e.key === 'ArrowLeft');
  const now = parseFloat(panel.style.getPropertyValue('--panel-w'));
  if (step) { e.preventDefault(); setPanelWidth(now + step * 20 * (document.dir === 'rtl' ? -1 : 1), true); }
  else if (e.key === 'Enter') setPanelWidth(PANEL_WIDTH, true);
});

// ---------- Reading mode ----------
// The bars and the panel step aside and the pages take the whole window. The top bar comes back when the pointer
// reaches the top; a word's meaning slides in over the page and goes again with Esc or ✕.
let reading = false, idleTimer = 0;
function setReading(on) {
  if (on === reading || (on && !pdfDoc)) return;
  reading = on;
  document.body.classList.toggle('reading', on);
  document.body.classList.remove('peek');
  closeFloat();
  panel.inert = on || panel.classList.contains('closed');
  $('#panelShow').hidden = on || !panel.classList.contains('closed');
  $('#readExit').hidden = !on;
  $('#readBtn').classList.toggle('on', on);
  if (on) wakeExit();
}
const closeFloat = () => { panel.classList.remove('float'); if (reading) panel.inert = true; };
// Shows the panel for a word that was just looked up: over the page in reading mode, or back in its place.
function revealPanel() {
  if (reading) { panel.inert = false; panel.classList.add('float'); }
  else if (panel.classList.contains('closed')) setPanelHidden(false);
}
// The exit button fades while the pointer rests, so it doesn't sit on the page.
function wakeExit() {
  $('#readExit').classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => $('#readExit').classList.add('idle'), 2500);
}
$('#readBtn').onclick = () => setReading(!reading);
$('#readExit').onclick = () => setReading(false);
document.addEventListener('pointermove', e => {
  if (!reading) return;
  wakeExit();
  // The top bar while the pointer is near the top of the window, or on the bar itself.
  document.body.classList.toggle('peek', e.clientY < 12 || (document.body.classList.contains('peek') && e.clientY < 70));
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && reading && !document.querySelector('dialog[open]') && $('#hlPop').hidden && !askMode && $('#searchBar').hidden) {
    if (panel.classList.contains('float')) closeFloat(); else setReading(false);
  }
  // ⌘/Ctrl + Shift + F: reading mode ("focus"; Ctrl+Shift+R would reload on Windows); ⌘/Ctrl + \: the panel.
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f' && pdfDoc) { e.preventDefault(); setReading(!reading); }
  if ((e.metaKey || e.ctrlKey) && e.key === '\\' && !reading) { e.preventDefault(); setPanelHidden(!panel.classList.contains('closed')); }
});
