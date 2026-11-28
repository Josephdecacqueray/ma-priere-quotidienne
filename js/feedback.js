/* =========================================================
   CONTACT BUG & SUGGESTION (REDIRECTION PRIVÉE ANTI-SPAM)
   - Chargé dynamiquement à la demande (zéro poids au démarrage)
   - Aucune adresse e-mail du propriétaire présente côté client
   - Anti-spam : honeypot + délai minimal >= 1,5 s + Turnstile + rate-limit serveur
   - Mode hors connexion : mis en file IndexedDB et envoyé automatiquement au retour réseau
   ========================================================= */

import { APP_VERSION, getApiBaseUrl, fetchServerConfig } from './config.js';
import { enqueueFeedback, generateId } from './db.js';

let initialized = false;
let openedAtMs = 0;
let selectedCategory = 'bug';
let turnstileToken = '';
let turnstileWidgetId = null;
let turnstileScriptPromise = null;
let hostCallbacks = {
  showToast: () => {},
  closeSheet: () => {}
};

const $ = (id) => document.getElementById(id);

function loadTurnstileScript() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (turnstileScriptPromise) return turnstileScriptPromise;
  turnstileScriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.defer = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile indisponible')));
    s.onerror = () => {
      turnstileScriptPromise = null;
      reject(new Error('Turnstile indisponible'));
    };
    document.head.appendChild(s);
  });
  return turnstileScriptPromise;
}

async function mountTurnstile() {
  const slot = $('feedback-turnstile-slot');
  if (!slot) return;
  turnstileToken = '';
  slot.replaceChildren();
  slot.classList.add('hidden');
  turnstileWidgetId = null;

  if (!navigator.onLine || !getApiBaseUrl()) return;
  const cfg = await fetchServerConfig();
  if (!cfg.turnstileSiteKey) return;

  try {
    const ts = await loadTurnstileScript();
    slot.classList.remove('hidden');
    turnstileWidgetId = ts.render(slot, {
      sitekey: cfg.turnstileSiteKey,
      theme: document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light',
      callback: (tok) => { turnstileToken = tok; },
      'expired-callback': () => { turnstileToken = ''; }
    });
  } catch {
    // Silencieux hors-ligne
  }
}

function collectSafeTechnicalContext() {
  return {
    appVersion: APP_VERSION,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    standalone: Boolean(
      window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator?.standalone
    ),
    online: Boolean(navigator.onLine),
    platform: String(navigator.platform || '').slice(0, 60),
    userAgent: String(navigator.userAgent || '').slice(0, 220)
  };
}

function syncCategoryUi() {
  document.querySelectorAll('#feedback-category-group .pill-btn').forEach((b) => {
    const active = b.dataset.fbCat === selectedCategory;
    b.classList.toggle('active', active);
    b.setAttribute('aria-pressed', String(active));
  });
  const ctxCheck = $('feedback-include-context');
  if (ctxCheck && !ctxCheck.dataset.userTouched) {
    ctxCheck.checked = selectedCategory === 'bug';
  }
}

function updateCharCounter() {
  const ta = $('feedback-message-input');
  const counter = $('feedback-char-count');
  if (!ta || !counter) return;
  counter.textContent = `${ta.value.length} / 3 000`;
}

function showFeedbackStatus(text, isError = false) {
  const box = $('feedback-status-msg');
  if (!box) return;
  box.textContent = text;
  box.classList.toggle('is-error', Boolean(isError));
  box.classList.remove('hidden');
}

function clearFeedbackStatus() {
  const box = $('feedback-status-msg');
  if (!box) return;
  box.textContent = '';
  box.classList.add('hidden');
  box.classList.remove('is-error');
}

function bindOnce() {
  if (initialized) return;
  initialized = true;

  document.querySelectorAll('#feedback-category-group .pill-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedCategory = btn.dataset.fbCat || 'bug';
      syncCategoryUi();
    });
  });

  const ctxCheck = $('feedback-include-context');
  if (ctxCheck) {
    ctxCheck.addEventListener('change', () => {
      ctxCheck.dataset.userTouched = '1';
    });
  }

  const ta = $('feedback-message-input');
  if (ta) {
    ta.addEventListener('input', updateCharCounter);
  }

  const form = $('feedback-form');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearFeedbackStatus();

      const msgEl = $('feedback-message-input');
      const replyEl = $('feedback-reply-input');
      const hpEl = $('feedback-hp-input');
      const submitBtn = $('btn-feedback-submit');
      const message = String(msgEl?.value || '').trim();

      if (message.length < 10) {
        showFeedbackStatus('Merci de décrire votre bug ou suggestion en au moins 10 caractères.', true);
        msgEl?.focus();
        return;
      }

      const elapsedMs = Math.max(0, Date.now() - openedAtMs);
      const includeContext = Boolean($('feedback-include-context')?.checked);
      const payload = {
        category: selectedCategory,
        message,
        replyContact: String(replyEl?.value || '').trim().slice(0, 180),
        includeContext,
        appContext: includeContext ? collectSafeTechnicalContext() : undefined,
        website: String(hpEl?.value || ''),
        elapsedMs,
        turnstileToken
      };

      const base = getApiBaseUrl();

      // Mode hors connexion ou serveur non encore relié -> file locale IndexedDB
      if (!navigator.onLine || !base) {
        await enqueueFeedback({
          id: generateId('fbq'),
          createdAt: Date.now(),
          payload: { ...payload, elapsedMs: Math.max(2000, elapsedMs) }
        });
        if (msgEl) msgEl.value = '';
        if (replyEl) replyEl.value = '';
        updateCharCounter();
        const msg = !navigator.onLine
          ? 'Hors connexion : votre message est enregistré et partira automatiquement dès le retour d’Internet.'
          : 'Message enregistré localement. Il sera transmis dès que le serveur Cloudflare sera relié.';
        showFeedbackStatus(msg, false);
        hostCallbacks.showToast('Message mis en file d’envoi ✓');
        return;
      }

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Envoi en cours…';
      }

      try {
        const resp = await fetch(`${base}/api/feedback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await resp.json().catch(() => ({}));

        if (!resp.ok) {
          showFeedbackStatus(data?.error || 'Impossible d’envoyer votre message pour le moment.', true);
          if (window.turnstile && turnstileWidgetId !== null) {
            try { window.turnstile.reset(turnstileWidgetId); } catch { /* ignoré */ }
          }
          return;
        }

        if (msgEl) msgEl.value = '';
        if (replyEl) replyEl.value = '';
        updateCharCounter();
        showFeedbackStatus(data?.message || 'Merci ! Votre message a bien été transmis.', false);
        hostCallbacks.showToast('Message envoyé, merci ! ✓');
        setTimeout(() => {
          hostCallbacks.closeSheet();
        }, 1200);
      } catch {
        // Coupure réseau pendant l'envoi -> sauvegarde sans perte en file locale
        await enqueueFeedback({
          id: generateId('fbq'),
          createdAt: Date.now(),
          payload: { ...payload, elapsedMs: Math.max(2000, elapsedMs) }
        });
        showFeedbackStatus('Connexion interrompue : message enregistré sur l’appareil, il partira automatiquement dès le retour d’Internet.', false);
        hostCallbacks.showToast('Enregistré hors connexion ✓');
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Envoyer le message';
        }
      }
    });
  }
}

export async function prepareFeedbackSheet(callbacks = {}) {
  hostCallbacks = { ...hostCallbacks, ...callbacks };
  bindOnce();
  openedAtMs = Date.now();
  selectedCategory = 'bug';
  const ctxCheck = $('feedback-include-context');
  if (ctxCheck) {
    delete ctxCheck.dataset.userTouched;
    ctxCheck.checked = true;
  }
  const hpEl = $('feedback-hp-input');
  if (hpEl) hpEl.value = '';
  syncCategoryUi();
  updateCharCounter();
  clearFeedbackStatus();
  await mountTurnstile();
}
