// Backup, today's use, feedback, the welcome tour and key setup, updates.

// ---------- Backup ----------
// One file with My words (and their review progress), reading positions, recent books and settings.
// The API key is left out on purpose: it is a secret, and easy to paste again.
async function saveText(name, text, type) {
  if (desktopApp) return tauri.core.invoke('save_file', { name, contents: text });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
  return name;
}
const backupMessage = (text, error = false) => { const el = $('#backupMsg'); el.textContent = text; el.classList.toggle('error', error); el.hidden = false; };

$('#backupSave').onclick = async () => {
  const { apiKey, ...safeSettings } = settings;
  const data = { app: 'siyaq', format: 1, version: await appVersion(), exported: new Date().toISOString(),
    settings: safeSettings, vocab, positions: store.get('positions', {}), library: library(), highlights };
  try {
    const where = await saveText(`siyaq-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 1), 'application/json');
    if (where) backupMessage(t('backupSaved')(vocab.length));
  } catch (err) { backupMessage(String(err), true); }
};

function restoreBackup(text) {
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  if (data?.app !== 'siyaq' || !Array.isArray(data.vocab)) { backupMessage(t('backupBad'), true); return; }
  // Words: keep both sides; for the same word in the same sentence, keep the one further along in review.
  const key = v => v.word.toLowerCase() + '|' + v.sentence;
  const merged = new Map(vocab.map(v => [key(v), v]));
  let added = 0;
  for (const v of data.vocab.filter(v => v?.word)) {
    const had = merged.get(key(v));
    if (!had) added++;
    if (!had || (v.box || 0) > (had.box || 0)) merged.set(key(v), v);
  }
  vocab = [...merged.values()].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  store.set('vocab', vocab);
  const positions = store.get('positions', {});
  for (const [k, p] of Object.entries(data.positions || {})) if (!positions[k] || p.at > positions[k].at) positions[k] = p;
  store.set('positions', positions);
  for (const [k, list] of Object.entries(data.highlights || {})) {
    const ids = new Set((highlights[k] || []).map(h => h.id));
    highlights[k] = [...(highlights[k] || []), ...list.filter(h => !ids.has(h.id))];
  }
  store.set('highlights', highlights);
  const paths = new Set(library().map(b => b.path));
  store.set('library', [...library(), ...(data.library || []).filter(b => !paths.has(b.path))].slice(0, 12));
  const { apiKey, ...restored } = data.settings || {};
  Object.assign(settings, restored);
  store.set('settings', settings);
  for (const k of ['uiLang', 'theme']) form[k].value = settings[k];
  applyTheme();
  applyUiLanguage();
  target.value = settings.lang;
  updateVocabCount();
  refreshKnown();
  renderRecent();
  backupMessage(t('backupRestored')(added));
}

$('#backupLoad').onclick = async () => {
  if (!desktopApp) { $('#backupFile').click(); return; }
  const path = await tauri.core.invoke('pick_file', { label: t('backupTitle'), extensions: ['json'] }).catch(() => null);
  if (!path) return;
  try { restoreBackup(new TextDecoder().decode(new Uint8Array(await tauri.core.invoke('read_book', { path })))); }
  catch (err) { backupMessage(String(err), true); }
};
$('#backupFile').onchange = async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (f) restoreBackup(await f.text());
};

// ---------- Today's AI use ----------
// Counted on this device: providers don't tell apps how much free quota is left.
function countUse(kind) {
  const day = new Date().toISOString().slice(0, 10);
  const u = store.get('usage', {});
  const today = u.day === day ? u : { day, words: 0, asks: 0 };
  today[kind]++;
  store.set('usage', today);
}
function showUsage() {
  const u = store.get('usage', {}), today = u.day === new Date().toISOString().slice(0, 10) ? u : { words: 0, asks: 0 };
  $('#usageLine').textContent = t('usageToday')(today.words, today.asks);
}
$('#limitsLink').onclick = e => { e.preventDefault(); openLink('https://ai.google.dev/gemini-api/docs/rate-limits'); };

// ---------- Feedback ----------
// Problems and ideas go to GitHub Issues (forms in .github/ISSUE_TEMPLATE), or by email for people without GitHub.
const REPO = 'https://github.com/SaadHASSON1/siyaq', CONTACT = 'contact@x13labs.com';
const systemName = () => /Android/.test(navigator.userAgent) ? 'Android' : /Mac/.test(navigator.platform) ? 'macOS'
  : /Win/.test(navigator.platform) ? 'Windows' : /Linux/.test(navigator.platform) ? 'Linux' : navigator.platform;
const appVersion = async () => tauri ? await tauri.app.getVersion().catch(() => '') : 'web';

async function reportProblem(what = '') {
  openLink(`${REPO}/issues/new?template=bug.yml&version=${encodeURIComponent(await appVersion())}&system=${encodeURIComponent(systemName() + ' · ' + navigator.userAgent)}${what ? '&what=' + encodeURIComponent(what) : ''}`);
}
$('#fbBug').onclick = () => reportProblem();
$('#fbIdea').onclick = async () => openLink(`${REPO}/issues/new?template=feature.yml&version=${encodeURIComponent(await appVersion())}`);
$('#fbMail').onclick = async () => openLink(`mailto:${CONTACT}?subject=${encodeURIComponent('Siyaq ' + await appVersion())}&body=${encodeURIComponent(`\n\n—\nSiyaq ${await appVersion()} · ${systemName()}`)}`);

// ---------- First-run setup ----------
const AI_STUDIO = 'https://aistudio.google.com/apikey';

const SLIDES = [...document.querySelectorAll('#setup .slide')].map(s => s.dataset.slide);
let slide = 0, tourFull = false; // tourFull: started from the welcome, not straight at the key

function showSlide(n, back = false) {
  slide = Math.max(0, Math.min(n, SLIDES.length - 1));
  const name = SLIDES[slide];
  document.querySelectorAll('#setup .slide').forEach((s, i) => { s.classList.toggle('on', i === slide); s.classList.toggle('back', back); });
  const part = name === 'key' ? 'key' : name === 'done' ? 'done' : 'intro';
  document.querySelectorAll('#setup .tour-btns').forEach(b => b.hidden = b.dataset.for !== part);
  $('#tourBack').style.visibility = slide ? '' : 'hidden';
  $('#tourSkip').hidden = part !== 'intro';
  $('#tourDots').innerHTML = SLIDES.map((_, i) => `<span class="${i === slide ? 'on' : ''}"></span>`).join('');
  $('#tourDots').hidden = !tourFull;
  if (name === 'key') setTimeout(() => $('#setupKey').focus(), 50);
}

// The whole tour for a new reader; straight to the key from Settings or a lookup without one.
function openSetup(full = false) {
  tourFull = full;
  $('#setupKey').value = settings.apiKey || '';
  $('#setupMsg').className = 'msg';
  $('#setupMsg').textContent = '';
  $('#tourMcpNote').hidden = !tauri || /Android|iPhone|iPad/.test(navigator.userAgent);
  showSlide(full ? 0 : SLIDES.indexOf('key'));
  if (!$('#setup').open) $('#setup').showModal();
}

$('#tourNext').onclick = () => showSlide(slide + 1);
$('#tourBack').onclick = () => showSlide(slide - 1, true);
$('#tourSkip').onclick = () => showSlide(SLIDES.indexOf('key'));
$('#setup').addEventListener('keydown', e => {
  if (e.target.matches('input, textarea') || SLIDES[slide] === 'key') return;
  const forward = (e.key === 'ArrowRight') !== (document.dir === 'rtl');
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') showSlide(slide + (forward ? 1 : -1), !forward);
});
$('#setup').addEventListener('close', () => store.set('toured', true));
$('#setup').querySelector('.file-input').addEventListener('change', () => $('#setup').close());

async function openLink(url) {
  if (tauri) await tauri.core.invoke('open_link', { url });
  else window.open(url, '_blank', 'noopener');
}

$('#setupOpen').onclick = () => openLink(AI_STUDIO);
$('#setupLater').onclick = () => { store.set('setupSkipped', true); $('#setup').close(); };
$('#setupOther').onclick = () => { $('#setup').close(); openSettings('ai'); };
$('#setupKey').addEventListener('keydown', e => { if (e.key === 'Enter') $('#setupSave').click(); });
$('#setupSave').onclick = async () => {
  const key = $('#setupKey').value.trim(), msg = $('#setupMsg');
  if (!key) { $('#setupKey').focus(); return; }
  msg.className = 'msg';
  msg.textContent = t('setupChecking');
  try {
    const r = await requestJson('GET', GEMINI + 'models?pageSize=1', { 'x-goog-api-key': key });
    if (!r.ok) throw new Error(r.json?.error?.message || r.status);
    Object.assign(settings, { provider: 'gemini', apiKey: key });
    store.set('settings', settings);
    geminiModels = null;
    msg.className = 'msg ok';
    msg.textContent = t('setupOk');
    setTimeout(() => {
      if (tourFull) { showSlide(SLIDES.indexOf('done')); return; }
      $('#setup').close();
      if (lastLookup) lookup(lastLookup.word, lastLookup.sentence);
    }, 900);
  } catch (err) {
    msg.className = 'msg err';
    msg.textContent = t('setupBad') + err.message;
  }
};

// ---------- Version and updates ----------
function showVersion() {
  document.querySelectorAll('[data-version]').forEach(el => { if (el.dataset.v) el.textContent = t('versionLabel')(el.dataset.v); });
}
appVersion().then(v => {
  if (!v || v === 'web') return;
  document.querySelectorAll('[data-version]').forEach(el => el.dataset.v = v);
  showVersion();
});

// Installs the update; `say` shows how it goes (a toast, or the line in Settings).
async function installUpdate(say = text => showToast(text)) {
  say(t('updating'));
  try { await tauri.core.invoke('install_update'); } catch (err) { say(t('updateFailed') + err, 'error'); }
}
// An update found on its own, while reading: offered at the bottom of the window.
function offerUpdate(version) {
  showToast(t('updateAvail')(version), { label: t('updateNow'), run: () => installUpdate() });
}

// On its own a few seconds after starting (installed app only), and from Settings whenever asked.
if (tauri) setTimeout(async () => {
  try {
    const version = await tauri.core.invoke('check_update');
    if (version) offerUpdate(version);
  } catch {} // offline, or no releases yet
}, 3000);

$('#updateCheck').onclick = async () => {
  const msg = $('#updateMsg'), say = (text, cls = '') => { msg.textContent = text; msg.className = 'update-msg ' + cls; msg.hidden = false; };
  // Phones update from their app store; the web version is always the latest.
  if (!tauri || /Android|iPhone|iPad/.test(navigator.userAgent)) { say(t('updateNone'), 'ok'); return; }
  say(t('updateChecking'));
  try {
    const version = await tauri.core.invoke('check_update');
    if (!version) { say(t('updateNone'), 'ok'); return; }
    // Asked for here: the answer stays here, with its button, and Settings stays open.
    say(t('updateAvail')(version), 'ok');
    const btn = Object.assign(document.createElement('button'), { type: 'button', className: 'btn small primary', id: 'updateNowBtn', textContent: t('updateNow') });
    btn.onclick = () => { btn.remove(); installUpdate(say); };
    msg.append(' ', btn);
  } catch (err) {
    say(t('updateCheckFailed') + err, 'error');
  }
};
