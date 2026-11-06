// EPUB books, made to look like a PDF.js document to the rest of the app.

// ---------- EPUB ----------
// An EPUB is a zip of XHTML chapters. Each chapter becomes one long "page" of real text, and a small
// adapter makes the book look like a PDF.js document to the rest of the app (pages, text, outline).
const EPUB_BLOCKS = 'p,li,h1,h2,h3,h4,h5,h6,blockquote,td,th,dd,dt,figcaption,pre,div,section';
const IMAGE_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp' };
// Books are untrusted: only plain reading elements survive, never scripts, styles, forms or embeds.
const EPUB_ALLOWED = new Set(('p br hr h1 h2 h3 h4 h5 h6 blockquote ul ol li dl dt dd em i strong b u s sub sup small span a img '
  + 'figure figcaption table thead tbody tfoot tr td th pre code div section article aside header footer cite q abbr ruby rt rp').split(' '));
const EPUB_DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'select', 'textarea', 'link',
  'meta', 'title', 'head', 'audio', 'video', 'canvas', 'math', 'template', 'noscript']);
let epubUrls = []; // picture URLs, freed when another book opens

// 'OEBPS/text/ch1.xhtml' + '../images/a.png' → 'OEBPS/images/a.png'
function resolvePath(base, rel) {
  const parts = base.split('/').slice(0, -1);
  for (const seg of rel.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

const epubTarget = (base, href) => {
  const [path, frag] = href.split('#');
  return (path ? resolvePath(base, decodeURIComponent(path)) : base) + (frag ? '#' + frag : '');
};

function parseMarkup(text, type) {
  const doc = new DOMParser().parseFromString(text, type);
  // Some books ship slightly broken XHTML; the forgiving HTML parser still reads them.
  return doc.querySelector('parsererror') ? new DOMParser().parseFromString(text, 'text/html') : doc;
}

async function openEpub(data, name) {
  const files = fflate.unzipSync(data);
  const read = path => files[path] ? new TextDecoder().decode(files[path]) : '';
  const opfPath = parseMarkup(read('META-INF/container.xml'), 'application/xml').querySelector('rootfile').getAttribute('full-path');
  const opf = parseMarkup(read(opfPath), 'application/xml');
  const manifest = {};
  for (const item of opf.querySelectorAll('manifest > item')) {
    manifest[item.getAttribute('id')] = {
      href: resolvePath(opfPath, decodeURIComponent(item.getAttribute('href'))),
      type: item.getAttribute('media-type') || '',
      props: item.getAttribute('properties') || '',
    };
  }
  const spine = [...opf.querySelectorAll('spine > itemref')].map(r => manifest[r.getAttribute('idref')]).filter(m => m && /html/.test(m.type));

  epubUrls.forEach(URL.revokeObjectURL);
  epubUrls = [];
  const urls = {};
  const urlFor = path => {
    if (!urls[path] && files[path]) {
      const type = IMAGE_TYPES[path.split('.').pop().toLowerCase()] || 'application/octet-stream';
      epubUrls.push(urls[path] = URL.createObjectURL(new Blob([files[path]], { type })));
    }
    return urls[path] || '';
  };

  const chapters = spine.map((item, i) => {
    const doc = parseMarkup(read(item.href), item.type === 'text/html' ? 'text/html' : 'application/xhtml+xml');
    const section = document.createElement('section');
    section.className = 'page epub-chapter';
    section.dataset.page = i + 1;
    section.dataset.path = item.href;
    section.dir = 'auto';
    const lang = doc.documentElement.getAttribute('lang') || doc.documentElement.getAttribute('xml:lang');
    if (lang) section.lang = lang;
    cleanInto(doc.body || doc.documentElement, section, item.href, urlFor);
    return section;
  });

  const doc = {
    numPages: chapters.length,
    getPage: async n => ({ getTextContent: async () => ({ items: [{ str: chapters[n - 1].textContent }] }) }),
    getOutline: async () => epubOutline(read, manifest, opf),
  };
  pdfDoc = doc;
  bookType = 'epub';
  bookName = name;
  const title = opf.getElementsByTagNameNS('*', 'title')[0]?.textContent.trim();
  $('#bookTitle').textContent = title || name.replace(/\.epub$/i, '');
  $('#bookTitle').title = name;
  zoom = 1;
  viewer.style.setProperty('--epub-zoom', 1);
  viewer.replaceChildren(...chapters);
  await finishOpening(doc, name);
}

// Copies only safe reading elements and attributes. Pictures become local blob URLs; links become
// in-book jumps (data-href) or web links (data-url) that the click handler decides what to do with.
function cleanInto(src, dest, base, urlFor) {
  for (const node of src.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) { dest.append(node.textContent); continue; }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const tag = node.localName.toLowerCase();
    if (EPUB_DROP.has(tag)) continue;
    if (tag === 'svg') {
      // Covers are often an <image> inside an <svg>: keep just the picture.
      const image = node.querySelector('image');
      const href = image && (image.getAttribute('href') || image.getAttributeNS('http://www.w3.org/1999/xlink', 'href'));
      if (href && !/^[a-z]+:/i.test(href)) {
        const img = document.createElement('img');
        img.src = urlFor(resolvePath(base, decodeURIComponent(href)));
        dest.append(img);
      }
      continue;
    }
    if (!EPUB_ALLOWED.has(tag)) { cleanInto(node, dest, base, urlFor); continue; } // unknown wrapper: keep its text
    const el = document.createElement(tag);
    if (node.getAttribute('id')) el.id = 'e-' + node.getAttribute('id'); // prefixed so a book can't clash with the app's own ids
    for (const a of ['lang', 'dir', 'colspan', 'rowspan', 'alt', 'title']) {
      if (node.getAttribute(a)) el.setAttribute(a, node.getAttribute(a));
    }
    if (tag === 'img') {
      const imgSrc = node.getAttribute('src');
      if (!imgSrc || /^[a-z]+:/i.test(imgSrc)) continue; // nothing loads from the internet
      el.src = urlFor(resolvePath(base, decodeURIComponent(imgSrc)));
    }
    if (tag === 'a') {
      const href = node.getAttribute('href') || '';
      if (/^https?:\/\//i.test(href)) el.dataset.url = href;
      else if (href && !/^[a-z]+:/i.test(href)) el.dataset.href = epubTarget(base, href);
    }
    cleanInto(node, el, base, urlFor);
    dest.append(el);
  }
}

// The book's contents: the EPUB 3 navigation document, or the older EPUB 2 NCX file.
function epubOutline(read, manifest, opf) {
  const kids = (el, name) => [...el.children].filter(c => c.localName === name);
  const label = el => el.textContent.trim().replace(/\s+/g, ' ');
  const nav = Object.values(manifest).find(m => m.props.split(/\s+/).includes('nav'));
  if (nav) {
    const doc = parseMarkup(read(nav.href), 'application/xhtml+xml');
    const navs = [...doc.getElementsByTagName('nav')];
    const toc = navs.find(n => /toc/.test(n.getAttribute('epub:type') || n.getAttributeNS('http://www.idpf.org/2007/ops', 'type') || '')) || navs[0];
    const walk = ol => kids(ol, 'li').map(li => {
      const a = kids(li, 'a')[0] || kids(li, 'span')[0];
      const href = a?.getAttribute('href');
      const sub = kids(li, 'ol')[0];
      return { title: a ? label(a) : '', dest: href ? { epub: epubTarget(nav.href, href) } : null, items: sub ? walk(sub) : [] };
    });
    const list = toc && kids(toc, 'ol')[0];
    if (list) return walk(list);
  }
  const ncxId = opf.querySelector('spine')?.getAttribute('toc');
  const ncx = (ncxId && manifest[ncxId]) || Object.values(manifest).find(m => m.type === 'application/x-dtbncx+xml');
  if (ncx) {
    const doc = parseMarkup(read(ncx.href), 'application/xml');
    const walk = parent => kids(parent, 'navPoint').map(np => {
      const src = kids(np, 'content')[0]?.getAttribute('src');
      return { title: label(kids(np, 'navLabel')[0] || np), dest: src ? { epub: epubTarget(ncx.href, src) } : null, items: walk(np) };
    });
    const map = doc.getElementsByTagName('navMap')[0];
    if (map) return walk(map);
  }
  return [];
}

function epubGoTo(target, remember = true) {
  const [path, frag] = target.split('#');
  const section = [...viewer.children].find(c => c.dataset.path === path);
  if (!section) return;
  const el = (frag && section.querySelector(`[id="e-${CSS.escape(frag)}"]`)) || section;
  if (remember) {
    backTo = viewer.scrollTop;
    $('#backBtn').hidden = false;
  }
  viewer.scrollTop += el.getBoundingClientRect().top - viewer.getBoundingClientRect().top - 24;
}

function zoomEpub(z) {
  const n = currentPage(), div = viewer.querySelector(`.page[data-page="${n}"]`);
  const frac = (viewer.scrollTop + 24 - div.offsetTop) / div.offsetHeight;
  zoom = z;
  viewer.style.setProperty('--epub-zoom', zoom);
  viewer.scrollTop = div.offsetTop - 24 + frac * div.offsetHeight; // stay at the same place in the chapter
  updateZoomLabel();
}

// Same rules as on PDF pages: links are followed, a selection is translated, a click translates the word.
function clickEpub(e, sel, selected) {
  if (selected) {
    const node = sel.anchorNode, block = (node?.nodeType === 3 ? node.parentElement : node)?.closest(EPUB_BLOCKS);
    if (block && askMode) openAsk(selected);
    return; // the selection bar offers meaning, ask, highlight and note
  }
  const a = e.target.closest('a[data-href], a[data-url]');
  if (a) {
    if (a.dataset.href) epubGoTo(a.dataset.href);
    else openLink(a.dataset.url);
    return;
  }
  const pos = caretAt(e.clientX, e.clientY);
  if (!pos || pos.node.nodeType !== 3) return;
  const block = pos.node.parentElement.closest(EPUB_BLOCKS);
  if (!block) return;
  const text = block.textContent, at = offsetIn(block, pos.node, pos.offset);
  let start = at, end = at;
  while (start > 0 && isWordChar(text[start - 1])) start--;
  while (end < text.length && isWordChar(text[end])) end++;
  const word = text.slice(start, end).replace(/^['’-]+|['’-]+$/g, '');
  if (word && /\p{L}/u.test(word)) askMode ? openAsk(cutSentence(text, start)) : lookup(word, cutSentence(text, start));
}

function highlightEpub(section) {
  for (const b of section.querySelectorAll('.hit')) b.classList.remove('hit');
  if (!search.query) return;
  for (const b of section.querySelectorAll('p,li,h1,h2,h3,h4,h5,h6,blockquote,td,dd,pre,figcaption')) {
    if (normText(b.textContent).includes(search.query)) b.classList.add('hit');
  }
}
