// Reading scanned pages on the device (OCR).

// ---------- Scanned pages (OCR) ----------
const ocrCache = new Map(); // page number → lines of words, positioned in page units (scale 1)
let ocrWorker = null, ocrChain = Promise.resolve();

function ocrWorkerReady() {
  ocrWorker ??= Tesseract.createWorker(['eng', 'ara', 'tur'], 1, {
    workerPath: 'vendor/tesseract/worker.min.js',
    corePath: 'vendor/tesseract/core',
    langPath: 'vendor/tesseract/lang',
    gzip: true,
    cacheMethod: 'none',
    workerBlobURL: false,
  });
  return ocrWorker;
}

async function imageCoverage(page) {
  const vp = page.getViewport({ scale: 1 });
  const area = (await imageBoxes(page, vp, 1)).reduce((sum, [, , w, h]) => sum + w * h, 0);
  return area / (vp.width * vp.height);
}

// Pages are read one at a time, in the order they come into view.
function queueOcr(div, canvas, layer) {
  const n = +div.dataset.page;
  if (ocrCache.has(n)) { buildOcrLayer(layer, ocrCache.get(n), scale); return; }
  const badge = document.createElement('div');
  badge.className = 'ocr-badge';
  badge.textContent = t('ocrRunning');
  div.appendChild(badge);
  ocrChain = ocrChain.then(async () => {
    try {
      if (!canvas.isConnected) return; // zoomed or scrolled away: read again when it's drawn again
      const worker = await ocrWorkerReady();
      const { data } = await worker.recognize(canvas, {}, { blocks: true, text: true });
      const k = canvas.width / +div.dataset.w; // canvas pixels per page unit
      const lines = [];
      for (const block of data.blocks || []) for (const para of block.paragraphs) for (const line of para.lines) {
        const words = line.words
          // Unsure guesses are usually bits of pictures; the engine also adds invisible direction marks.
          .filter(w => w.confidence > 55)
          .map(w => ({ ...w, text: w.text.replace(/[\u200e\u200f\u202a-\u202e]/g, '').trim() }))
          .filter(w => /[\p{L}\p{N}]/u.test(w.text))
          .map(w => ({ text: w.text, x: w.bbox.x0 / k, y: w.bbox.y0 / k, w: (w.bbox.x1 - w.bbox.x0) / k, h: (w.bbox.y1 - w.bbox.y0) / k }));
        // Reading order: right to left for Arabic lines.
        const rtl = /[؀-ۿ]/.test(words.map(w => w.text).join(''));
        words.sort((a, b) => rtl ? b.x - a.x : a.x - b.x);
        if (words.length) lines.push(words);
      }
      ocrCache.set(n, lines);
      queueBookShare(8000);
      pageTexts.delete(n);
      if (!bookLang) {
        bookLang = detectLanguage(lines.flat().map(w => w.text).join(' '));
        showBookLang();
      }
      if (layer.isConnected) buildOcrLayer(layer, lines, scale);
    } catch (err) {
      console.error('OCR failed', err);
    } finally {
      badge.remove();
    }
  });
}

// Invisible, clickable words placed over the picture, like the text layer of a normal page.
function buildOcrLayer(layer, lines, s) {
  layer.replaceChildren();
  const placed = [];
  for (const words of lines) {
    words.forEach((w, i) => {
      const span = document.createElement('span');
      span.textContent = w.text + (i < words.length - 1 ? ' ' : '');
      Object.assign(span.style, { left: w.x * s + 'px', top: w.y * s + 'px', fontSize: w.h * s * 0.9 + 'px', fontFamily: 'sans-serif' });
      layer.appendChild(span);
      placed.push([span, w.w * s]);
    });
    layer.appendChild(document.createElement('br'));
  }
  for (const [span, width] of placed) {
    const natural = span.getBoundingClientRect().width;
    if (natural) span.style.transform = `scaleX(${width / natural})`;
  }
  highlightSearch(layer.parentElement);
}
