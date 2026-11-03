// Test books, made fresh for each run: PDFs printed by the test browser, and an EPUB zipped here.
import { zipSync, strToU8 } from 'fflate';

const para = (seed, n) => {
  const words = 'the river walked slowly under a grey sky while old friends spoke of distant towns and quiet harbours'.split(' ');
  let x = seed;
  return Array.from({ length: n }, () => words[(x = (x * 9301 + 49297) % 233280) % words.length]).join(' ');
};

// Two chapters with sections, so the contents have levels and page numbers.
export const englishHtml = `<html><head><meta charset="utf-8"><style>body{font:14pt Georgia;margin:50px}h1{page-break-before:always}h1:first-child{page-break-before:auto}</style></head><body>
<h1>Chapter One: The River</h1>
<p>She sat on the bank of the river, watching the water.</p>
<p>So she was considering in her own mind whether the pleasure of making a daisy-chain would be worth the trouble.</p>
<h2>Morning</h2><p>${para(1, 120)}.</p>
<h1>Chapter Two: The Town</h1>
<p>In the market the bank opened late, and the Cheshire Cat grinned from the branch.</p>
<h2>Evening</h2><p>${para(2, 120)}.</p>
</body></html>`;

export const arabicHtml = `<html dir="rtl" lang="ar"><head><meta charset="utf-8"><style>body{font:15pt "Geeza Pro","DejaVu Sans","Noto Sans Arabic",sans-serif;margin:50px}</style></head><body>
<h1>الدرس 1: الأساسيات</h1>
<p>الأمر اللي بيطبع على الشاشة: cout &lt;&lt; "Hello"; وهو أول شي بنتعلمه.</p>
</body></html>`;

export function epub() {
  const xhtml = body => `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body>${body}</body></html>`;
  return Buffer.from(zipSync({
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8('<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
    'OEBPS/content.opf': strToU8('<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Test Book</dc:title><dc:identifier id="id">x</dc:identifier><dc:language>en</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>'),
    'OEBPS/nav.xhtml': strToU8('<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="c1.xhtml">The Riverbank</a></li><li><a href="c2.xhtml">The Market</a></li></ol></nav></body></html>'),
    'OEBPS/c1.xhtml': strToU8(xhtml('<h1>The Riverbank</h1><p>She sat on the bank of the <em>river</em> and watched the boats drift slowly past the old mill.</p>')),
    'OEBPS/c2.xhtml': strToU8(xhtml('<h1>The Market</h1><p>In the market the bank opened late.</p>')),
  }));
}
