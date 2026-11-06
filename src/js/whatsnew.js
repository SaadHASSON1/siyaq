// What's new: after an update, a small window with what changed, in the reader's language, once.
// Every release adds its entry at the top (all three languages), before it is tagged.

const CHANGES = [
  { version: '0.7.5', ar: [
    'هالشباك: بعد كل تحديث بيطلعلك شو انصلح وشو الجديد.',
  ], en: [
    'This window: after every update, what was fixed and what is new.',
  ], tr: [
    'Bu pencere: her güncellemeden sonra neyin düzeltildiği ve neyin yeni olduğu.',
  ] },
  { version: '0.7.4', ar: [
    'التكبير والتصغير صار ناعم: الصفحة ما بتفضى ولا بتنعاد من أولها، بتضل ظاهرة لحد ما تجهز بالحجم الجديد.',
    'شريط بيورجيك قديش باقي لينتهي تنزيل التحديث وتثبيته، بالإعدادات وبالإشعار.',
  ], en: [
    'Smoother zooming: the page no longer goes blank and redraws from nothing; it stays on screen until it is ready at the new size.',
    'A progress bar shows how much of an update is left to download and install, in Settings and in the notice.',
  ], tr: [
    'Daha akıcı yakınlaştırma: sayfa artık boşalıp baştan çizilmiyor; yeni boyutta hazır olana kadar ekranda kalıyor.',
    'Bir ilerleme çubuğu, güncellemenin indirilmesi ve yüklenmesi için ne kadar kaldığını gösteriyor (Ayarlar’da ve bildirimde).',
  ] },
  { version: '0.7.3', ar: [
    'حركات التراك باد: قرصة الإصبعين للتكبير والتصغير حوالين أصابعك، وسحبة بإصبعين لتقليب الصفحة.',
    'الأسهم ← → بتقلّب الصفحات، وبالكتب العربية الصفحة الجاية على اليسار.',
    'أي تكبير بيضل على نفس المكان اللي عم تقراه.',
  ], en: [
    'Trackpad gestures: pinch to zoom around your fingers, swipe with two fingers to turn the page.',
    'The ← → keys turn pages; in Arabic books the next page is to the left.',
    'Every zoom keeps the spot you are reading in view.',
  ], tr: [
    'Dokunmatik yüzey hareketleri: parmaklarınızın etrafında yakınlaştırmak için iki parmakla sıkıştırın, sayfa çevirmek için iki parmakla kaydırın.',
    '← → tuşları sayfa çevirir; Arapça kitaplarda sonraki sayfa soldadır.',
    'Her yakınlaştırma okuduğunuz yeri ekranda tutar.',
  ] },
  { version: '0.7.1', ar: [
    'التحديد بالماوس على صفحات PDF صار شريط واحد متساوي لكل سطر، بكل اللغات.',
  ], en: [
    'Selecting text on PDF pages now shows one even bar per line, in every language.',
  ], tr: [
    'PDF sayfalarında metin seçimi artık her dilde satır başına tek düzgün bir şerit olarak görünüyor.',
  ] },
  { version: '0.7.0', ar: [
    'اكتب وارسم على صفحات PDF: قلم بأربع ألوان، ونص بأي مكان بالصفحة، وممحاة، وتراجع.',
    'حفظ باسم: PDF مع تظليلك وكتابتك ورسمك وملاحظاتك، أو صور، أو Word، أو نص.',
    'ما عاد في خط أخضر تحت الكلمات المحفوظة.',
  ], en: [
    'Write and draw on PDF pages: a pen in four colours, text anywhere on the page, an eraser and undo.',
    'Save as: PDF with your highlights, writing, drawings and notes, or images, Word or text.',
    'No more green line under saved words.',
  ], tr: [
    'PDF sayfalarına yazın ve çizin: dört renkli kalem, sayfanın her yerine metin, silgi ve geri alma.',
    'Farklı kaydet: vurgularınız, yazılarınız, çizimleriniz ve notlarınızla PDF; ya da görseller, Word veya metin.',
    'Kaydedilen kelimelerin altındaki yeşil çizgi kaldırıldı.',
  ] },
];

const versionParts = v => String(v).split('.').map(n => parseInt(n, 10) || 0);
const newerThan = (a, b) => { const x = versionParts(a), y = versionParts(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };

// The window, for the versions after `since` up to `now` (the three latest, at most).
function showWhatsNew(now, since = null) {
  const lang = settings.uiLang, list = CHANGES.filter(c => !newerThan(c.version, now) && (!since || newerThan(c.version, since))).slice(0, 3);
  if (!list.length) return false;
  const dlg = $('#whatsNew');
  dlg.querySelector('.wn-body').innerHTML = list.map((c, k) => `<section>
    ${list.length > 1 || k ? `<h4>${esc(t('versionLabel')(c.version))}</h4>` : ''}
    <ul>${(c[lang] || c.en).map(item => `<li>${esc(item)}</li>`).join('')}</ul></section>`).join('');
  dlg.querySelector('h3').textContent = t('whatsNewTitle')(list[0].version);
  if (!dlg.open) dlg.showModal();
  return true;
}
$('#whatsNewOk').onclick = () => $('#whatsNew').close();
$('#whatsNewBtn').onclick = async () => { $('#settings').close('cancel'); showWhatsNew(await appVersion() || CHANGES[0].version); };

// After starting: if this is a newer version than the last one seen here, say what changed (not on a first run:
// the tour does that). The version is noted either way.
appVersion().then(now => {
  if (!now || now === 'web') return;
  const seen = store.get('seenVersion', null);
  store.set('seenVersion', now);
  const upgraded = seen ? newerThan(now, seen) : store.get('toured', false); // from before this window existed
  if (!upgraded) return;
  // (updating from a version before this window: just this version's news)
  const show = () => (document.querySelector('dialog[open]') ? setTimeout(show, 1500) : showWhatsNew(now, seen || CHANGES[1]?.version));
  setTimeout(show, 900);
});
