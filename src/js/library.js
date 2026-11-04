// Recent books on the start screen and under the folder button.

// ---------- Recent books (installed app) ----------
// The app opens books with the system's picker or by dropping them on the window, so it knows where each
// one is and can list the last ones on the start screen and under the folder button.
const desktopApp = tauri && !/Android|iPhone|iPad/.test(navigator.userAgent);
let bookPath = null; // where the open book is on disk, when known
const library = () => store.get('library', []);

function rememberBook(doc) {
  if (!bookPath) return;
  const entry = { path: bookPath, name: bookName, key: bookKey, pages: doc.numPages, type: bookType, at: Date.now() };
  store.set('library', [entry, ...library().filter(b => b.path !== bookPath)].slice(0, 12));
}
function forgetBook(path) {
  store.set('library', library().filter(b => b.path !== path));
  renderRecent();
}

function bookItem(b, current = false) {
  const pos = store.get('positions', {})[b.key];
  const page = pos?.page || 1, share = Math.round((page / (b.pages || 1)) * 100);
  const days = Math.round((b.at - Date.now()) / 864e5);
  return `<li class="book-item${current ? ' now' : ''}" data-path="${esc(b.path)}">
    ${icon('book')}
    <div class="b-body">
      <div class="b-name" dir="auto">${esc(b.name.replace(/\.(pdf|epub)$/i, ''))}</div>
      <div class="b-meta"><span>${t('pageOf')(page, b.pages)}</span><span class="b-bar"><span style="width:${share}%"></span></span><span>${new Intl.RelativeTimeFormat(settings.uiLang, { numeric: 'auto' }).format(days, 'day')}</span></div>
    </div>
    ${current ? '' : `<button class="icon-btn x" data-forget="${esc(b.path)}" title="${t('forgetBook')}" aria-label="${t('forgetBook')}">${icon('x')}</button>`}
  </li>`;
}

const newReader = () => !store.get('demoDone', false) && !library().length && !vocab.length;

function renderRecent() {
  const box = $('#recent');
  if (!box) return; // the start screen is gone once a book is open
  const books = desktopApp ? library().slice(0, 5) : [];
  box.hidden = !books.length;
  // The demo book is for a first look: once someone has opened a book (the demo included), it leaves the start
  // screen. (It is still at the end of the tour, under Settings.)
  document.querySelectorAll('#empty [data-demo]').forEach(b => b.hidden = !newReader());
  box.innerHTML = books.length ? `<h3>${t('recentBooks')}</h3><ul>${books.map(b => bookItem(b)).join('')}</ul>` : '';
}

async function pickBook() {
  const path = await tauri.core.invoke('pick_file', { label: t('books'), extensions: ['pdf', 'epub'] }).catch(() => null);
  if (path) { if ($('#setup').open) $('#setup').close(); openFromOS(path); }
}

function showOpenMenu() {
  const books = library();
  if (!books.length) { pickBook(); return; }
  const menu = $('#openMenu'), r = $('#openBtn').getBoundingClientRect();
  menu.innerHTML = `<h3>${t('recentBooks')}</h3><ul>${books.slice(0, 8).map(b => bookItem(b, b.path === bookPath)).join('')}</ul>
    <button class="btn primary" id="openOther">${icon('folder')}${t('openOther')}</button>`;
  menu.hidden = false;
  const w = menu.offsetWidth;
  menu.style.top = r.bottom + 8 + 'px';
  menu.style.left = Math.max(12, Math.min(innerWidth - w - 12, document.dir === 'rtl' ? r.left : r.right - w)) + 'px';
  $('#openOther').onclick = () => { menu.hidden = true; pickBook(); };
}

document.addEventListener('click', e => {
  const forget = e.target.closest('[data-forget]');
  if (forget) { e.stopPropagation(); forgetBook(forget.dataset.forget); if (!$('#openMenu').hidden) showOpenMenu(); return; }
  const item = e.target.closest('.book-item[data-path]');
  if (item && !item.classList.contains('now')) { $('#openMenu').hidden = true; openFromOS(item.dataset.path); return; }
  if (!e.target.closest('#openMenu, #openBtn')) $('#openMenu').hidden = true;
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') $('#openMenu').hidden = true; });

if (desktopApp) {
  // The folder buttons use the system's picker; the toolbar one also lists recent books.
  document.querySelectorAll('.file-input').forEach(input => input.closest('label').addEventListener('click', e => {
    e.preventDefault();
    if (input.closest('#openBtn')) { $('#openMenu').hidden ? showOpenMenu() : ($('#openMenu').hidden = true); }
    else pickBook();
  }));
  // Dropped files come through the app, with their paths.
  tauri.event.listen('tauri://drag-enter', () => $('#empty')?.classList.add('drag'));
  tauri.event.listen('tauri://drag-leave', () => $('#empty')?.classList.remove('drag'));
  tauri.event.listen('tauri://drag-drop', e => {
    $('#empty')?.classList.remove('drag');
    const path = (e.payload?.paths || []).find(p => /\.(pdf|epub)$/i.test(p));
    if (path) openFromOS(path);
  });
}
