// The panel tabs, settings dialog, appearance, and starting the app (runs last).

// ---------- UI ----------
// A pill slides under the chosen tab (panel and settings alike), and the new content eases in.
function movePill(bar) {
  const on = bar.querySelector('button.on'), pill = bar.querySelector('.pill') || bar.appendChild(Object.assign(document.createElement('span'), { className: 'pill' }));
  if (!on || !on.offsetWidth) return;
  pill.style.width = on.offsetWidth + 'px';
  pill.style.height = on.offsetHeight + 'px';
  pill.style.transform = `translate(${on.offsetLeft}px, ${on.offsetTop}px)`;
  requestAnimationFrame(() => pill.classList.add('ready')); // no slide on the very first placement
}
const easeIn = el => { el.classList.remove('pane-in'); void el.offsetWidth; el.classList.add('pane-in'); };
// Tabs change width with the language and the counts on them: keep the pill under the chosen one.
const pillWatch = new ResizeObserver(entries => new Set(entries.map(e => e.target.closest('.seg, .set-tabs'))).forEach(movePill));
document.querySelectorAll('.seg button, .set-tabs button').forEach(b => pillWatch.observe(b));

function showTab(name) {
  const before = document.querySelector('.seg button.on')?.dataset.tab;
  document.querySelectorAll('.seg button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  movePill(document.querySelector('.seg'));
  $('#lookup').hidden = name !== 'lookup';
  $('#vocab').hidden = name !== 'vocab';
  $('#toc').hidden = name !== 'toc';
  $('#notes').hidden = name !== 'notes';
  if (name === 'toc') markTocCurrent(true);
  if (name === 'notes') renderNotes();
  if (name === 'vocab' && !reviewQueue) renderVocab();
  if (before && before !== name) easeIn($('#' + name));
}
document.querySelectorAll('.seg button').forEach(b => b.onclick = () => showTab(b.dataset.tab));

const form = $('#settingsForm');
function syncProviderFields() {
  form.querySelector('[data-for="openai"]').hidden = form.provider.value !== 'openai';
  form.querySelectorAll('[data-for="gemini"]').forEach(el => el.hidden = form.provider.value !== 'gemini');
  form.model.placeholder = DEFAULT_MODELS[form.provider.value] || t('autoModel');
  $('#modelField').hidden = form.provider.value === 'gemini';
}
function showSettingsPane(name) {
  document.querySelectorAll('#settings .set-tabs button').forEach(b => { b.classList.toggle('on', b.dataset.pane === name); b.setAttribute('aria-selected', b.dataset.pane === name); });
  document.querySelectorAll('#settings .set-pane').forEach(p => p.hidden = p.dataset.pane !== name);
  movePill(document.querySelector('#settings .set-tabs'));
  easeIn(document.querySelector(`#settings .set-pane[data-pane="${name}"]`));
}
document.querySelectorAll('#settings .set-tabs button').forEach(b => b.onclick = () => showSettingsPane(b.dataset.pane));

function openSettings(pane = 'general') {
  showSettingsPane(pane);
  for (const k of ['uiLang', 'theme', 'provider', 'baseUrl', 'apiKey', 'model']) form[k].value = settings[k] || '';
  form.readTint.value = settings.readTint || 'none';
  form.mcp.checked = !!settings.mcp;
  showUsage();
  $('#backupMsg').hidden = true;
  $('#mcpBox').hidden = $('#connectTab').hidden = !tauri || /Android|iPhone|iPad/.test(navigator.userAgent); // AI desktop apps only
  $('#mcpMsg').hidden = true;
  syncProviderFields();
  $('#settings').showModal();
  movePill(document.querySelector('#settings .set-tabs'));
}
form.provider.onchange = () => { form.model.value = ''; syncProviderFields(); };
$('#settings').addEventListener('close', () => {
  if ($('#settings').returnValue !== 'save') return;
  const uiChanged = form.uiLang.value !== settings.uiLang;
  for (const k of ['uiLang', 'theme', 'provider', 'baseUrl', 'apiKey', 'model']) settings[k] = form[k].value.trim();
  settings.readTint = form.readTint.value;
  applyTint();
  setSharing(form.mcp.checked);
  store.set('settings', settings);
  applyTheme();
  if (uiChanged) {
    applyUiLanguage();
    if (lastLookup) lookup(lastLookup.word, lastLookup.sentence); // redraw the open word's labels
  }
});
$('#settingsBtn').onclick = () => openSettings();
$('#tourAgain').onclick = () => { $('#settings').close('cancel'); openSetup(true); };
$('#setupFromSettings').onclick = () => { $('#settings').close('cancel'); openSetup(); };

// ---------- Appearance ----------
const systemDark = matchMedia('(prefers-color-scheme: dark)');
const isDark = () => settings.theme === 'dark' || (settings.theme === 'system' && systemDark.matches);

let pagesDark = null; // the theme the open book's pages were drawn in
function applyTheme() {
  if (settings.theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = settings.theme;
  $('#themeBtn').innerHTML = icon(isDark() ? 'sun' : 'moon');
  if (pagesDark !== null && pagesDark !== isDark()) recolorPages(); // the pages in the new colours
  pagesDark = isDark();
}
// The quick toggle picks the opposite of what's on screen and keeps it, whatever the system does later.
// Light and dark: the whole window crossfades. Engines without view transitions ease the colours instead.
$('#themeBtn').onclick = () => {
  settings.theme = isDark() ? 'light' : 'dark';
  store.set('settings', settings);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { applyTheme(); return; }
  // The update itself is instant (pages look right at once through recolorPages' stand-in), so the
  // crossfade never waits on drawing, which browsers pause while it runs.
  if (document.startViewTransition) {
    const vt = document.startViewTransition(applyTheme);
    vt.ready.catch(() => {}); // a quick second click skips the first crossfade; that's fine
    return;
  }
  document.documentElement.classList.add('theme-ease');
  applyTheme();
  setTimeout(() => document.documentElement.classList.remove('theme-ease'), 450);
};
systemDark.addEventListener('change', applyTheme);

function applyUiLanguage() {
  document.documentElement.lang = settings.uiLang;
  document.documentElement.dir = LANGS[settings.uiLang].dir;
  document.title = t('title');
  document.querySelectorAll('[data-i18n]').forEach(el => el.innerHTML = t(el.dataset.i18n));
  document.querySelectorAll('[data-i18n-ph]').forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.dataset.i18nTitle);
    el.setAttribute('aria-label', el.title);
  });
  showBookLang();
  if (!$('#vocab').hidden && !reviewQueue) renderVocab();
  if (!pdfDoc) $('#toc').innerHTML = stateCard('list', t('noBook'));
  $('#searchInput').placeholder = t('searchPh');
  renderLangPicks();
  showVersion();
  renderRecent();
}

// The same choice as App language in Settings, one click away on the first screens.
const LANG_NAMES = { ar: 'العربية', en: 'English', tr: 'Türkçe' };
function renderLangPicks() {
  document.querySelectorAll('[data-lang-pick]').forEach(el => {
    el.innerHTML = icon('globe') + Object.keys(LANG_NAMES).map(l =>
      `<button type="button" lang="${l}" dir="${LANGS[l].dir}" data-l="${l}" class="${l === settings.uiLang ? 'on' : ''}" aria-pressed="${l === settings.uiLang}">${LANG_NAMES[l]}</button>`).join('');
    el.setAttribute('aria-label', t('uiLang'));
  });
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-lang-pick] button');
  if (!b || b.dataset.l === settings.uiLang) return;
  settings.uiLang = b.dataset.l;
  store.set('settings', settings);
  applyUiLanguage();
  if (lastLookup) lookup(lastLookup.word, lastLookup.sentence);
});

const target = $('#target');
target.value = settings.lang;
target.onchange = () => {
  settings.lang = target.value;
  store.set('settings', settings);
  if (lastLookup) lookup(lastLookup.word, lastLookup.sentence); // show the open word in the new language
};
applyTheme();
applyUiLanguage();
updateVocabCount();
refreshKnown();
// New readers get the tour once; people who already have a key, or chose Later before, don't.
if (!settings.apiKey && settings.provider === 'gemini' && !store.get('setupSkipped', false)) openSetup(!store.get('toured', false));

// Books the OS asked us to open (double-clicked in Finder or Explorer, or "Open with Siyaq"). Last, so the
// reply can't arrive before the code that opens books has loaded.
if (tauri) {
  tauri.event.listen('open-file', () => tauri.core.invoke('take_pending_file').then(openFromOS));
  tauri.core.invoke('take_pending_file').then(openFromOS);
}
movePill(document.querySelector('.seg'));
