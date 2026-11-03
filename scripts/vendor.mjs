// Copies PDF.js into src/vendor so the app works offline.
import { copyFileSync, mkdirSync } from 'node:fs';

const from = 'node_modules/pdfjs-dist/build/';
const to = 'src/vendor/';
mkdirSync(to, { recursive: true });
for (const f of ['pdf.min.js', 'pdf.worker.min.js']) copyFileSync(from + f, to + f);
console.log('PDF.js copied to src/vendor');
