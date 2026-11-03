// Copies PDF.js and the OCR engine into src/vendor so the app works offline.
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';

const copy = (from, to, files) => {
  mkdirSync(to, { recursive: true });
  for (const f of files) copyFileSync(from + f, to + f);
};

copy('node_modules/pdfjs-dist/build/', 'src/vendor/', ['pdf.min.js', 'pdf.worker.min.js']);

// OCR for scanned pages: Tesseract, its WebAssembly core, and compact Arabic, English and Turkish models.
copy('node_modules/tesseract.js/dist/', 'src/vendor/tesseract/', ['tesseract.min.js', 'worker.min.js']);
copy('node_modules/tesseract.js-core/', 'src/vendor/tesseract/core/',
  readdirSync('node_modules/tesseract.js-core/').filter(f => /^tesseract-core.*-lstm\.wasm\.js$/.test(f)));
for (const lang of ['ara', 'eng', 'tur']) {
  copy(`node_modules/@tesseract.js-data/${lang}/4.0.0_best_int/`, 'src/vendor/tesseract/lang/', [`${lang}.traineddata.gz`]);
}
console.log('PDF.js and Tesseract copied to src/vendor');
