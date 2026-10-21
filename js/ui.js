// Petits utilitaires d'interface
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const num = (v) => (v === '' || v == null || isNaN(Number(v)) ? undefined : Number(v));
export const cm = (v) => (v ? `${Math.round(v)}` : '–');

export function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  document.getElementById('toast-root').appendChild(el);
  setTimeout(() => el.remove(), type === 'err' ? 6000 : 3000);
}

/**
 * Ouvre une modale. content = HTML string. Renvoie {el, close}.
 * onClose appelé à la fermeture.
 */
export function modal({ title, content, footer = '', wide = false, onClose }) {
  const root = document.getElementById('modal-root');
  const el = document.createElement('div');
  el.className = 'modal';
  el.innerHTML = `
    <div class="modal__box ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
      <div class="modal__head"><h2>${esc(title)}</h2><button class="close" data-close aria-label="Fermer">×</button></div>
      <div class="modal__body">${content}</div>
      ${footer ? `<div class="modal__foot">${footer}</div>` : ''}
    </div>`;
  root.appendChild(el);
  document.body.style.overflow = 'hidden';
  let closed = false;
  const close = (v) => {
    if (closed) return;
    closed = true;
    el.remove();
    if (!root.children.length) document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
    onClose?.(v);
  };
  const onKey = (e) => { if (e.key === 'Escape' && root.lastElementChild === el) close(); };
  document.addEventListener('keydown', onKey);
  el.addEventListener('mousedown', (e) => { if (e.target === el) close(); });
  el.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => close()));
  return { el, close };
}

export function confirmDialog(message, okLabel = 'Confirmer', danger = true) {
  return new Promise((resolve) => {
    let result = false;
    const m = modal({
      title: 'Confirmation',
      content: `<p>${esc(message)}</p>`,
      footer: `<button class="btn btn--light" data-close>Annuler</button><button class="btn ${danger ? 'btn--danger' : ''}" data-ok>${esc(okLabel)}</button>`,
      onClose: () => resolve(result),
    });
    m.el.querySelector('[data-ok]').addEventListener('click', () => { result = true; m.close(); });
  });
}

/** Zone de dépôt + sélection de fichiers */
export function bindDropzone(zone, input, onFiles) {
  zone.addEventListener('click', () => input.click());
  input.addEventListener('change', () => { if (input.files.length) onFiles([...input.files]); input.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('drag'); }));
  zone.addEventListener('drop', (e) => { const f = [...e.dataTransfer.files].filter((x) => x.type.startsWith('image/')); if (f.length) onFiles(f); });
}

export function busy(btn, on, label) {
  if (!btn) return;
  if (on) { btn.dataset.label = btn.innerHTML; btn.disabled = true; btn.innerHTML = label || 'Patientez…'; }
  else { btn.disabled = false; if (btn.dataset.label) btn.innerHTML = btn.dataset.label; }
}

export function furnitureDims(f) {
  const p = [];
  if (f.length) p.push(`L ${Math.round(f.length)}`);
  if (f.width) p.push(`l ${Math.round(f.width)}`);
  if (f.height) p.push(`H ${Math.round(f.height)}`);
  return p.length ? p.join(' × ') + ' cm' : 'Dimensions non renseignées';
}
