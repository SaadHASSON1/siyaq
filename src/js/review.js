// Reviewing saved words as flashcards.

// ---------- Flashcards ----------
// Spaced repetition: each time you know a word it comes back later (1, 3, 7, 16, then 35 days).
const DAY = 864e5, INTERVALS = [0, 1, 3, 7, 16, 35];
const dueWords = () => vocab.filter(v => (v.due || 0) <= Date.now());
let reviewQueue = null;

function startReview() {
  reviewQueue = dueWords().filter(v => vocabPair === 'all' || pairOf(v) === vocabPair).sort((a, b) => (a.due || 0) - (b.due || 0));
  showCard(false);
}

function showCard(revealed) {
  const pane = $('#vocab');
  if (!reviewQueue.length) {
    pane.innerHTML = stateCard('check', t(vocab.some(v => v.box) ? 'reviewDone' : 'nothingDue'), `<button class="btn" id="listBtn">${t('backToList')}</button>`);
    $('#listBtn').onclick = endReview;
    return;
  }
  const v = reviewQueue[0], d = `dir="${LANGS[settings.lang].dir}"`;
  pane.innerHTML = `
    <div class="review">
      <div class="review-top"><span>${t('left')(reviewQueue.length)}</span><button class="btn small" id="listBtn">${t('backToList')}</button></div>
      <div class="rcard${revealed ? ' on' : ''}" id="rcard">
        <div class="rcard-in">
          <div class="card face">
            ${wordHead(v.word)}
            ${v.sentence ? `<blockquote class="sentence" dir="auto">${markWord(v.sentence, v.word)}</blockquote>` : ''}
          </div>
          <div class="card face back">
            ${wordHead(v.word)}
            <div class="answer"><p class="tr" ${d}>${esc(v.translation)}</p><p class="explain" ${d}>${esc(v.explanation || '')}</p></div>
          </div>
        </div>
      </div>
      <div id="reviewBtns"></div>
    </div>`;
  $('#listBtn').onclick = endReview;
  // The answer is on the back of the card: revealing turns it over.
  const showButtons = on => {
    $('#reviewBtns').innerHTML = on
      ? `<div class="review-actions"><button class="btn again" id="againBtn">${t('again')}</button><button class="btn primary" id="goodBtn">${t('good')}</button></div>`
      : `<button class="btn primary lg" id="revealBtn">${t('reveal')}</button>`;
    if (on) { $('#againBtn').onclick = () => grade(false); $('#goodBtn').onclick = () => grade(true); }
    else $('#revealBtn').onclick = reveal;
  };
  const reveal = () => { $('#rcard').classList.add('on'); showButtons(true); };
  $('#rcard').onclick = e => { if (!e.target.closest('[data-say]') && !$('#rcard').classList.contains('on')) reveal(); };
  showButtons(revealed);
}

function grade(knew) {
  const v = reviewQueue.shift();
  v.box = knew ? Math.min((v.box || 0) + 1, INTERVALS.length - 1) : 0;
  v.due = Date.now() + INTERVALS[v.box] * DAY;
  if (!knew) reviewQueue.push(v); // comes back later in this session
  store.set('vocab', vocab);
  showCard(false);
}

function endReview() {
  reviewQueue = null;
  renderVocab();
}
