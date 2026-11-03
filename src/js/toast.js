// Short messages at the bottom of the window.

// ---------- Toast ----------
function showToast(text, action) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(text)}</span>`
    + (action ? `<button class="btn small primary" id="toastBtn">${esc(action.label)}</button>` : '')
    + `<button class="icon-btn" id="toastClose" aria-label="${t('close')}">${icon('x')}</button>`;
  el.hidden = false;
  if (action) $('#toastBtn').onclick = action.run;
  $('#toastClose').onclick = () => { el.hidden = true; };
  clearTimeout(showToast.timer);
  if (!action) showToast.timer = setTimeout(() => { el.hidden = true; }, 4000);
}
