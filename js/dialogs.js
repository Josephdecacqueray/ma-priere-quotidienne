/* =========================================================
   MODALES LIQUID GLASS NATIVES (REMPLACE confirm / prompt)
   + TOAST UNDO 5 SECONDES + RACCOURCI CLAVIER ÉCHAP
   - 100 % DOM pur (zéro innerHTML)
   ========================================================= */

let undoTimer = null;

function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
}

export function uiConfirm({
  title = 'Confirmation',
  message = '',
  confirmLabel = 'Confirmer',
  cancelLabel = 'Annuler',
  danger = false
} = {}) {
  return new Promise((resolve) => {
    const existing = document.getElementById('mpq-dialog-overlay');
    if (existing) existing.remove();

    const overlay = el('div', 'tour-overlay mpq-dialog-overlay');
    overlay.id = 'mpq-dialog-overlay';
    overlay.setAttribute('role', 'alertdialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', title);

    const card = el('div', 'tour-card mpq-dialog-card');
    card.appendChild(el('h2', 'tour-title', title));
    if (message) card.appendChild(el('p', 'tour-body', message));

    const actions = el('div', 'tour-actions');
    const cancelBtn = el('button', 'btn-outline-ios', cancelLabel);
    cancelBtn.id = 'btn-dialog-cancel';
    cancelBtn.type = 'button';

    const okBtn = el('button', danger ? 'btn-danger-ios' : 'btn-primary-ios', confirmLabel);
    okBtn.id = 'btn-dialog-confirm';
    okBtn.type = 'button';

    const finish = (val) => {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(val);
    };

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      }
    };

    cancelBtn.addEventListener('click', () => finish(false));
    okBtn.addEventListener('click', () => finish(true));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) finish(false);
    });
    document.addEventListener('keydown', onKey);

    actions.append(cancelBtn, okBtn);
    card.appendChild(actions);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => okBtn.focus());
  });
}

export function uiPrompt({
  title = 'Saisir un texte',
  message = '',
  placeholder = '',
  initialValue = '',
  confirmLabel = 'Enregistrer',
  cancelLabel = 'Annuler',
  maxLength = 240,
  multiline = false
} = {}) {
  return new Promise((resolve) => {
    const existing = document.getElementById('mpq-dialog-overlay');
    if (existing) existing.remove();

    const overlay = el('div', 'tour-overlay mpq-dialog-overlay');
    overlay.id = 'mpq-dialog-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', title);

    const card = el('div', 'tour-card mpq-dialog-card');
    card.appendChild(el('h2', 'tour-title', title));
    if (message) card.appendChild(el('p', 'tour-body', message));

    const form = el('form', 'mpq-dialog-form');
    const input = document.createElement(multiline ? 'textarea' : 'input');
    input.id = 'mpq-dialog-input';
    input.className = 'ios-input';
    if (!multiline) input.type = 'text';
    else input.rows = 3;
    input.placeholder = placeholder;
    input.maxLength = maxLength;
    input.value = initialValue || '';
    form.appendChild(input);

    const actions = el('div', 'tour-actions');
    const cancelBtn = el('button', 'btn-outline-ios', cancelLabel);
    cancelBtn.id = 'btn-dialog-cancel';
    cancelBtn.type = 'button';

    const okBtn = el('button', 'btn-primary-ios', confirmLabel);
    okBtn.id = 'btn-dialog-confirm';
    okBtn.type = 'submit';

    const finish = (val) => {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(val);
    };

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(null);
      }
    };

    cancelBtn.addEventListener('click', () => finish(null));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      finish(input.value);
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) finish(null);
    });
    document.addEventListener('keydown', onKey);

    actions.append(cancelBtn, okBtn);
    form.appendChild(actions);
    card.appendChild(form);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => {
      input.focus();
      if (!multiline) input.select();
    });
  });
}

export function showUndoToast({ message, undoLabel = 'Annuler', onUndo, durationMs = 5200 } = {}) {
  const prev = document.getElementById('undo-toast-bar');
  if (prev) prev.remove();
  clearTimeout(undoTimer);

  const bar = el('div', 'undo-toast-bar');
  bar.id = 'undo-toast-bar';
  bar.setAttribute('role', 'status');
  bar.setAttribute('aria-live', 'polite');

  const msgSpan = el('span', 'undo-toast-msg', message || 'Supprimé');
  const btn = el('button', 'undo-toast-btn', undoLabel);
  btn.id = 'btn-undo-action';
  btn.type = 'button';

  const close = () => {
    clearTimeout(undoTimer);
    bar.remove();
  };

  btn.addEventListener('click', async () => {
    close();
    try {
      await onUndo?.();
    } catch {
      // Ignoré
    }
  });

  bar.append(msgSpan, btn);
  document.body.appendChild(bar);
  undoTimer = setTimeout(close, durationMs);
}

export function bindGlobalEscapeHandler(closeSheetsFn) {
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    // Priorité aux modales / overlays au-dessus des sheets
    const dialog = document.getElementById('mpq-dialog-overlay');
    if (dialog) return; // Géré par son propre listener

    const tour = document.getElementById('guided-tour-overlay');
    if (tour) {
      try { localStorage.setItem('mpq_tour_seen_v1', '1'); } catch { /* ignoré */ }
      tour.remove();
      return;
    }

    const timer = document.getElementById('prayer-timer-overlay');
    if (timer) {
      timer.remove();
      return;
    }

    const classics = document.getElementById('classic-prayers-overlay');
    if (classics) {
      classics.remove();
      return;
    }

    const backdrop = document.getElementById('modal-backdrop');
    if (backdrop && !backdrop.classList.contains('hidden')) {
      closeSheetsFn?.();
    }
  });
}
