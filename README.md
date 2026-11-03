<p align="center"><img src="src/logo.svg" width="96" alt="Glint"></p>

# Glint

قارئ PDF مجاني ومفتوح المصدر: اضغط على أي كلمة في كتاب بلغة أجنبية، وبتطلعلك معناها **حسب الجملة اللي هي فيها**، بدون ما تنسخ وتلصق بمترجم.

A free, open-source PDF reader: click any word in a foreign-language book and get its meaning **in the context of its sentence**.

## المميزات
- يشتغل على أي ملف PDF فيه نص (مش صور ممسوحة ضوئياً)
- معنى الكلمة حسب السياق، مع شرح وترجمة الجملة والمعاني التانية
- ظلّل عبارة كاملة (لحد 10 كلمات) لتعرف معناها، مثل "give up" أو "on the other hand"
- الكلمات بتنحفظ تلقائياً، وبتقدر تصدّرها CSV لبرنامج Anki
- ملف واحد بدون تثبيت وبدون سيرفر. الـ PDF ما بيطلع من جهازك أبداً

## التشغيل والبناء
بتحتاج [Node.js](https://nodejs.org) و[Rust](https://rustup.rs).

```bash
npm install
npm run dev     # يشغّل التطبيق للتطوير
npm run build   # يبني التطبيق النهائي (.app / .dmg على الماك)
```

لتجربة الواجهة بالمتصفح بس: `npm run web` وبعدها افتح http://localhost:8765

## اختيار نموذج الذكاء الاصطناعي (من الإعدادات)
| المزوّد | التكلفة | ملاحظات |
|---|---|---|
| Google Gemini | فيه خطة مجانية | خذ مفتاح من https://aistudio.google.com |
| Ollama | مجاني بالكامل، على جهازك | `ollama pull llama3.1` وشغّله بـ `OLLAMA_ORIGINS=* ollama serve` |
| أي خدمة متوافقة مع OpenAI | حسب الخدمة | OpenRouter، Groq، OpenAI… |
| Anthropic Claude | مدفوع | |

مفتاح الـ API بيتخزن بمتصفحك فقط. اللي بينبعت للمزوّد هو الكلمة والجملة اللي هي فيها، مش الكتاب.

## أفكار للتطوير
- OCR للكتب الممسوحة ضوئياً (Tesseract.js)
- دعم EPUB
- تلوين الكلمات اللي بحثت عنها قبل داخل الكتاب
- مراجعة الكلمات (flashcards) داخل الأداة

## الرخصة
MIT
