// Copies PDF.js and the OCR engine into src/vendor so the app works offline.
import { copyFileSync, cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

const copy = (from, to, files) => {
  mkdirSync(to, { recursive: true });
  for (const f of files) copyFileSync(from + f, to + f);
};

// The legacy build also runs on the older Safari engines of Macs that cannot update past macOS 12 or 13.
copy('node_modules/pdfjs-dist/legacy/build/', 'src/vendor/', ['pdf.min.js', 'pdf.worker.min.js']);
// PDF.js 3 reads right-to-left lines in page order and then reverses them, which also reverses glyphs that stand
// for two letters (Arabic لا، لم...), giving "األساسيات" for "الأساسيات". Newer PDF.js pre-reverses such glyphs;
// do the same here. Fails loudly if a PDF.js update changes this code, so the fix isn't silently lost.
{
  const file = 'src/vendor/pdf.worker.min.js', js = readFileSync(file, 'utf8');
  const from = 'const d=s.unicode;saveLastChar(d)&&u.str.push(" ");u.str.push(d);';
  const to = 'const d=s.unicode.length>1&&/[\\u0590-\\u08FF\\uFB1D-\\uFDFF\\uFE70-\\uFEFF]/.test(s.unicode)?[...s.unicode].reverse().join(""):s.unicode;saveLastChar(d)&&u.str.push(" ");u.str.push(d);';
  if (!js.includes(from)) throw new Error('PDF.js changed: update the right-to-left ligature fix in scripts/vendor.mjs');
  writeFileSync(file, js.replace(from, to));
}
// Character maps and the standard 14 fonts, for PDFs that use fonts they don't carry inside them.
cpSync('node_modules/pdfjs-dist/cmaps/', 'src/vendor/cmaps/', { recursive: true });
cpSync('node_modules/pdfjs-dist/standard_fonts/', 'src/vendor/standard_fonts/', { recursive: true });
copyFileSync('node_modules/fflate/umd/index.js', 'src/vendor/fflate.min.js'); // unzips EPUB books

// OCR for scanned pages: Tesseract, its WebAssembly core, and compact Arabic, English and Turkish models.
copy('node_modules/tesseract.js/dist/', 'src/vendor/tesseract/', ['tesseract.min.js', 'worker.min.js']);
copy('node_modules/tesseract.js-core/', 'src/vendor/tesseract/core/',
  readdirSync('node_modules/tesseract.js-core/').filter(f => /^tesseract-core.*-lstm\.wasm\.js$/.test(f)));
for (const lang of ['ara', 'eng', 'tur']) {
  copy(`node_modules/@tesseract.js-data/${lang}/4.0.0_best_int/`, 'src/vendor/tesseract/lang/', [`${lang}.traineddata.gz`]);
}
console.log('PDF.js and Tesseract copied to src/vendor');
