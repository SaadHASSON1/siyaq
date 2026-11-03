// The demo book: the opening of "Alice in Wonderland", with ready meanings for a few dotted words, so the
// idea can be tried before getting an AI key.

const DEMO_NAME = 'Alice in Wonderland (demo).epub';
const DEMO_SENTENCES = {
  ar: {
    p1: 'بدأت أليس تشعر بالتعب الشديد من الجلوس بجانب أختها على الضفّة، ومن أنه لا شيء لديها لتفعله: مرّة أو مرّتين اختلست النظر إلى الكتاب الذي كانت أختها تقرؤه، لكنه كان بلا صور ولا حوارات.',
    p2: 'فكانت تقلّب الأمر في ذهنها (قدر استطاعتها، لأن الحرّ جعلها تشعر بالنعاس والبلادة): هل تستحق متعة صنع عقد من زهور الأقحوان عناء النهوض وقطف الأزهار، حين مرّ فجأة أرنب أبيض بعينين ورديّتين قريباً منها.',
  },
  tr: {
    p1: 'Alice, kız kardeşinin yanında kıyıda oturmaktan ve yapacak hiçbir şeyi olmamaktan çok sıkılmaya başlamıştı: bir iki kez kız kardeşinin okuduğu kitaba göz atmıştı, ama kitapta ne resim ne de konuşma vardı.',
    p2: 'Bu yüzden aklından, bir papatya zinciri yapmanın zevkinin kalkıp papatya toplama zahmetine değip değmeyeceğini düşünüp taşınıyordu ki, birden pembe gözlü beyaz bir tavşan yanından koşarak geçti.',
  },
  en: {
    p1: 'Alice was getting bored sitting by the river with her sister. She had looked at her sister’s book once or twice, but it had no pictures or talking in it.',
    p2: 'She was slowly thinking, because the heat made her sleepy, about whether making a flower chain was worth getting up for, when a White Rabbit with pink eyes suddenly ran past her.',
  },
};
// word → language → [translation, explanation, part of speech, other meanings, sentence translation]
const DEMO_WORDS = {
  bank: { base: 'bank',
    ar: ['ضفّة (النهر)', 'هنا تعني حافة النهر: أليس جالسة في الخارج بجانب أختها، لا في مصرف.', 'اسم', ['مصرف', 'رصيد', 'يميل (الطائرة)'], 'p1'],
    tr: ['kıyı (nehir kenarı)', 'Burada nehrin kenarındaki toprak anlamında: Alice dışarıda, kız kardeşinin yanında oturuyor; bir bankada değil.', 'isim', ['banka', 'hesap', 'yatmak (uçak)'], 'p1'],
    en: ['the side of a river', 'Here it means the land along the edge of a river, not a place for money.', 'noun', ['a place that keeps money', 'a store of something', 'to tilt (a plane)'], 'p1'] },
  peeped: { base: 'peep',
    ar: ['اختلست النظر', 'أي نظرت بسرعة وبشكل خفيف، نظرة صغيرة على الكتاب.', 'فعل', ['أطلّ', 'صأصأ (صوت الطائر)'], 'p1'],
    tr: ['göz attı', 'Hızlıca ve gizlice bakmak anlamında; Alice kitaba kısa bir bakış atıyor.', 'fiil', ['dikizlemek', 'cıvıldamak'], 'p1'],
    en: ['looked quickly', 'To take a quick, small look at something, often secretly.', 'verb', ['to make a small high sound', 'to appear slightly'], 'p1'] },
  considering: { base: 'consider',
    ar: ['تقلّب الأمر (تفكّر)', 'تعني هنا أنها كانت تفكّر وتوازن في ذهنها: هل يستحق الأمر العناء؟', 'فعل', ['يأخذ بعين الاعتبار', 'يعتبر'], 'p2'],
    tr: ['düşünüp taşınıyordu', 'Burada aklında tartıp karar vermeye çalışmak anlamında.', 'fiil', ['dikkate almak', 'saymak (gibi görmek)'], 'p2'],
    en: ['thinking about', 'Here it means thinking carefully to decide something.', 'verb', ['to take into account', 'to regard as'], 'p2'] },
  'daisy-chain': { base: 'daisy-chain',
    ar: ['عقد من زهور الأقحوان', 'سلسلة صغيرة يصنعها الأطفال بربط أزهار الأقحوان ببعضها.', 'اسم', ['سلسلة مترابطة (مجازاً)'], 'p2'],
    tr: ['papatya zinciri', 'Çocukların papatyaları birbirine bağlayarak yaptığı çiçek zinciri.', 'isim', ['birbirine bağlı dizi (mecaz)'], 'p2'],
    en: ['a chain of daisy flowers', 'A string of small flowers joined together, often made by children.', 'noun', ['a linked series of things'], 'p2'] },
  remarkable: { base: 'remarkable',
    ar: ['لافت للنظر', 'أي غريب أو مدهش بما يكفي ليُلاحَظ؛ أليس لم ترَ في الأمر شيئاً عجيباً.', 'صفة', ['استثنائي', 'مميّز'], 'لم يكن في ذلك شيء لافت جداً، ولم تستغرب أليس كثيراً أن تسمع الأرنب يقول لنفسه: «يا إلهي!»'],
    tr: ['dikkate değer', 'Göze çarpacak kadar olağandışı; Alice bunu tuhaf bulmadı.', 'sıfat', ['olağanüstü', 'kayda değer'], 'Bunda çok da dikkate değer bir şey yoktu; Alice tavşanın kendi kendine “Aman Tanrım!” demesini de pek tuhaf bulmadı.'],
    en: ['surprising, worth noticing', 'Unusual enough that you would notice it; Alice saw nothing strange in it.', 'adjective', ['extraordinary', 'impressive'], 'There was nothing very strange about that, and Alice did not think it odd to hear the Rabbit say “Oh dear!”'] },
  'waistcoat-pocket': { base: 'waistcoat-pocket',
    ar: ['جيب الصدرية', 'جيب صغير في الصدرية (سترة بلا أكمام) كانت تُحفظ فيه ساعة الجيب.', 'اسم', [], 'لكن حين أخرج الأرنب فعلاً ساعة من جيب صدريته، ونظر إليها، ثم أسرع مبتعداً، هبّت أليس واقفة.'],
    tr: ['yelek cebi', 'Yeleğin üzerindeki küçük cep; eskiden cep saati burada taşınırdı.', 'isim', [], 'ama tavşan gerçekten yelek cebinden bir saat çıkarıp baktıktan sonra aceleyle uzaklaşınca Alice ayağa fırladı.'],
    en: ['a pocket in a vest', 'A small pocket on a waistcoat (a vest), where people kept a pocket watch.', 'noun', [], 'but when the Rabbit really took a watch out of its vest pocket, looked at it and hurried off, Alice jumped up.'] },
  curiosity: { base: 'curiosity',
    ar: ['فضول', 'الرغبة القوية في معرفة شيء؛ هنا تشتعل أليس فضولاً لتعرف أمر الأرنب.', 'اسم', ['تحفة غريبة ونادرة'], 'ومشتعلةً بالفضول، ركضت عبر الحقل خلفه.'],
    tr: ['merak', 'Bir şeyi öğrenme isteği; burada Alice tavşanı merak edip peşinden koşuyor.', 'isim', ['ilginç ve nadir şey'], 've meraktan yanıp tutuşarak tarlanın öbür ucuna, onun peşinden koştu.'],
    en: ['wanting to know', 'A strong wish to find out about something; Alice badly wants to know about the Rabbit.', 'noun', ['a strange or rare object'], 'and very eager to find out, she ran across the field after it.'] },
  hedge: { base: 'hedge',
    ar: ['سياج من الشجيرات', 'صفّ من الشجيرات المتلاصقة يُزرع حدّاً بين الحقول.', 'اسم', ['يتحوّط (من الخسارة)', 'يراوغ في الكلام'], 'وصلت في الوقت المناسب لتراه يقفز داخل جحر أرنب كبير تحت السياج.'],
    tr: ['çit (çalılardan)', 'Tarlaların arasına sınır olarak dikilen sık çalı sırası.', 'isim', ['riskten korunmak', 'kaçamak cevap vermek'], 'tam zamanında yetişip onun çitin altındaki büyük bir tavşan deliğine daldığını gördü.'],
    en: ['a row of bushes', 'A line of bushes growing close together, used as a fence between fields.', 'noun', ['to protect against loss', 'to avoid giving a clear answer'], 'she got there just in time to see it jump into a big rabbit hole under the bushes.'] },
};

const demoOpen = () => bookName === DEMO_NAME;

document.addEventListener('click', e => { if (e.target.closest('[data-demo]')) openDemo(); });

async function openDemo() {
  if ($('#setup').open) $('#setup').close();
  bookPath = null; // bundled with the app, not a file to list under Recent books
  await openBook(new Uint8Array(await (await fetch('demo/alice.epub')).arrayBuffer()), DEMO_NAME);
}

// A ready answer for a demo word, in the reader's language, shaped like the AI's.
function demoAnswer(word) {
  const entry = demoOpen() && DEMO_WORDS[word.toLowerCase()], a = entry?.[settings.lang];
  if (!a) return null;
  const [translation, explanation, part_of_speech, other_meanings, sentence] = a;
  return { translation, explanation, part_of_speech, other_meanings, base_form: entry.base, sentence_translation: DEMO_SENTENCES[settings.lang][sentence] || sentence };
}

// Dots under the words that have ready meanings.
function markDemoWords() {
  if (!demoOpen()) return;
  const re = new RegExp(`\\b(${Object.keys(DEMO_WORDS).map(escRe).join('|')})\\b`, 'gi');
  for (const chapter of viewer.querySelectorAll('.epub-chapter')) {
    const walker = document.createTreeWalker(chapter, NodeFilter.SHOW_TEXT), nodes = [];
    while (walker.nextNode()) if (re.test(walker.currentNode.textContent)) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const frag = document.createDocumentFragment();
      let last = 0;
      node.textContent.replace(re, (m, _w, at) => {
        frag.append(node.textContent.slice(last, at));
        const span = document.createElement('span');
        span.className = 'demo-word';
        span.textContent = m;
        frag.append(span);
        last = at + m.length;
      });
      frag.append(node.textContent.slice(last));
      node.replaceWith(frag);
    }
  }
}
