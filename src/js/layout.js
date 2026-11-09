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

// A phone, or a window as narrow as one: the panel is a sheet at the bottom.
const phoneScreen = () => matchMedia('(max-width: 760px)').matches;

function setPanelHidden(hidden, save = true) {
  if (hidden !== panel.classList.contains('closed') && save && !matchMedia('(prefers-reduced-motion: reduce)').matches) slidePanel(hidden);
  else panel.classList.toggle('closed', hidden);
  panel.inert = hidden;
  $('#panelShow').hidden = !hidden;
  if (save) store.set('panelHidden', hidden);
  if (!hidden) requestAnimationFrame(() => window.movePill?.(document.querySelector('.seg')));
}
setPanelHidden(store.get('panelHidden', false), false);

// The slide: the layout jumps to its end at once (one reflow), then the panel and the book are drawn moving from
// where they were to where they now are, as pictures: nothing is laid out again on the way, so every frame is smooth.
let panelSlide = null;
function slidePanel(hidden) {
  panelSlide?.forEach(a => a.finish());
  const main = panel.parentElement;
  const mark = [...viewer.children].find(el => { const r = el.getBoundingClientRect(); return r.height && r.bottom > 0; }) || viewer;
  const p0 = panel.getBoundingClientRect(), v0 = mark.getBoundingClientRect();
  panel.classList.toggle('closed', hidden);
  const p1 = panel.getBoundingClientRect(), v1 = mark.getBoundingClientRect();
  // the room the panel leaves (or is about to take) shows the book's own background, not a gap
  main.style.background = getComputedStyle(viewer).backgroundColor;
  main.classList.add('sliding');
  const opts = { duration: 340, easing: 'cubic-bezier(.3, .8, .3, 1)' };
  panelSlide = [
    panel.animate([{ transform: `translate(${p0.left - p1.left}px, ${p0.top - p1.top}px)`, visibility: 'visible' }, { transform: 'none', visibility: 'visible' }], opts),
    viewer.animate([{ transform: `translate(${v0.left - v1.left}px, ${v0.top - v1.top}px)` }, { transform: 'none' }], opts),
  ];
  const done = panelSlide;
  done[1].finished.catch(() => {}).then(() => { if (panelSlide !== done) return; panelSlide = null; main.classList.remove('sliding'); main.style.background = ''; });
}
$('#panelHide').onclick = () => setPanelHidden(true);
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
    if (pdfDoc && bookType !== 'epub' && fitWidthScale() < fitScale - 0.01) refit(); // pages wider than the room left
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
// reaches the top. A word's meaning in its sentence, and nothing else, shows in a small card over the word.
// Leaving puts everything back as it was: the same pages at the same size, at the same place.
let reading = false, idleTimer = 0;
function setReading(on) {
  if (on === reading || (on && !pdfDoc)) return;
  // The viewer moves up or down by the bar's height: keep the page where the reader's eyes are.
  const top = viewer.getBoundingClientRect().top;
  reading = on;
  document.body.classList.toggle('reading', on);
  document.body.classList.remove('peek');
  viewer.scrollTop -= top - viewer.getBoundingClientRect().top;
  hideWordCard();
  panel.inert = on || panel.classList.contains('closed');
  $('#panelShow').hidden = on || !panel.classList.contains('closed');
  $('#readBar').hidden = !on;
  applyTint();
  $('#readBtn').classList.toggle('on', on);
  if (on) wakeExit();
}
// A word was just looked up: its card in reading mode, and on a phone (the page stays in view, the meaning next to
// the word, Details for the rest); otherwise the panel back in its place.
function revealPanel(word) {
  const fromPage = clickPoint?.inBook && performance.now() - clickPoint.at < 4000; // a word tapped on the page
  if (reading || phoneScreen() && fromPage && panel.classList.contains('closed')) showWordCard(word);
  else if (panel.classList.contains('closed')) setPanelHidden(false);
}

// The card: the word, then its meaning here, flowing in as the answer arrives. It mirrors the panel (which still
// gets the whole answer, and saves the word), so every way an answer can come (streamed, saved, the demo, an
// error) shows the same here.
const card = Object.assign(document.createElement('div'), { id: 'wordCard', className: 'word-card', hidden: true });
card.setAttribute('role', 'status');
document.body.append(card);
let clickPoint = null;
document.addEventListener('click', e => {
  clickPoint = { x: e.clientX, y: e.clientY, at: performance.now(), inBook: !!e.target.closest?.('#viewer') };
  if (!card.hidden && !card.contains(e.target)) hideWordCard(); // a click elsewhere closes it (a word opens a new one)
}, true);
function showWordCard(word) {
  card.innerHTML = `<div class="wc-word" dir="auto">${esc(word)}</div><p class="wc-tr" dir="${LANGS[settings.lang].dir}"></p><div class="wc-wait"><span></span></div>`
    + (reading ? '' : `<button class="wc-more" type="button">${esc(t('wcMore'))}${icon('arrow')}</button>`);
  const more = card.querySelector('.wc-more');
  if (more) more.onclick = () => { hideWordCard(); setPanelHidden(false, false); };
  card.hidden = false;
  card.classList.remove('in'); void card.offsetWidth; card.classList.add('in');
  // Only what the lookup writes from now on: the panel still shows the last word (or the hint) until then.
  mirror.observe($('#lookup'), { childList: true, subtree: true, characterData: true });
  placeWordCard();
}
function hideWordCard() { card.hidden = true; mirror.disconnect(); }
const mirror = new MutationObserver(() => syncWordCard());
function syncWordCard() {
  const pane = $('#lookup'), tr = pane.querySelector('.tr'), state = pane.querySelector('.state p');
  const out = card.querySelector('.wc-tr');
  if (tr) {
    const streaming = !!pane.querySelector('.result.streaming');
    flowText(out, streaming ? (tr.dataset.shown ?? tr.textContent) : tr.textContent, !streaming);
    if (out.textContent) card.querySelector('.wc-wait')?.remove();
  } else if (state && !pane.querySelector('.skeleton')) {
    out.textContent = state.textContent; // no key, or the AI couldn't answer: say so, briefly
    out.classList.add('wc-note');
    card.querySelector('.wc-wait')?.remove();
  }
  placeWordCard();
}
// Under the word, or over it when there's no room below; never past the window's edges.
function placeWordCard() {
  if (card.hidden || !clickPoint) return;
  // (clear of the status and navigation bars on Android)
  const inset = side => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--inset-' + side)) || 0;
  const top = 12 + inset('top'), bottom = innerHeight - 12 - inset('bottom');
  const w = card.offsetWidth, h = card.offsetHeight, gap = 18;
  const x = Math.max(12 + inset('left'), Math.min(innerWidth - inset('right') - w - 12, clickPoint.x - w / 2));
  const below = clickPoint.y + gap + h < bottom;
  card.style.left = x + 'px';
  card.style.top = (below ? clickPoint.y + gap : Math.max(top, clickPoint.y - gap - h)) + 'px';
  card.classList.toggle('above', !below);
  card.style.setProperty('--tail', Math.max(14, Math.min(w - 14, clickPoint.x - x)) + 'px');
}
viewer.addEventListener('scroll', () => { if (!card.hidden) hideWordCard(); }, { passive: true });
addEventListener('resize', () => { if (!card.hidden) hideWordCard(); }); // turned or resized: the word has moved

// The exit button fades while the pointer rests, so it doesn't sit on the page.
function wakeExit() {
  $('#readBar').classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => $('#readBar').classList.add('idle'), 2500);
}
$('#readBtn').onclick = () => setReading(!reading);
$('#readExit').onclick = () => setReading(false);

// The reading colour: the reader's choice, kept for next time, and only on while reading mode is.
function applyTint() {
  const tint = settings.readTint || 'none';
  for (const c of ['sepia', 'sage']) document.body.classList.toggle('tint-' + c, reading && tint === c);
  document.querySelectorAll('#readBar .tint').forEach(b => { b.classList.toggle('on', b.dataset.tint === tint); b.setAttribute('aria-checked', b.dataset.tint === tint); });
}
document.querySelectorAll('#readBar .tint').forEach(b => b.onclick = () => {
  settings.readTint = b.dataset.tint;
  store.set('settings', settings);
  document.body.classList.add('tint-ease');
  applyTint();
  setTimeout(() => document.body.classList.remove('tint-ease'), 500);
});
document.addEventListener('pointermove', e => {
  if (!reading) return;
  wakeExit();
  // The top bar while the pointer is near the top of the window, or on the bar itself.
  document.body.classList.toggle('peek', e.clientY < 12 || (document.body.classList.contains('peek') && e.clientY < 70));
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && reading && !document.querySelector('dialog[open]') && $('#hlPop').hidden && !askMode && $('#searchBar').hidden) {
    if (!card.hidden) hideWordCard(); else setReading(false);
  }
  // ⌘/Ctrl + Shift + F: reading mode ("focus"; Ctrl+Shift+R would reload on Windows); ⌘/Ctrl + \: the panel.
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f' && pdfDoc) { e.preventDefault(); setReading(!reading); }
  if ((e.metaKey || e.ctrlKey) && e.key === '\\' && !reading) { e.preventDefault(); setPanelHidden(!panel.classList.contains('closed')); }
});
