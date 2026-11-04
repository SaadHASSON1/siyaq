// Settings and the state of the open book.

const systemLang = ['ar', 'tr', 'en'].find(l => (navigator.language || '').toLowerCase().startsWith(l)) || 'en';
let settings = Object.assign({ provider: 'gemini', apiKey: '', model: '', baseUrl: 'http://localhost:11434/v1', lang: systemLang, theme: 'system' }, store.get('settings', {}));
if (!LANGS[settings.lang]) settings.lang = 'ar'; // earlier versions stored free text here, always Arabic
// lang: what words are translated into. uiLang: the app's own language. Before they were split, one drove both.
if (!LANGS[settings.uiLang]) settings.uiLang = store.get('settings', null) ? settings.lang : systemLang;
const t = key => STRINGS[settings.uiLang][key] ?? STRINGS.en[key];
// Earlier versions saved these as the model; they have tiny free quotas, so go back to automatic.
// Gemini now picks its own model, the fastest that answers: a name typed in earlier versions is dropped.
if (settings.provider === 'gemini' && settings.model) { settings.model = ''; store.set('settings', settings); }
let vocab = store.get('vocab', []);
let pdfDoc = null, scale = 1, bookName = ''; // pdfDoc: the open book (a PDF.js document, or an EPUB that looks like one)
let bookType = 'pdf';
let fitScale = 1, zoom = 1, pageSize = null; // scale = fitScale × zoom; pageSize is page 1 at scale 1
let bookLang = null; // 'ar' | 'en' | 'tr' | 'other', or null when unknown
let lastLookup = null;
let bookKey = ''; // name + page count: identifies a book for its saved reading position
const cache = new Map(store.get('cache', [])); // lang|word|sentence → answer, kept between sessions
let lookupId = 0;
