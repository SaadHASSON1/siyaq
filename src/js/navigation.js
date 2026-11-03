// Where you are: reading position, contents, search, words underlined in the book.

// ---------- Reading position ----------
function restorePosition() {
  const p = store.get('positions', {})[bookKey];
  const div = p && viewer.querySelector(`.page[data-page="${p.page}"]`);
  if (!div || p.page < 2) return;
  viewer.scrollTop = div.offsetTop - 24 + p.frac * div.offsetHeight;
  showToast(t('resumed')(p.page));
}

let saveTimer;
function savePosition(now = false) {
  clearTimeout(saveTimer);
  const write = () => {
    if (!pdfDoc) return;
    const n = currentPage(), div = viewer.querySelector(`.page[data-page="${n}"]`);
    const frac = div ? (viewer.scrollTop + 24 - div.offsetTop) / div.offsetHeight : 0;
    const all = store.get('positions', {});
    all[bookKey] = { page: n, frac: Math.min(1, Math.max(0, frac)), at: Date.now() };
    const recent = Object.keys(all).sort((a, b) => all[b].at - all[a].at).slice(0, 100); // the last 100 books
    store.set('positions', Object.fromEntries(recent.map(k => [k, all[k]])));
  };
  if (now) write(); else saveTimer = setTimeout(write, 600);
}

// Back to the start screen (the logo and name): the book closes, its place kept.
const welcomeScreen = $('#empty');
function goHome() {
  if (!pdfDoc) return;
  savePosition(true);
  closeSearch();
  if (askMode) setAskMode(false);
  pdfDoc = null; bookPath = null; bookName = ''; bookKey = ''; bookLang = null; tocItems = []; lastLookup = null;
  viewer.replaceChildren(welcomeScreen);
  viewer.scrollTop = 0;
  easeIn(viewer);
  welcomeScreen.classList.remove('drag');
  $('#tools').hidden = true;
  $('#backBtn').hidden = true;
  $('#bookTitle').textContent = '';
  $('#toc').innerHTML = stateCard('list', t('noBook'));
  $('#notesCount').textContent = '';
  showBookLang();
  renderRecent();
  queueShare();
}
$('#homeBtn').onclick = goHome;

// ---------- Contents ----------
// The contents as a tree: levels, the page each entry starts on, and where the reader is now.
let tocItems = []; // { title, dest, depth, parent, page } in reading order

async function loadToc(doc) {
  const pane = $('#toc');
  tocItems = [];
  const outline = await doc.getOutline();
  if (pdfDoc !== doc) return;
  if (!outline?.length) { pane.innerHTML = stateCard('list', t('noToc')); return; }
  const items = [];
  const collect = (list, depth, parent) => list.forEach(it => {
    items.push({ title: it.title, dest: it.dest, depth, parent, page: null });
    if (it.items?.length && depth < 3) collect(it.items, depth + 1, items.length - 1);
  });
  collect(outline, 0, -1);
  await Promise.all(items.map(async x => { x.page = await destPage(doc, x.dest); }));
  if (pdfDoc !== doc) return;
  tocItems = items;
  const kids = i => items.flatMap((x, j) => x.parent === i ? [j] : []);
  const many = items.length > 25; // long contents start folded, except around the reader
  const showPages = bookType !== 'epub'; // EPUB "pages" are chapters, not page numbers
  const build = parent => kids(parent).map(i => {
    const x = items[i], sub = kids(i);
    return `<li data-i="${i}" class="${sub.length && many ? 'closed' : ''}">
      <div class="toc-row">
        <button class="toc-fold${sub.length ? '' : ' none'}" data-fold="${i}" tabindex="${sub.length ? 0 : -1}" aria-label="${esc(x.title)}">${icon('chevDown')}</button>
        <button class="toc-go" data-toc="${i}"><span class="t">${esc(x.title)}</span>${showPages && x.page ? `<span class="p">${x.page}</span>` : ''}</button>
      </div>${sub.length ? `<ul>${build(i)}</ul>` : ''}</li>`;
  }).join('');
  // Lay it out in the direction of the book's own headings.
  const rtlChars = (items.map(x => x.title).join('').match(/[\u0590-\u08FF]/g) || []).length;
  const dir = rtlChars * 2 > items.map(x => x.title).join('').replace(/\s/g, '').length ? 'rtl' : 'ltr';
  pane.innerHTML = `<header class="toc-head" dir="auto"><b>${esc(bookName.replace(/\.(pdf|epub)$/i, ''))}</b><small dir="${LANGS[settings.uiLang].dir}">${t('tocCount')(kids(-1).length)}</small></header>
    <ul class="toc" dir="${dir}">${build(-1)}</ul>`;
  pane.onclick = e => {
    const fold = e.target.closest('[data-fold]');
    if (fold) { fold.closest('li').classList.toggle('closed'); return; }
    const b = e.target.closest('[data-toc]');
    if (b && items[+b.dataset.toc].dest) goToDest(items[+b.dataset.toc].dest, false);
  };
  markTocCurrent(true);
}

// Highlights the entry the reader is in (the last one starting at or before this page) and opens its branch.
let tocCurrent = -1;
function markTocCurrent(scroll = false) {
  if (!tocItems.length) return;
  const page = currentPage();
  let at = -1;
  tocItems.forEach((x, i) => { if (x.page && x.page <= page && (at < 0 || x.page >= tocItems[at].page)) at = i; });
  if (at === tocCurrent && !scroll) return;
  tocCurrent = at;
  const pane = $('#toc');
  pane.querySelectorAll('li.current').forEach(li => li.classList.remove('current'));
  const li = pane.querySelector(`li[data-i="${at}"]`);
  if (!li) return;
  li.classList.add('current');
  for (let p = li.parentElement.closest('li'); p; p = p.parentElement.closest('li')) p.classList.remove('closed');
  if (scroll && !pane.hidden) li.scrollIntoView({ block: 'center' });
}

// ---------- Search ----------
const search = { query: '', pages: [], shown: 0, token: 0 };
const pageTexts = new Map(); // page number → lower-cased text
const normText = s => s.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ');

async function pageText(doc, n) {
  if (!pageTexts.has(n)) {
    const ocr = ocrCache.get(n);
    const text = ocr ? ocr.flat().map(w => w.text).join(' ')
      : (await (await doc.getPage(n)).getTextContent()).items.map(it => it.str).join(' ');
    pageTexts.set(n, normText(text));
  }
  return pageTexts.get(n);
}

function openSearch() {
  $('#searchBar').hidden = false;
  $('#searchInput').focus();
  $('#searchInput').select();
}

function closeSearch() {
  $('#searchBar').hidden = true;
  $('#searchInput').value = '';
  search.token++;
  search.query = '';
  search.pages = [];
  viewer.querySelectorAll('.page').forEach(highlightSearch);
  $('#searchCount').textContent = '';
}

// Searches every page, starting from the one on screen; the first hit is shown as soon as it's found.
async function runSearch(q) {
  const token = ++search.token, doc = pdfDoc;
  search.query = normText(q.trim());
  search.pages = [];
  search.shown = 0;
  viewer.querySelectorAll('.page').forEach(highlightSearch);
  if (!search.query || !doc) { updateSearchCount(false); return; }
  updateSearchCount(true);
  const start = currentPage();
  for (let i = 0; i < doc.numPages; i++) {
    const n = (start - 1 + i) % doc.numPages + 1;
    const text = await pageText(doc, n);
    if (token !== search.token) return;
    if (!text.includes(search.query)) continue;
    search.pages.splice(search.pages.findIndex(p => p > n) >>> 0, 0, n); // keep in page order
    if (!search.shown) showSearchResult(n);
    updateSearchCount(true);
  }
  updateSearchCount(false);
}

function showSearchResult(n) {
  search.shown = n;
  goToPage(n);
  viewer.querySelectorAll('.page').forEach(highlightSearch);
  // A chapter is long: bring the first matching paragraph into view.
  const hit = bookType === 'epub' && viewer.querySelector(`.page[data-page="${n}"] .hit`);
  if (hit) viewer.scrollTop += hit.getBoundingClientRect().top - viewer.getBoundingClientRect().top - 80;
}

function stepSearch(dir) {
  if (!search.pages.length) return;
  const i = search.pages.indexOf(search.shown);
  showSearchResult(search.pages[(i + dir + search.pages.length) % search.pages.length]);
  updateSearchCount(false);
}

function updateSearchCount(busy) {
  const n = search.pages.length;
  $('#searchCount').textContent = !search.query ? '' : n ? `${search.pages.indexOf(search.shown) + 1} / ${n}${busy ? '…' : ''}` : busy ? t('searching') : t('searchNone');
}

function highlightSearch(div) {
  if (div.classList.contains('epub-chapter')) { highlightEpub(div); return; }
  for (const span of div.querySelectorAll('.textLayer > span')) {
    span.classList.toggle('hit', !!search.query && normText(span.textContent).includes(search.query));
  }
}

let searchTimer;
$('#searchInput').addEventListener('input', e => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => runSearch(e.target.value), 300);
});
$('#searchInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); stepSearch(e.shiftKey ? -1 : 1); }
  if (e.key === 'Escape') closeSearch();
});
$('#searchBtn').onclick = openSearch;
$('#searchPrev').onclick = () => stepSearch(-1);
$('#searchNext').onclick = () => stepSearch(1);
$('#searchClose').onclick = closeSearch;

// ---------- Words looked up before, underlined in the book ----------
let knownRe = null;
// Older Safari engines (macOS before 13.3) cannot read look-behind, so the letter before a word is captured instead.
const knownMatches = text => [...text.matchAll(knownRe)].map(m => ({ index: m.index + m[1].length, word: m[2] }));
function refreshKnown() {
  const words = [...new Set(vocab.map(v => v.word.toLowerCase()).filter(w => /^[\p{L}\p{M}'’-]+$/u.test(w)))];
  knownRe = words.length
    ? new RegExp(`(^|[^\\p{L}\\p{M}])(${words.sort((a, b) => b.length - a.length).map(escRe).join('|')})(?![\\p{L}\\p{M}])`, 'giu')
    : null;
  viewer.querySelectorAll('.textLayer').forEach(markKnownWords);
  viewer.querySelectorAll('.epub-chapter').forEach(markKnownInEpub);
}

function markKnownWords(layer) {
  for (const span of layer.querySelectorAll(':scope > span')) {
    if (span.querySelector('mark')) span.textContent = span.textContent; // back to plain text first
    if (!knownRe) continue;
    const text = span.textContent, matches = knownMatches(text);
    if (!matches.length) continue;
    const parts = [];
    let last = 0;
    for (const m of matches) {
      parts.push(text.slice(last, m.index));
      const mark = document.createElement('mark');
      mark.className = 'known';
      mark.textContent = m.word;
      parts.push(mark);
      last = m.index + m.word.length;
    }
    parts.push(text.slice(last));
    span.replaceChildren(...parts);
  }
}
