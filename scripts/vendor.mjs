// Copies PDF.js and the OCR engine into src/vendor so the app works offline.
import { copyFileSync, cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

const copy = (from, to, files) => {
  mkdirSync(to, { recursive: true });
  for (const f of files) copyFileSync(from + f, to + f);
};

// PDF.js (ES modules), with what it fetches on demand: character maps and the standard 14 fonts (for PDFs that
// don't carry their fonts), colour profiles, and the decoders for JPEG 2000 and JBIG2 images (WebAssembly).
mkdirSync('src/vendor/pdfjs', { recursive: true });
copy('node_modules/pdfjs-dist/build/', 'src/vendor/pdfjs/', ['pdf.min.mjs', 'pdf.worker.min.mjs']);
for (const dir of ['cmaps', 'standard_fonts', 'iccs', 'wasm']) cpSync(`node_modules/pdfjs-dist/${dir}/`, `src/vendor/pdfjs/${dir}/`, { recursive: true });

// PDF.js reads a right-to-left line in page order and then reverses it, which also reverses glyphs that stand for
// two letters (Arabic لا، لأ، لم...): "الأمر" came out as "األمر". Pre-reverse such glyphs so the final reversal
// puts them right. Fails loudly if a PDF.js update changes this code, so the fix isn't silently lost.
{
  const file = 'src/vendor/pdfjs/pdf.worker.min.mjs', js = readFileSync(file, 'utf8');
  const from = 'const d=o.unicode;if(saveLastChar(d))';
  const to = 'const d=o.unicode.length>1&&/[\\u0590-\\u08FF\\uFB1D-\\uFDFF\\uFE70-\\uFEFF]/.test(o.unicode)?[...o.unicode].reverse().join(""):o.unicode;if(saveLastChar(d))';
  if (js.split(from).length !== 2) throw new Error('PDF.js changed: update the right-to-left ligature fix in scripts/vendor.mjs');
  writeFileSync(file, js.replace(from, to));
}
copyFileSync('node_modules/fflate/umd/index.js', 'src/vendor/fflate.min.js'); // unzips EPUB books; zips saved images and Word files
copyFileSync('node_modules/pdf-lib/dist/pdf-lib.min.js', 'src/vendor/pdf-lib.min.js'); // saves a book with your marks on it

// OCR for scanned pages: Tesseract, its WebAssembly core, and compact Arabic, English and Turkish models.
copy('node_modules/tesseract.js/dist/', 'src/vendor/tesseract/', ['tesseract.min.js', 'worker.min.js']);
copy('node_modules/tesseract.js-core/', 'src/vendor/tesseract/core/',
  readdirSync('node_modules/tesseract.js-core/').filter(f => /^tesseract-core.*-lstm\.wasm\.js$/.test(f)));
for (const lang of ['ara', 'eng', 'tur']) {
  copy(`node_modules/@tesseract.js-data/${lang}/4.0.0_best_int/`, 'src/vendor/tesseract/lang/', [`${lang}.traineddata.gz`]);
}
console.log('PDF.js, fflate, pdf-lib and Tesseract copied to src/vendor');
