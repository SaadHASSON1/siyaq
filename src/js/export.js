// Save as: the open PDF in other formats, with everything added to it (highlights, notes, writing, drawings).
//  - PDF: the original pages untouched (their text stays selectable), with the marks laid over them, and each note
//    as a sticky note any PDF reader opens.
//  - Images: every page as a PNG, in a ZIP.
//  - Word: the book's text page by page, highlights in their colours, notes and writing after each page; a page
//    with drawings also gets a picture of it.
//  - Text (Markdown): the text with ==highlights==, notes and writing.

// Saves bytes to a file the user picks (desktop), or downloads them (browser): where it went, or null.
async function saveBytes(name, bytes, type) {
  // (Android's bridge to the app carries text only: the bytes go as base64.)
  if (onAndroid) return tauri.core.invoke('save_base64', { name, data: new Uint8Array(bytes.buffer ?? bytes, bytes.byteOffset ?? 0, bytes.byteLength).toBase64() });
  if (nativeFiles) return tauri.core.invoke('save_bytes', bytes, { headers: { 'x-name': encodeURIComponent(name) } });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return name;
}

const HL_RGBA = { yellow: 'rgba(250, 204, 21, .4)', green: 'rgba(34, 197, 94, .32)', blue: 'rgba(59, 130, 246, .3)', pink: 'rgba(236, 72, 153, .28)' };
const HL_RGB = { yellow: [0.98, 0.8, 0.08], green: [0.13, 0.77, 0.37], blue: [0.23, 0.51, 0.96], pink: [0.93, 0.28, 0.6] };
const HL_WORD = { yellow: 'yellow', green: 'green', blue: 'cyan', pink: 'magenta' };
const baseName = () => bookName.replace(/\.(pdf|epub)$/i, '') || 'book';
const marksOn = n => ({ hls: bookHighlights().flatMap(h => (h.parts || []).filter(p => p.page === n).map(p => [h, p])), inks: bookInks().filter(i => i.page === n) });
const hasMarks = n => { const m = marksOn(n); return m.hls.length + m.inks.length > 0; };

// The marks of page n drawn on a canvas context `w`×`h` (the page at 100%, times k).
function paintMarks(ctx, n, w, h, k) {
  const { hls, inks: list } = marksOn(n);
  for (const [hl, p] of hls) {
    ctx.fillStyle = HL_RGBA[hl.color] || HL_RGBA.yellow;
    for (const [x, y, rw, rh] of p.rects) ctx.fillRect(x * w * k, y * h * k, rw * w * k, rh * h * k);
  }
  ctx.lineCap = ctx.lineJoin = 'round';
  for (const i of list.filter(i => i.kind === 'pen')) {
    if (hasPressure(i.pts)) { ctx.fillStyle = i.color; ctx.fill(new Path2D(pressurePath(i.pts.map(([x, y, p]) => [x * k, y * k, p]), i.width * k))); continue; }
    ctx.strokeStyle = i.color;
    ctx.lineWidth = i.width * k;
    ctx.stroke(new Path2D(strokePath(i.pts.map(([x, y]) => [x * k, y * k]))));
  }
  for (const i of list.filter(i => i.kind === 'text')) {
    const lines = i.text.split('\n'), rtl = isRtlText(i.text), size = i.size * k;
    ctx.fillStyle = i.color;
    ctx.font = `${size}px system-ui, -apple-system, "Segoe UI", Tahoma, sans-serif`;
    ctx.direction = rtl ? 'rtl' : 'ltr';
    ctx.textAlign = rtl ? 'right' : 'left';
    ctx.textBaseline = 'top';
    const x = (rtl ? i.x + (i.w || 0) : i.x) * k;
    lines.forEach((line, j) => ctx.fillText(line, x, i.y * k + j * size * 1.35 + size * 0.12));
  }
}

// A page drawn as it looks (light colours), with its marks, as a canvas `k` times the page at 100%.
async function pageImage(n, k = 2, withMarks = true) {
  const page = await pdfDoc.getPage(n), vp = page.getViewport({ scale: k });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, viewport: vp }).promise;
  if (withMarks) paintMarks(ctx, n, vp.width / k, vp.height / k, k);
  return canvas;
}
const canvasBytes = (canvas, type = 'image/png', q) => new Promise(r => canvas.toBlob(async b => r(new Uint8Array(await b.arrayBuffer())), type, q));

// pdf-lib is big and only needed here: loaded the first time.
let pdfLibReady = null;
const loadPdfLib = () => pdfLibReady ||= new Promise((resolve, reject) => {
  const s = Object.assign(document.createElement('script'), { src: 'vendor/pdf-lib.min.js', onload: () => resolve(window.PDFLib), onerror: reject });
  document.head.append(s);
});

const progress = (n, total) => showToast(t('exporting')(n, total));
const yieldFrame = () => new Promise(r => setTimeout(r));

// ---------- PDF ----------
async function exportPdf() {
  const { PDFDocument, PDFName, PDFHexString, PDFString, pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject } = await loadPdfLib();
  const out = await PDFDocument.load(await pdfDoc.getData(), { ignoreEncryption: true, updateMetadata: false });
  const pages = out.getPages(), total = pdfDoc.numPages;
  for (let n = 1; n <= total; n++) {
    if (!hasMarks(n)) continue;
    progress(n, total);
    const src = await pdfDoc.getPage(n), vp = src.getViewport({ scale: 1 }), w = vp.width, h = vp.height, k = 2.5;
    // The marks, as a transparent picture the size of the page as shown.
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(w * k); canvas.height = Math.ceil(h * k);
    paintMarks(canvas.getContext('2d'), n, w, h, k);
    const img = await out.embedPng(await canvasBytes(canvas));
    // Laid over the page through the page's own view (crop box and rotation), so it lands where it was drawn:
    // the picture's unit square → the page as shown (y down) → the PDF's own space.
    const [a, b, c, d, e, f] = vp.transform, det = a * d - b * c;
    const inv = [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
    const U = [w, 0, 0, -h, 0, h];
    const m = [inv[0] * U[0] + inv[2] * U[1], inv[1] * U[0] + inv[3] * U[1], inv[0] * U[2] + inv[2] * U[3], inv[1] * U[2] + inv[3] * U[3],
      inv[0] * U[4] + inv[2] * U[5] + inv[4], inv[1] * U[4] + inv[3] * U[5] + inv[5]];
    const page = pages[n - 1], name = page.node.newXObject('SiyaqMarks', img.ref);
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...m), drawObject(name), popGraphicsState());
    // Notes as sticky notes, at the end of their highlight.
    for (const [hl, p] of marksOn(n).hls) {
      if (!hl.note || hl.parts[0] !== p) continue;
      const [rx, ry, rw] = p.rects[p.rects.length - 1], px = Math.min(rx + rw, 0.985) * w, py = ry * h;
      const x = inv[0] * px + inv[2] * py + inv[4], y = inv[1] * px + inv[3] * py + inv[5];
      const note = out.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [x - 10, y - 10, x + 10, y + 10], Name: 'Comment', Open: false,
        C: HL_RGB[hl.color] || HL_RGB.yellow, Contents: PDFHexString.fromText(`${hl.note}\n\n«${hl.text}»`), T: PDFHexString.fromText(t('brand')),
        M: PDFString.fromDate(new Date(hl.date || Date.now())), F: 4 });
      page.node.addAnnot(out.context.register(note));
    }
    await yieldFrame();
  }
  return saveBytes(`${baseName()}.pdf`, await out.save(), 'application/pdf');
}

// ---------- Images ----------
async function exportImages() {
  const files = {}, total = pdfDoc.numPages, pad = String(total).length;
  for (let n = 1; n <= total; n++) {
    progress(n, total);
    files[`page-${String(n).padStart(pad, '0')}.png`] = [await canvasBytes(await pageImage(n, 2)), { level: 0 }];
    await yieldFrame();
  }
  return saveBytes(`${baseName()}.zip`, fflate.zipSync(files), 'application/zip');
}

// ---------- The text of each page, with where the highlights are ----------
async function pageLines(n) {
  const page = await pdfDoc.getPage(n);
  return itemsToText((await page.getTextContent(TEXT_OPTIONS)).items).normalize('NFKC');
}
// The page's lines, each as [text, colour or null] runs: highlighted stretches are found in the page's text (they
// may run across lines), and marked in their colour.
function pageRuns(text, hls) {
  let parts = [[text, null]];
  for (const [hl] of hls) {
    const words = hl.text.normalize('NFKC').split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    const re = new RegExp(words.map(escRe).join('\\s+'), 'u');
    let done = false;
    parts = parts.flatMap(([s, c]) => {
      if (c || done) return [[s, c]];
      const m = s.match(re);
      if (!m) return [[s, c]];
      done = true;
      return [[s.slice(0, m.index), null], [m[0], hl.color], [s.slice(m.index + m[0].length), null]].filter(([x]) => x);
    });
  }
  const lines = [[]];
  for (const [s, c] of parts) s.split('\n').forEach((piece, k) => { if (k) lines.push([]); if (piece) lines[lines.length - 1].push([piece, c]); });
  return lines.filter(runs => runs.some(([s]) => s.trim()));
}

// ---------- Word ----------
const xml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
async function exportWord() {
  const total = pdfDoc.numPages, body = [], media = {}, rels = [];
  const para = (runs, { rtl, style, italic } = {}) => `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${rtl ? '<w:bidi/>' : ''}</w:pPr>${runs.map(([text, color]) =>
    `<w:r><w:rPr>${rtl ? '<w:rtl/>' : ''}${italic ? '<w:i/>' : ''}${color ? `<w:highlight w:val="${HL_WORD[color] || 'yellow'}"/>` : ''}</w:rPr><w:t xml:space="preserve">${xml(text)}</w:t></w:r>`).join('')}</w:p>`;
  body.push(para([[baseName()]], { style: 'Title', rtl: isRtlText(baseName()) }));
  for (let n = 1; n <= total; n++) {
    progress(n, total);
    const { hls, inks: list } = marksOn(n);
    body.push(para([[t('pageN')(n)]], { style: 'Heading2' }));
    for (const runs of pageRuns(await pageLines(n), hls)) body.push(para(runs, { rtl: isRtl(runs.map(([s]) => s).join('')) }));
    for (const [hl, p] of hls) if (hl.note && hl.parts[0] === p) body.push(para([[`📝 «${hl.text}» — ${hl.note}`]], { italic: true, rtl: isRtlText(hl.note) }));
    for (const i of list.filter(i => i.kind === 'text')) body.push(para([[`✎ ${i.text}`]], { italic: true, rtl: isRtlText(i.text) }));
    if (list.some(i => i.kind === 'pen')) {
      // The drawings are kept as a picture of the page.
      const canvas = await pageImage(n, 1.5), id = `img${n}`, file = `media/page${n}.png`;
      media[`word/${file}`] = [await canvasBytes(canvas), { level: 0 }];
      rels.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${file}"/>`);
      const cx = Math.round(6 * 914400), cy = Math.round(cx * canvas.height / canvas.width); // 6 inches wide
      body.push(`<w:p><w:r><w:drawing><wp:inline><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${n}" name="${id}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${n}" name="${id}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`);
    }
    await yieldFrame();
  }
  const enc = s => fflate.strToU8(s);
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Arial"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="320" w:after="120"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="127A52"/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style></w:styles>`;
  const files = {
    '[Content_Types].xml': enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`),
    '_rels/.rels': enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`),
    'word/_rels/document.xml.rels': enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${rels.join('')}</Relationships>`),
    'word/document.xml': enc(doc),
    'word/styles.xml': enc(styles),
    ...media,
  };
  return saveBytes(`${baseName()}.docx`, fflate.zipSync(files), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
}

// ---------- Text (Markdown) ----------
async function exportText() {
  const total = pdfDoc.numPages, out = [`# ${baseName()}`, ''];
  for (let n = 1; n <= total; n++) {
    progress(n, total);
    const { hls, inks: list } = marksOn(n);
    out.push(`## ${t('pageN')(n)}`, '');
    out.push(pageRuns(await pageLines(n), hls).map(runs => runs.map(([s, c]) => c ? `==${s.replace(/\n/g, ' ')}==` : s).join('')).join('\n'), '');
    for (const [hl, p] of hls) if (hl.note && hl.parts[0] === p) out.push(`> 📝 «${hl.text}» — ${hl.note}`, '');
    for (const i of list.filter(i => i.kind === 'text')) out.push(`> ✎ ${i.text}`, '');
    if (n % 20 === 0) await yieldFrame();
  }
  return saveBytes(`${baseName()}.md`, fflate.strToU8(out.join('\n')), 'text/markdown;charset=utf-8');
}

// ---------- The menu ----------
const EXPORTS = { pdf: exportPdf, images: exportImages, word: exportWord, text: exportText };
function showExportMenu() {
  const menu = $('#exportMenu'), r = $('#exportBtn').getBoundingClientRect();
  menu.hidden = false;
  const w = menu.offsetWidth;
  menu.style.top = r.bottom + 8 + 'px';
  menu.style.left = Math.max(12, Math.min(innerWidth - w - 12, r.left + r.width / 2 - w / 2)) + 'px';
}
$('#exportBtn').onclick = e => { e.stopPropagation(); $('#exportMenu').hidden ? showExportMenu() : ($('#exportMenu').hidden = true); };
document.addEventListener('click', e => { if (!e.target.closest('#exportMenu, #exportBtn')) $('#exportMenu').hidden = true; });
document.addEventListener('keydown', e => { if (e.key === 'Escape') $('#exportMenu').hidden = true; });
let exporting = false;
$('#exportMenu').onclick = async e => {
  const b = e.target.closest('[data-export]');
  if (!b || exporting || !pdfDoc) return;
  $('#exportMenu').hidden = true;
  if (inkMode) finishText();
  exporting = true;
  try {
    const where = await EXPORTS[b.dataset.export]();
    showToast(where ? t('exported')(String(where).split(/[\\/]/).pop()) : t('exportCancelled'));
  } catch (err) {
    console.error(err);
    showToast(t('exportFailed') + (err?.message || err));
  } finally { exporting = false; }
};
