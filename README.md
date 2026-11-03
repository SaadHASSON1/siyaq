<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="src/logo-dark.svg">
    <img src="src/logo.svg" width="140" alt="Siyaq logo">
  </picture>
</p>

<h1 align="center">Siyaq · سياق</h1>

<p align="center">
  <b>Read books in another language without ever leaving the page.</b><br>
  Click any word in a PDF or EPUB and see what it means <i>in that sentence</i>.
</p>

<p align="center">
  <a href="https://github.com/SaadHASSON1/siyaq/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/SaadHASSON1/siyaq?label=download&color=1fb08c"></a>
  <img alt="Platforms" src="https://img.shields.io/badge/macOS%20%C2%B7%20Windows%20%C2%B7%20Linux-0c1e33">
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/github/license/SaadHASSON1/siyaq?color=c9a45a"></a>
</p>

<p align="center">
  <a href="https://saadhasson1.github.io/siyaq/"><b>🌐 Website &amp; download</b></a>
</p>

<p align="center"><b>English</b> · <a href="README.ar.md">العربية</a></p>

<p align="center">
  <img src="docs/screenshot-en-dark.png" alt="Siyaq showing the meaning of “bank” in a sentence from Alice in Wonderland, translated to Turkish" width="900">
</p>

---

## Why Siyaq?

When you read a book in a language you're still learning, every unknown word means copying it, switching to a translator, and coming back. Worse, the translator doesn't see the sentence, so it often gives the wrong meaning: *bank* the river edge becomes *bank* the place for money.

**Siyaq** (Arabic for *context*) fixes both. Click a word and the meaning appears beside the page, chosen for the sentence it's in, with a short explanation of why.

## Features

**Understanding**
- 🎯 **Meaning in context**: the translation that fits *this* sentence, why, the whole sentence translated, and other meanings
- 🗣️ **Hear it**: pronunciation for any word
- ✍️ **Whole phrases**: select up to ten words, like *give up*
- 🌍 **Arabic, English and Turkish**: translate into any of them; the book's language is detected automatically

**Reading**
- 📚 **PDF and EPUB**, opened by double-clicking like any reader
- 🔍 **Scanned books too**: picture-only pages are read on your device (OCR), in all three languages
- 📍 **Picks up where you left off** in every book
- 🧭 **Contents sidebar, search** (`⌘F` / `Ctrl+F`) and working links
- 🌙 **Dark mode** that darkens pages but keeps pictures in their real colours

**Remembering**
- 📝 **Every word you look up is saved** and underlined wherever it appears again
- 🃏 **Flashcards** with spaced repetition, or export to Anki

**Respect**
- 🔒 **Your books never leave your device.** Only the sentence you ask about is sent to the AI.
- 💸 **Free and open source.** No account, no subscription, no tracking.
- 🔄 **Updates itself** when a new version comes out

## Download

| Platform | File |
|---|---|
| **macOS** (Apple Silicon and Intel) | `Siyaq_x.y.z_universal.dmg` |
| **Windows** | `Siyaq_x.y.z_x64-setup.exe` |
| **Linux** | `Siyaq_x.y.z_amd64.AppImage` |

The easiest way: **[saadhasson1.github.io/siyaq](https://saadhasson1.github.io/siyaq/)** picks the right file for your device. Or open the **[latest release](https://github.com/SaadHASSON1/siyaq/releases/latest)** and download the one file for your device from the table at the top.

> [!NOTE]
> Siyaq isn't signed with a paid developer certificate yet, so the first launch shows a warning.
> **macOS:** right-click Siyaq → **Open**. **Windows:** **More info** → **Run anyway**.

## Getting started

1. Open Siyaq. A short setup walks you through getting a **free Gemini API key** from [Google AI Studio](https://aistudio.google.com/apikey) and tests it.
2. Open a PDF or EPUB, or drop it on the window.
3. Click any word.

You can also use [Ollama](https://ollama.com), any OpenAI-compatible service, or Anthropic, from **Settings**.

## Build from source

You need [Node.js](https://nodejs.org) and [Rust](https://rustup.rs).

```bash
git clone https://github.com/SaadHASSON1/siyaq.git
cd siyaq
npm install
npm run dev     # run the app while developing
npm run build   # build installers for your system
```

Pushing a tag such as `v0.5.0` builds signed installers and update files for every platform with GitHub Actions.

**Built with** [Tauri](https://tauri.app), [PDF.js](https://mozilla.github.io/pdf.js/), [Tesseract.js](https://tesseract.projectnaptha.com) and [fflate](https://github.com/101arrowz/fflate).

## Roadmap

- [x] PDF and EPUB, scanned pages, dark mode
- [x] Arabic, English and Turkish interface and translations
- [x] Flashcards, saved words, automatic updates
- [ ] Android, with *Siyaq* in the text-selection menu of every app

## License

[MIT](LICENSE) © Saad HASSON
