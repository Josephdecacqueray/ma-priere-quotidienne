/* =========================================================
   INTERFACE COMPTE SIMPLE, MOT DE PASSE OUBLIÉ & APPAREILS
   - Création / Connexion ultra-simple : e-mail + mot de passe uniquement
   - Mode « Mot de passe oublié ? » intégré (clé de récupération 160 bits)
   - Aucune option technique serveur/OAuth exposée aux utilisateurs
   - Zéro innerHTML sur données utilisateur ou externes (DOM pur)
   ========================================================= */

import {
  getAuthState,
  registerAccount,
  loginAccount,
  recoverAccount,
  changePassword,
  listSessions,
  revokeSession,
  logoutAccount
} from './auth.js';
import { getApiBaseUrl, fetchServerConfig } from './config.js';
import { getLocalStorageStats, getBackupWitness, requestPersistentStorage } from './db.js';
import {
  isDriveSyncEnabled,
  isDriveConfigured,
  connectGoogleDrive,
  disconnectGoogleDrive,
  syncAllMediaWithDrive
} from './drive-sync.js';

let activeMode = 'login'; // 'login' | 'register' | 'forgot'
let pendingRecoveryKey = '';
let turnstileToken = '';
let turnstileRequired = false;
let turnstileWidgetId = null;
let turnstileScriptPromise = null;
let turnstileMountSeq = 0;
let hostCallbacks = {
  onSynced: async () => {},
  onStatusChange: () => {},
  showToast: () => {},
  closeSheet: () => {}
};

const $ = (id) => document.getElementById(id);

function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
}

function formatSize(bytes) {
  const b = Number(bytes) || 0;
  if (b < 1024) return `${b} o`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} Ko`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} Mo`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} Go`;
}

function formatDateTime(ts) {
  if (!ts) return 'jamais';
  try {
    return new Date(ts).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return '—';
  }
}

function cleanupTurnstileWidget() {
  if (window.turnstile && turnstileWidgetId !== null) {
    try {
      window.turnstile.remove(turnstileWidgetId);
    } catch {
      // Ignoré
    }
  }
  turnstileWidgetId = null;
  turnstileToken = '';
  turnstileRequired = false;
}

function loadTurnstileScript() {
  if (window.turnstile && typeof window.turnstile.render === 'function') {
    return Promise.resolve(window.turnstile);
  }
  if (turnstileScriptPromise) return turnstileScriptPromise;
  turnstileScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-mpq-turnstile="1"]');
    if (existing) {
      let tries = 0;
      const waitReady = () => {
        if (window.turnstile && typeof window.turnstile.render === 'function') {
          resolve(window.turnstile);
        } else if (++tries > 120) {
          turnstileScriptPromise = null;
          reject(new Error('Turnstile indisponible'));
        } else {
          setTimeout(waitReady, 80);
        }
      };
      waitReady();
      return;
    }
    const cbName = '__mpqTurnstileReady';
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      try { delete window[cbName]; } catch { /* ignoré */ }
      if (ok && window.turnstile) resolve(window.turnstile);
      else {
        turnstileScriptPromise = null;
        reject(new Error('Turnstile indisponible'));
      }
    };
    window[cbName] = () => finish(true);
    const s = document.createElement('script');
    s.src = `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=${cbName}`;
    s.async = true;
    s.defer = true;
    s.dataset.mpqTurnstile = '1';
    s.onload = () => {
      setTimeout(() => {
        if (!settled && window.turnstile) finish(true);
      }, 150);
    };
    s.onerror = () => finish(false);
    document.head.appendChild(s);
  });
  return turnstileScriptPromise;
}

async function mountTurnstileIfNeeded(slotEl) {
  cleanupTurnstileWidget();
  const seq = ++turnstileMountSeq;
  if (!slotEl || !navigator.onLine) return;
  const cfg = await fetchServerConfig();
  if (seq !== turnstileMountSeq || !slotEl.isConnected) return;
  if (!cfg.turnstileSiteKey) return;

  turnstileRequired = true;
  slotEl.classList.remove('hidden');
  const waitHint = el('span', 'field-help', 'Vérification de sécurité en cours…');
  slotEl.replaceChildren(waitHint);

  try {
    const ts = await loadTurnstileScript();
    if (seq !== turnstileMountSeq || !slotEl.isConnected) return;

    slotEl.replaceChildren();
    turnstileWidgetId = ts.render(slotEl, {
      sitekey: cfg.turnstileSiteKey,
      theme: document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light',
      size: 'flexible',
      language: 'fr',
      callback: (tok) => {
        turnstileToken = tok || '';
      },
      'expired-callback': () => {
        turnstileToken = '';
      },
      'timeout-callback': () => {
        turnstileToken = '';
      },
      'error-callback': () => {
        turnstileToken = '';
      }
    });
  } catch {
    slotEl.replaceChildren(
      el('span', 'field-help', 'Module anti-robot bloqué par votre réseau ou bloqueur. Autorisez challenges.cloudflare.com puis réessayez.')
    );
  }
}

async function renderGuestView(body) {
  const apiUrl = getApiBaseUrl();

  if (activeMode !== 'forgot') {
    const intro = el('div', 'info-block');
    intro.appendChild(el('h3', '', 'Mon compte gratuit'));
    intro.appendChild(
      el(
        'p',
        'field-help',
        'Connectez-vous ou créez un compte en 10 secondes pour retrouver vos prières, neuvaines et intentions sur tous vos appareils. Vos données déjà enregistrées sur cet appareil seront fusionnées sans perte.'
      )
    );
    intro.appendChild(
      el(
        'p',
        'field-help account-pwa-note',
        'Session persistante 180 jours · utilisable en mode avion sans reconnexion.'
      )
    );
    body.appendChild(intro);

    // 2 onglets simples : Connexion | Créer un compte
    const tabs = el('div', 'segmented-control account-tabs-two');
    tabs.setAttribute('role', 'tablist');
    [
      { id: 'login', label: 'Connexion' },
      { id: 'register', label: 'Créer un compte' }
    ].forEach((t) => {
      const b = el('button', `segment-btn${activeMode === t.id ? ' active' : ''}`, t.label);
      b.type = 'button';
      b.dataset.accountTab = t.id;
      b.addEventListener('click', () => {
        activeMode = t.id;
        renderAccountSheet();
      });
      tabs.appendChild(b);
    });
    body.appendChild(tabs);
  } else {
    const backBtn = el('button', 'account-back-link', '← Retour à la connexion');
    backBtn.id = 'btn-forgot-back';
    backBtn.type = 'button';
    backBtn.addEventListener('click', () => {
      activeMode = 'login';
      renderAccountSheet();
    });
    body.appendChild(backBtn);
  }

  const card = el('div', 'info-block');
  if (activeMode === 'forgot') {
    card.appendChild(el('h3', '', 'Mot de passe oublié'));
    card.appendChild(
      el(
        'p',
        'field-help',
        'Saisissez votre adresse e-mail, la clé de récupération fournie lors de la création de votre compte, puis choisissez un nouveau mot de passe.'
      )
    );
  }

  const form = el('form', 'account-form');
  form.id = activeMode === 'forgot' ? 'account-form-recover' : `account-form-${activeMode}`;

  const errBox = el('p', 'account-error-msg hidden');
  errBox.id = 'account-error-msg';
  errBox.setAttribute('role', 'alert');

  const emailField = el('div', 'form-field');
  const emailLabel = el('label', 'field-label', 'Adresse e-mail');
  emailLabel.htmlFor = 'acc-email-input';
  const emailInput = el('input', 'ios-input');
  emailInput.id = 'acc-email-input';
  emailInput.name = 'username';
  emailInput.type = 'email';
  emailInput.required = true;
  emailInput.autocomplete = 'username';
  emailInput.inputMode = 'email';
  emailInput.placeholder = 'prenom@exemple.fr';
  emailField.append(emailLabel, emailInput);
  form.appendChild(emailField);

  let recoveryInput = null;
  if (activeMode === 'forgot') {
    const recField = el('div', 'form-field');
    const recLabel = el('label', 'field-label', 'Clé de récupération');
    recLabel.htmlFor = 'acc-recovery-input';
    recoveryInput = el('input', 'ios-input account-mono-input');
    recoveryInput.id = 'acc-recovery-input';
    recoveryInput.type = 'text';
    recoveryInput.required = true;
    recoveryInput.autocomplete = 'off';
    recoveryInput.placeholder = 'XXXX-XXXX-XXXX-XXXX…';
    recField.append(recLabel, recoveryInput);
    form.appendChild(recField);
  }

  const pwField = el('div', 'form-field');
  const pwLabel = el(
    'label',
    'field-label',
    activeMode === 'forgot' ? 'Nouveau mot de passe (10 caractères min.)' : 'Mot de passe'
  );
  pwLabel.htmlFor = 'acc-password-input';
  const pwInput = el('input', 'ios-input');
  pwInput.id = 'acc-password-input';
  pwInput.name = 'password';
  pwInput.type = 'password';
  pwInput.required = true;
  pwInput.minLength = activeMode === 'login' ? 1 : 10;
  pwInput.autocomplete = activeMode === 'login' ? 'current-password' : 'new-password';
  pwInput.placeholder = activeMode === 'login' ? 'Votre mot de passe' : 'Au moins 10 caractères';
  pwField.append(pwLabel, pwInput);
  if (activeMode !== 'login') {
    pwField.appendChild(
      el('p', 'field-help', 'Choisissez au moins 10 caractères. Votre appareil pourra enregistrer ce mot de passe automatiquement.')
    );
  }
  form.appendChild(pwField);

  const tsSlot = el('div', 'turnstile-slot hidden');
  form.appendChild(tsSlot);
  form.appendChild(errBox);

  const submitBtn = el(
    'button',
    'btn-primary-ios',
    activeMode === 'login'
      ? 'Se connecter'
      : activeMode === 'register'
        ? 'Créer mon compte gratuit'
        : 'Réinitialiser mon mot de passe'
  );
  submitBtn.id = 'btn-account-submit';
  submitBtn.type = 'submit';
  if (!apiUrl) submitBtn.disabled = true;
  form.appendChild(submitBtn);

  if (activeMode === 'login') {
    const forgotBtn = el('button', 'account-forgot-link', 'Mot de passe oublié ?');
    forgotBtn.id = 'btn-open-forgot-password';
    forgotBtn.type = 'button';
    forgotBtn.addEventListener('click', () => {
      activeMode = 'forgot';
      renderAccountSheet();
    });
    form.appendChild(forgotBtn);
  } else if (activeMode === 'forgot') {
    form.appendChild(
      el(
        'p',
        'field-help',
        'Clé de récupération perdue ? Votre carnet reste accessible localement sur cet appareil : exportez une sauvegarde (.json) depuis les informations puis importez-la dans un nouveau compte.'
      )
    );
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.classList.add('hidden');
    errBox.textContent = '';

    if (!navigator.onLine) {
      errBox.textContent = 'Connexion Internet requise pour se connecter ou créer un compte.';
      errBox.classList.remove('hidden');
      return;
    }

    if (turnstileRequired && !turnstileToken) {
      errBox.textContent = 'Patientez une seconde ou validez la case de vérification anti-robot ci-dessus, puis réessayez.';
      errBox.classList.remove('hidden');
      return;
    }

    submitBtn.disabled = true;
    const origText = submitBtn.textContent;
    submitBtn.textContent = 'Connexion en cours…';

    try {
      if (activeMode === 'login') {
        await loginAccount({
          email: emailInput.value.trim(),
          password: pwInput.value,
          turnstileToken
        });
        hostCallbacks.showToast('Connecté ✓ Synchronisation en cours…');
      } else if (activeMode === 'register') {
        const res = await registerAccount({
          email: emailInput.value.trim(),
          password: pwInput.value,
          turnstileToken
        });
        pendingRecoveryKey = res.recoveryKey || '';
        hostCallbacks.showToast('Compte créé ✓ Notez votre clé de récupération !');
      } else {
        const res = await recoverAccount({
          email: emailInput.value.trim(),
          recoveryKey: recoveryInput.value.trim(),
          newPassword: pwInput.value,
          turnstileToken
        });
        pendingRecoveryKey = res.recoveryKey || '';
        activeMode = 'login';
        hostCallbacks.showToast('Mot de passe réinitialisé ✓');
      }

      cleanupTurnstileWidget();
      await requestPersistentStorage();
      await hostCallbacks.onSynced();
      await renderAccountSheet();
    } catch (err) {
      errBox.textContent = err?.message || 'Erreur d’authentification.';
      errBox.classList.remove('hidden');
      if (err?.code === 'TURNSTILE_REQUIRED' && !turnstileRequired) {
        await mountTurnstileIfNeeded(tsSlot);
      } else if (window.turnstile && turnstileWidgetId !== null) {
        try { window.turnstile.reset(turnstileWidgetId); } catch { /* ignoré */ }
        turnstileToken = '';
      }
      submitBtn.disabled = false;
      submitBtn.textContent = origText;
    }
  });

  card.appendChild(form);
  body.appendChild(card);

  if (activeMode !== 'login' && apiUrl) {
    mountTurnstileIfNeeded(tsSlot);
  }
}

async function appendStorageAndDriveCard(body) {
  const [stats, witness] = await Promise.all([getLocalStorageStats(), getBackupWitness()]);
  const driveCard = el('div', 'info-block');
  driveCard.appendChild(el('h3', '', 'PDF, Photos & Sauvegarde'));

  driveCard.appendChild(
    el(
      'p',
      'field-help',
      `Stockage local : ${stats.mediaCount} fichier${stats.mediaCount > 1 ? 's' : ''} (${formatSize(stats.mediaBytes)}) conservé${stats.mediaCount > 1 ? 's' : ''} hors connexion sur cet appareil${stats.persisted ? ' · stockage persistant activé ✓' : ''}.`
    )
  );

  if (stats.quotaBytes > 0) {
    const pct = Math.min(100, Math.round((stats.usageBytes / stats.quotaBytes) * 100));
    const barWrap = el('div', 'storage-bar-wrap');
    const track = el('div', 'progress-track');
    const fill = el('div', 'progress-fill');
    fill.style.width = `${Math.max(2, pct)}%`;
    track.appendChild(fill);
    const capLabel = el('span', 'storage-bar-label', `${formatSize(stats.usageBytes)} / ${formatSize(stats.quotaBytes)} disponibles sur cet appareil`);
    barWrap.append(track, capLabel);
    driveCard.appendChild(barWrap);
  }

  const witnessLines = [];
  if (witness.lastSyncAt) witnessLines.push(`Synchro cloud : ${formatDateTime(witness.lastSyncAt)}`);
  if (witness.lastDriveSyncAt) witnessLines.push(`Google Drive : ${formatDateTime(witness.lastDriveSyncAt)}`);
  witnessLines.push(`Export .json : ${formatDateTime(witness.lastBackupExportAt)}`);
  driveCard.appendChild(el('p', 'field-help backup-witness-inline', witnessLines.join(' · ')));

  if (isDriveConfigured()) {
    const driveEnabled = isDriveSyncEnabled();
    const stack = el('div', 'info-btn-stack');

    const toggleDriveBtn = el(
      'button',
      driveEnabled ? 'btn-secondary-ios' : 'btn-primary-ios',
      driveEnabled
        ? `Google Drive personnel relié (${stats.driveSyncedCount}/${stats.mediaCount} synchronisés)`
        : 'Synchroniser mes PDF sur mon Google Drive personnel'
    );
    toggleDriveBtn.id = 'btn-drive-connect';
    toggleDriveBtn.type = 'button';
    toggleDriveBtn.addEventListener('click', async () => {
      if (!navigator.onLine) {
        hostCallbacks.showToast('Connexion Internet requise pour relier Google Drive.');
        return;
      }
      toggleDriveBtn.disabled = true;
      try {
        await connectGoogleDrive({ prompt: driveEnabled ? '' : 'consent' });
        const res = await syncAllMediaWithDrive();
        await hostCallbacks.onSynced();
        hostCallbacks.showToast(
          res.uploaded > 0
            ? `${res.uploaded} fichier${res.uploaded > 1 ? 's' : ''} envoyé${res.uploaded > 1 ? 's' : ''} sur votre Google Drive ✓`
            : 'Google Drive personnel prêt ✓'
        );
        await renderAccountSheet();
      } catch (err) {
        hostCallbacks.showToast(err?.message || 'Connexion Google Drive annulée.');
        toggleDriveBtn.disabled = false;
      }
    });
    stack.appendChild(toggleDriveBtn);

    if (driveEnabled) {
      const disconnectBtn = el('button', 'btn-outline-ios', 'Déconnecter Google Drive');
      disconnectBtn.id = 'btn-drive-disconnect';
      disconnectBtn.type = 'button';
      disconnectBtn.addEventListener('click', async () => {
        disconnectGoogleDrive();
        await hostCallbacks.onSynced();
        hostCallbacks.showToast('Synchronisation Google Drive désactivée');
        await renderAccountSheet();
      });
      stack.appendChild(disconnectBtn);
    }

    driveCard.appendChild(stack);
  }

  body.appendChild(driveCard);
}

async function renderSignedInView(body, authState) {
  if (pendingRecoveryKey) {
    const keyCard = el('div', 'recovery-key-card');
    keyCard.id = 'recovery-key-banner';
    keyCard.appendChild(el('strong', 'recovery-key-title', 'Clé de récupération (affichée une seule fois)'));
    keyCard.appendChild(
      el(
        'p',
        'field-help',
        'Conservez cette clé en lieu sûr (ex. gestionnaire de mots de passe ou note sécurisée) : elle sert en cas de mot de passe oublié.'
      )
    );
    const codeEl = el('code', 'recovery-key-code', pendingRecoveryKey);
    codeEl.id = 'recovery-key-value';
    keyCard.appendChild(codeEl);

    const actions = el('div', 'recovery-key-actions');
    const copyBtn = el('button', 'btn-primary-ios', 'Copier la clé');
    copyBtn.type = 'button';
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(pendingRecoveryKey);
        hostCallbacks.showToast('Clé copiée ✓');
      } catch {
        hostCallbacks.showToast('Sélectionnez et copiez la clé manuellement.');
      }
    });
    const dismissBtn = el('button', 'btn-outline-ios', 'Je l’ai bien notée');
    dismissBtn.type = 'button';
    dismissBtn.addEventListener('click', () => {
      pendingRecoveryKey = '';
      renderAccountSheet();
    });
    actions.append(copyBtn, dismissBtn);
    keyCard.appendChild(actions);
    body.appendChild(keyCard);
  }

  const profileCard = el('div', 'info-block');
  profileCard.appendChild(el('h3', '', 'Mon compte'));
  profileCard.appendChild(el('p', 'account-email-line', authState.user?.email || 'Compte connecté'));
  profileCard.appendChild(
    el(
      'p',
      'field-help',
      `Session persistante active jusqu’au ${formatDateTime(authState.refreshExpiresAt)} (renouvelée automatiquement).`
    )
  );

  const quotaSlot = el('div', 'storage-bar-wrap hidden');
  quotaSlot.id = 'account-text-quota-wrap';
  profileCard.appendChild(quotaSlot);

  const btnStack = el('div', 'info-btn-stack');
  const syncNowBtn = el('button', 'btn-primary-ios', 'Synchroniser maintenant');
  syncNowBtn.id = 'btn-account-sync-now';
  syncNowBtn.type = 'button';
  syncNowBtn.addEventListener('click', async () => {
    if (!navigator.onLine) {
      hostCallbacks.showToast('Hors connexion : vos modifications partiront dès le retour d’Internet.');
      return;
    }
    syncNowBtn.disabled = true;
    await hostCallbacks.onSynced({ force: true });
    syncNowBtn.disabled = false;
    hostCallbacks.showToast('Carnet synchronisé ✓');
    await renderAccountSheet();
  });

  const logoutBtn = el('button', 'btn-outline-ios btn-danger-outline', 'Se déconnecter de cet appareil');
  logoutBtn.id = 'btn-account-logout';
  logoutBtn.type = 'button';
  logoutBtn.addEventListener('click', async () => {
    if (!confirm('Vous déconnecter de cet appareil ? Vos prières déjà enregistrées restent accessibles localement.')) {
      return;
    }
    pendingRecoveryKey = '';
    activeMode = 'login';
    await logoutAccount();
    hostCallbacks.onStatusChange('local');
    hostCallbacks.showToast('Déconnecté');
    await renderAccountSheet();
  });

  btnStack.append(syncNowBtn, logoutBtn);
  profileCard.appendChild(btnStack);
  body.appendChild(profileCard);

  await appendStorageAndDriveCard(body);

  const sessionsCard = el('div', 'info-block');
  sessionsCard.appendChild(el('h3', '', 'Appareils connectés'));
  const sessionsList = el('div', 'sessions-list');
  sessionsList.appendChild(
    el('p', 'field-help', navigator.onLine ? 'Chargement des appareils actifs…' : 'Consultable dès le retour en ligne.')
  );
  sessionsCard.appendChild(sessionsList);
  body.appendChild(sessionsCard);

  const pwDetails = el('details', 'account-advanced-details');
  pwDetails.appendChild(el('summary', 'account-advanced-summary', 'Changer mon mot de passe'));
  const pwForm = el('form', 'account-advanced-body');
  const curPw = el('input', 'ios-input');
  curPw.type = 'password';
  curPw.required = true;
  curPw.autocomplete = 'current-password';
  curPw.placeholder = 'Mot de passe actuel';
  const nextPw = el('input', 'ios-input');
  nextPw.type = 'password';
  nextPw.required = true;
  nextPw.minLength = 10;
  nextPw.autocomplete = 'new-password';
  nextPw.placeholder = 'Nouveau mot de passe (10 caractères min.)';
  const pwSubmit = el('button', 'btn-secondary-ios', 'Mettre à jour le mot de passe');
  pwSubmit.type = 'submit';
  pwForm.append(curPw, nextPw, pwSubmit);
  pwForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    pwSubmit.disabled = true;
    try {
      await changePassword({ currentPassword: curPw.value, newPassword: nextPw.value });
      curPw.value = '';
      nextPw.value = '';
      hostCallbacks.showToast('Mot de passe mis à jour (autres appareils déconnectés) ✓');
      await renderAccountSheet();
    } catch (err) {
      hostCallbacks.showToast(err?.message || 'Modification impossible.');
      pwSubmit.disabled = false;
    }
  });
  pwDetails.appendChild(pwForm);
  body.appendChild(pwDetails);

  if (navigator.onLine) {
    try {
      const data = await listSessions();
      if (data?.user) {
        const used = Number(data.user.textBytesUsed) || 0;
        const max = Number(data.user.maxTextBytes) || 2097152;
        const pct = Math.min(100, Math.round((used / max) * 100));
        quotaSlot.classList.remove('hidden');
        quotaSlot.replaceChildren();
        const track = el('div', 'progress-track');
        const fill = el('div', 'progress-fill');
        fill.style.width = `${Math.max(2, pct)}%`;
        track.appendChild(fill);
        quotaSlot.append(track, el('span', 'storage-bar-label', `Cloud texte : ${formatSize(used)} / ${formatSize(max)}`));
      }

      sessionsList.replaceChildren();
      const rows = data?.sessions || [];
      if (rows.length === 0) {
        sessionsList.appendChild(el('p', 'field-help', 'Aucune autre session active.'));
      } else {
        for (const s of rows) {
          const item = el('div', 'session-row');
          const info = el('div', 'session-row-info');
          const title = el('strong', '', s.deviceLabel || 'Appareil');
          if (s.isCurrent) {
            const pill = el('span', 'badge-novena', 'Cet appareil');
            const titleLine = el('div', 'session-title-line');
            titleLine.append(title, pill);
            info.appendChild(titleLine);
          } else {
            info.appendChild(title);
          }
          info.appendChild(el('span', 'session-meta', `Vu le ${formatDateTime(s.lastSeenAt)}`));
          item.appendChild(info);

          if (!s.isCurrent) {
            const revBtn = el('button', 'btn-outline-ios session-revoke-btn', 'Révoquer');
            revBtn.type = 'button';
            revBtn.addEventListener('click', async () => {
              revBtn.disabled = true;
              try {
                await revokeSession(s.id);
                hostCallbacks.showToast('Appareil déconnecté ✓');
                await renderAccountSheet();
              } catch {
                hostCallbacks.showToast('Impossible de révoquer cette session.');
                revBtn.disabled = false;
              }
            });
            item.appendChild(revBtn);
          }
          sessionsList.appendChild(item);
        }
      }
    } catch {
      sessionsList.replaceChildren(
        el('p', 'field-help', 'Impossible de charger la liste des appareils (mode hors connexion).')
      );
    }
  }
}

export async function renderAccountSheet() {
  const body = $('account-sheet-body');
  if (!body) return;
  cleanupTurnstileWidget();
  body.replaceChildren();

  const authState = getAuthState();
  const titleEl = $('sheet-account-title');
  if (titleEl) {
    titleEl.textContent = authState.signedIn ? 'Mon compte & Synchro' : 'Compte';
  }

  if (authState.signedIn) {
    await renderSignedInView(body, authState);
  } else {
    await renderGuestView(body);
  }
}

export async function openAccountSheet(callbacks = {}) {
  hostCallbacks = { ...hostCallbacks, ...callbacks };
  if (activeMode === 'forgot') activeMode = 'login';
  await renderAccountSheet();
}
