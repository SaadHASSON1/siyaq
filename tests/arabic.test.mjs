// Arabic, checked word by word. PDFs are made from known text, opened in the app, and every word the app reads
// (in reading order) must match the original, diacritics and all; a click on each word must give that word back.
//  - Undiacritised text, in PDFs printed by Chrome (every system, CI included).
//  - Fully diacritised text, in PDFs written by Core Text as Pages and TextEdit do (Macs). Chrome's PDFs are not
//    used for diacritics: they leave some marks without their text (Apple's own PDFKit can't read them either).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve } from './browser.mjs';

const PLAIN = [
  // the definite article and joined letters (لا، لأ، لإ، لآ، لم)
  'الأمر اللي بيطبع على الشاشة هو أول شيء نتعلمه، ولا يحتاج إلى شرح طويل.',
  'لأن الإنسان لا يتعلم إلا بالممارسة، فإن الآن هو الوقت المناسب للبدء.',
  // numbers (Arabic-Indic and Latin), Arabic punctuation, a question
  'وُلد الشاعر سنة ١٩٢٣ وتوفي سنة 1998؛ فكم عاش؟',
  // English and code inside Arabic
  'يستخدم المبرمجون لغة Python كثيراً، ويكتبون print لطباعة النص.',
  // a long paragraph, justified when printed
  'كانت المدينة القديمة تمتد على ضفتي النهر، وكانت أسواقها تعج بالتجار القادمين من البلاد البعيدة، يحملون معهم البضائع والحكايات، فيجلس الناس في المقاهي يستمعون إليهم حتى ساعة متأخرة من الليل، ثم يعودون إلى بيوتهم وقد امتلأت رؤوسهم بالأحلام.',
];
const VOWELLED = [
  // fatha, damma, kasra, shadda, sukun, tanwin, and a vowel on lam-alef
  'إِنَّ الْعِلْمَ نُورٌ، وَالْجَهْلَ ظَلَامٌ.',
  'قَالَ الْمُعَلِّمُ لِلطُّلَّابِ: اقْرَؤُوا الْكِتَابَ بِتَمَعُّنٍ، فَإِنَّ الْقِرَاءَةَ غِذَاءُ الْعُقُولِ.',
  'وَلَا تَحْسَبَنَّ الَّذِينَ قُتِلُوا فِي سَبِيلِ اللَّهِ أَمْوَاتًا، بَلْ أَحْيَاءٌ عِنْدَ رَبِّهِمْ يُرْزَقُونَ.',
  'سَافَرْتُ إِلَى مَدِينَةٍ جَمِيلَةٍ، وَرَأَيْتُ فِيهَا كِتَاباً قَدِيماً.',
];
const CHROME_FONTS = ['Geeza Pro', 'Times New Roman', 'Arial', 'Noto Naskh Arabic', 'Noto Sans Arabic', 'DejaVu Sans'];
// Not Al Nile or Mishafi: their files lose letters, so no reader gets them back (Apple's PDFKit reads the same).
// Al Nile writes its "في" shape as just "ف" ("وتوف"); Mishafi records a shadda as the digit 6 ("إِن6").
const CORETEXT_FONTS = ['Geeza Pro', 'Times New Roman', 'Arial', 'Baghdad', 'Damascus', 'KufiStandardGK', 'Farah'];

// Words as a reader sees them: Unicode-normalised, punctuation around each word dropped.
const words = text => text.normalize('NFKC').split(/\s+/).map(w => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}\p{M}]+$/gu, '')).filter(Boolean);
const chromeHtml = (font, paras) => `<html dir="rtl" lang="ar"><head><meta charset="utf-8"><style>
  body { font: 16pt "${font}", serif; margin: 50px; } p:last-child { text-align: justify; }</style></head>
  <body>${paras.map(p => `<p>${p}</p>`).join('')}</body></html>`;

let page, server, coreText = false;
const books = {};
before(async () => {
  page = await launch();
  await page.size(1200, 900);
  for (const font of CHROME_FONTS) books[`/chrome/${font.replace(/ /g, '-')}.pdf`] = await page.pdf(chromeHtml(font, PLAIN));
  if (process.platform === 'darwin') {
    const dir = mkdtempSync(join(tmpdir(), 'siyaq-ar-')), tool = fileURLToPath(new URL('./tools/coretext-pdf.swift', import.meta.url));
    try {
      for (const font of CORETEXT_FONTS) {
        const file = join(dir, font.replace(/ /g, '-') + '.pdf');
        execFileSync('swift', [tool, file, font, ...PLAIN, ...VOWELLED], { stdio: 'ignore' });
        books[`/coretext/${font.replace(/ /g, '-')}.pdf`] = readFileSync(file);
      }
      coreText = true;
    } catch {} // no Swift: the diacritics tests are skipped
  }
  server = await serve(fileURLToPath(new URL('../src/', import.meta.url)), books);
  await page.open(server.url, { toured: true, settings: { uiLang: 'ar', lang: 'en', apiKey: 'x' } });
});
after(() => { page?.close(); server?.close(); });

async function check(path, paragraphs) {
  await page.eval(`await openBook(new Uint8Array(await (await fetch(${JSON.stringify(path)})).arrayBuffer()), 'ar.pdf')`);
  await page.waitFor(`document.querySelector('.page[data-page="1"] .textLayer span')`);
  await page.waitFor(`[...document.querySelectorAll('.page')].every(p => p.querySelector('.textLayer[data-ready]'))`);
  // Everything the app reads, line by line, in reading order.
  const read = await page.eval(`[...document.querySelectorAll('.textLayer')].flatMap(l => textLines(l).map(x => x.text)).join(' ')`);
  const want = paragraphs.flatMap(words), got = words(read);
  const first = want.findIndex((w, i) => w !== got[i]);
  assert.equal(first, -1, `word ${first}: expected «${want[first]}», read «${got[first]}»\n   read: …${got.slice(Math.max(0, first - 3), first + 4).join(' ')}…`);
  assert.equal(got.length, want.length, 'the same number of words');
  // A click in the middle of each word gives back that word.
  const clicked = await page.eval(`(() => { const out = [];
    for (const layer of document.querySelectorAll('.textLayer')) for (const line of textLines(layer)) {
      for (const m of line.text.matchAll(/\\S+/g)) {
        const mid = m.index + Math.floor(m[0].length / 2);
        const span = line.spans.filter(sp => line.starts.get(sp) <= mid).at(-1);
        if (!span || !span.textContent.trim()) continue;
        let at = 0;
        while (at < span.textContent.length && line.starts.get(span) + plainAt(span.textContent, at + 1) <= mid) at++;
        out.push([m[0], wordAt(span, at)]);
      } }
    return out; })()`);
  const wrong = clicked.filter(([seen, picked]) => words(seen)[0] && words(seen)[0] !== words(picked)[0]);
  assert.deepEqual(wrong.slice(0, 5), [], `${wrong.length} of ${clicked.length} clicked words came back wrong`);
}

for (const font of CHROME_FONTS) {
  test(`Arabic in ${font} (printed by Chrome): every word, in order`, () => check(`/chrome/${font.replace(/ /g, '-')}.pdf`, PLAIN));
}
for (const font of CORETEXT_FONTS) {
  test(`Arabic with full diacritics in ${font} (Core Text, as Pages writes): every word and mark`, async t => {
    if (!coreText) { t.skip('needs macOS with Swift'); return; }
    await check(`/coretext/${font.replace(/ /g, '-')}.pdf`, [...PLAIN, ...VOWELLED]);
  });
}
