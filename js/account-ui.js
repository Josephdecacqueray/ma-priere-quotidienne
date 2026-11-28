/* =========================================================
   INTERFACE COMPTE, SESSIONS MULTI-APPAREILS & 5 Go GOOGLE DRIVE
   - Chargée dynamiquement uniquement à l'ouverture de #sheet-account
   - Zéro innerHTML sur données utilisateur ou externes (DOM pur)
   - Formulaires standard autocomplete="username" / password (Trousseau iCloud / Face ID)
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
import {
  getApiBaseUrl,
  setCustomApiBaseUrl,
  getGoogleClientId,
  setCustomGoogleClientId,
  fetchServerConfig
} from './config.js';
import { getLocalStorageStats, requestPersistentStorage } from './db.js';
import {
  isDriveSyncEnabled,
  isDriveConfigured,
  connectGoogleDrive,
  disconnectGoogleDrive,
  syncAllMediaWithDrive
} from './drive-sync.js';

let activeTab = 'login';
let pendingRecoveryKey = '';
let turnstileToken = '';
let turnstileWidgetId = null;
let turnstileScriptPromise = null;
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
  if (!ts) return '—';
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

async function mountTurnstileIfNeeded(slotEl) {
  turnstileToken = '';
  turnstileWidgetId = null;
  if (!slotEl || !navigator.onLine) return;
  const cfg = await fetchServerConfig();
  if (!cfg.turnstileSiteKey) return;
  try {
    const ts = await loadTurnstileScript();
    slotEl.classList.remove('hidden');
    turnstileWidgetId = ts.render(slotEl, {
      sitekey: cfg.turnstileSiteKey,
      theme: document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light',
      callback: (tok) => { turnstileToken = tok; },
      'expired-callback': () => { turnstileToken = ''; }
    });
  } catch {
    // Mode dégradé silencieux
  }
}

function buildAdvancedServerDetails(container) {
  const details = el('details', 'account-advanced-details');
  details.id = 'account-server-details';
  if (!getApiBaseUrl()) details.open = true;
  const summary = el('summary', 'account-advanced-summary', 'Configuration du serveur Cloudflare (avancé)');
  summary.id = 'account-server-summary';
  details.appendChild(summary);

  const box = el('div', 'account-advanced-body');
  box.appendChild(
    el(
      'p',
      'field-help',
      'Indiquez l’URL de votre Cloudflare Worker (ex. https://ma-priere-api.votre-compte.workers.dev) pour activer la synchronisation multi-appareils 0 €.'
    )
  );

  const urlInput = el('input', 'ios-input');
  urlInput.id = 'account-server-url-input';
  urlInput.type = 'url';
  urlInput.placeholder = 'https://ma-priere-api.exemple.workers.dev';
  urlInput.value = getApiBaseUrl();
  urlInput.setAttribute('aria-label', 'URL du serveur Cloudflare Worker');
  box.appendChild(urlInput);

  const saveUrlBtn = el('button', 'btn-outline-ios', 'Enregistrer l’adresse du serveur');
  saveUrlBtn.id = 'btn-account-server-save';
  saveUrlBtn.type = 'button';
  saveUrlBtn.addEventListener('click', async () => {
    const saved = setCustomApiBaseUrl(urlInput.value);
    if (urlInput.value.trim() && !saved) {
      hostCallbacks.showToast('Adresse invalide (HTTPS requis).');
      return;
    }
    hostCallbacks.showToast(saved ? 'Serveur Cloudflare enregistré ✓' : 'Adresse serveur effacée');
    await renderAccountSheet();
  });
  box.appendChild(saveUrlBtn);
  details.appendChild(box);
  container.appendChild(details);
}

async function renderGuestView(body) {
  const apiUrl = getApiBaseUrl();

  const intro = el('div', 'info-block');
  intro.appendChild(el('h3', '', 'Mode local & Compte gratuit'));
  intro.appendChild(
    el(
      'p',
      'field-help',
      'Vous pouvez utiliser toute l’application librement sans compte. Connectez-vous pour retrouver vos prières, neuvaines et intentions sur tous vos appareils : vos données locales seront fusionnées sans perte.'
    )
  );
  intro.appendChild(
    el(
      'p',
      'field-help account-pwa-note',
      'Connexion persistante 180 jours (compatible Trousseau iCloud / Face ID). En mode avion, votre session reste ouverte.'
    )
  );
  body.appendChild(intro);

  if (!apiUrl) {
    const warn = el('div', 'account-notice-card');
    warn.appendChild(el('strong', '', 'Serveur Cloudflare non encore relié'));
    warn.appendChild(
      el(
        'p',
        'field-help',
        'L’application fonctionne déjà à 100 % hors connexion sur cet appareil. Pour activer la synchronisation cloud gratuite, déployez le Worker puis renseignez son URL ci-dessous.'
      )
    );
    body.appendChild(warn);
  }

  // Onglets Connexion / Créer un compte / Récupération
  const tabs = el('div', 'segmented-control account-tabs');
  tabs.setAttribute('role', 'tablist');
  [
    { id: 'login', label: 'Connexion' },
    { id: 'register', label: 'Créer un compte' },
    { id: 'recover', label: 'Récupérer' }
  ].forEach((t) => {
    const b = el('button', `segment-btn${activeTab === t.id ? ' active' : ''}`, t.label);
    b.type = 'button';
    b.dataset.accountTab = t.id;
    b.addEventListener('click', () => {
      activeTab = t.id;
      renderAccountSheet();
    });
    tabs.appendChild(b);
  });
  body.appendChild(tabs);

  const card = el('div', 'info-block');
  const form = el('form', 'account-form');
  form.id = `account-form-${activeTab}`;

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
  if (activeTab === 'recover') {
    const recField = el('div', 'form-field');
    const recLabel = el('label', 'field-label', 'Clé de récupération (notée lors de l’inscription)');
    recLabel.htmlFor = 'acc-recovery-input';
    recoveryInput = el('input', 'ios-input account-mono-input');
    recoveryInput.id = 'acc-recovery-input';
    recoveryInput.type = 'text';
    recoveryInput.required = true;
    recoveryInput.autocomplete = 'off';
    recoveryInput.placeholder = 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX';
    recField.append(recLabel, recoveryInput);
    form.appendChild(recField);
  }

  const pwField = el('div', 'form-field');
  const pwLabel = el(
    'label',
    'field-label',
    activeTab === 'recover' ? 'Nouveau mot de passe (10 caractères min.)' : 'Mot de passe'
  );
  pwLabel.htmlFor = 'acc-password-input';
  const pwInput = el('input', 'ios-input');
  pwInput.id = 'acc-password-input';
  pwInput.name = 'password';
  pwInput.type = 'password';
  pwInput.required = true;
  pwInput.minLength = activeTab === 'login' ? 1 : 10;
  pwInput.autocomplete = activeTab === 'login' ? 'current-password' : 'new-password';
  pwInput.placeholder = activeTab === 'login' ? 'Votre mot de passe' : 'Au moins 10 caractères';
  pwField.append(pwLabel, pwInput);
  if (activeTab !== 'login') {
    pwField.appendChild(
      el('p', 'field-help', 'Choisissez une phrase secrète personnelle d’au moins 10 caractères. Votre iPhone pourra l’enregistrer avec Face ID.')
    );
  }
  form.appendChild(pwField);

  const tsSlot = el('div', 'turnstile-slot hidden');
  form.appendChild(tsSlot);
  form.appendChild(errBox);

  const submitBtn = el(
    'button',
    'btn-primary-ios',
    activeTab === 'login'
      ? 'Se connecter'
      : activeTab === 'register'
        ? 'Créer mon compte gratuit'
        : 'Réinitialiser mon mot de passe'
  );
  submitBtn.id = 'btn-account-submit';
  submitBtn.type = 'submit';
  if (!apiUrl) submitBtn.disabled = true;
  form.appendChild(submitBtn);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.classList.add('hidden');
    errBox.textContent = '';

    if (!navigator.onLine) {
      errBox.textContent = 'Connexion Internet requise pour se connecter ou créer un compte.';
      errBox.classList.remove('hidden');
      return;
    }

    submitBtn.disabled = true;
    const origText = submitBtn.textContent;
    submitBtn.textContent = 'Connexion en cours…';

    try {
      if (activeTab === 'login') {
        await loginAccount({
          email: emailInput.value.trim(),
          password: pwInput.value,
          turnstileToken
        });
        hostCallbacks.showToast('Connecté ✓ Fusion de vos données…');
      } else if (activeTab === 'register') {
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
        hostCallbacks.showToast('Mot de passe réinitialisé ✓');
      }

      await requestPersistentStorage();
      await hostCallbacks.onSynced();
      await renderAccountSheet();
    } catch (err) {
      errBox.textContent = err?.message || 'Erreur d’authentification.';
      errBox.classList.remove('hidden');
      if (window.turnstile && turnstileWidgetId !== null) {
        try { window.turnstile.reset(turnstileWidgetId); } catch { /* ignoré */ }
      }
      submitBtn.disabled = false;
      submitBtn.textContent = origText;
    }
  });

  card.appendChild(form);
  body.appendChild(card);

  // Stockage local + option Drive même avant connexion
  await appendStorageAndDriveCard(body);
  buildAdvancedServerDetails(body);

  if (activeTab !== 'login' && apiUrl) {
    mountTurnstileIfNeeded(tsSlot);
  }
}

async function appendStorageAndDriveCard(body) {
  const stats = await getLocalStorageStats();
  const driveCard = el('div', 'info-block');
  driveCard.appendChild(el('h3', '', 'PDF & Photos (jusqu’à 5 Go)'));

  const summary = el(
    'p',
    'field-help',
    `Stockage local : ${stats.mediaCount} fichier${stats.mediaCount > 1 ? 's' : ''} (${formatSize(stats.mediaBytes)}) conservé${stats.mediaCount > 1 ? 's' : ''} hors-ligne sur cet appareil${stats.persisted ? ' · stockage persistant activé ✓' : ''}.`
  );
  driveCard.appendChild(summary);

  if (stats.quotaBytes > 0) {
    const pct = Math.min(100, Math.round((stats.usageBytes / stats.quotaBytes) * 100));
    const barWrap = el('div', 'storage-bar-wrap');
    const track = el('div', 'progress-track');
    const fill = el('div', 'progress-fill');
    fill.style.width = `${Math.max(2, pct)}%`;
    track.appendChild(fill);
    const capLabel = el('span', 'storage-bar-label', `${formatSize(stats.usageBytes)} / ${formatSize(stats.quotaBytes)} dispo navigateur`);
    barWrap.append(track, capLabel);
    driveCard.appendChild(barWrap);
  }

  driveCard.appendChild(
    el(
      'p',
      'field-help',
      'Pour synchroniser jusqu’à 5 Go de PDF et photos entre vos appareils à 0 €, reliez votre Google Drive personnel (dossier privé caché de l’application uniquement, aucun accès à vos autres fichiers).'
    )
  );

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
    if (!isDriveConfigured()) {
      hostCallbacks.showToast('Ajoutez d’abord un Client ID Google OAuth dans le bloc ci-dessous.');
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
      hostCallbacks.showToast(err?.message === 'GOOGLE_CLIENT_ID_MISSING'
        ? 'Client ID Google OAuth non configuré.'
        : (err?.message || 'Connexion Google Drive annulée.'));
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

  if (!isDriveConfigured()) {
    const gDet = el('details', 'account-advanced-details');
    gDet.appendChild(el('summary', 'account-advanced-summary', 'Configurer le Client ID Google OAuth (optionnel)'));
    const gBox = el('div', 'account-advanced-body');
    const gInput = el('input', 'ios-input');
    gInput.type = 'text';
    gInput.placeholder = '1234567890-xxxx.apps.googleusercontent.com';
    gInput.value = getGoogleClientId();
    const gSave = el('button', 'btn-outline-ios', 'Enregistrer le Client ID Google');
    gSave.type = 'button';
    gSave.addEventListener('click', async () => {
      setCustomGoogleClientId(gInput.value);
      hostCallbacks.showToast('Client ID Google enregistré ✓');
      await renderAccountSheet();
    });
    gBox.append(gInput, gSave);
    gDet.appendChild(gBox);
    driveCard.appendChild(gDet);
  }

  body.appendChild(driveCard);
}

async function renderSignedInView(body, authState) {
  // Bannière clé de récupération affichée UNE SEULE FOIS après inscription/récupération
  if (pendingRecoveryKey) {
    const keyCard = el('div', 'recovery-key-card');
    keyCard.id = 'recovery-key-banner';
    keyCard.appendChild(el('strong', 'recovery-key-title', 'Clé de récupération (affichée une seule fois)'));
    keyCard.appendChild(
      el(
        'p',
        'field-help',
        'Conservez cette clé dans un endroit sûr (ex. Notes sécurisées ou gestionnaire de mots de passe). Elle permet de récupérer votre compte sans jamais exposer vos données.'
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

  // Carte profil & synchronisation texte
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
    await logoutAccount();
    hostCallbacks.onStatusChange('local');
    hostCallbacks.showToast('Déconnecté');
    await renderAccountSheet();
  });

  btnStack.append(syncNowBtn, logoutBtn);
  profileCard.appendChild(btnStack);
  body.appendChild(profileCard);

  // Stockage 5 Go PDF / Google Drive
  await appendStorageAndDriveCard(body);

  // Liste des appareils connectés
  const sessionsCard = el('div', 'info-block');
  sessionsCard.appendChild(el('h3', '', 'Appareils connectés'));
  const sessionsList = el('div', 'sessions-list');
  sessionsList.appendChild(
    el('p', 'field-help', navigator.onLine ? 'Chargement des appareils actifs…' : 'Consultable dès le retour en ligne.')
  );
  sessionsCard.appendChild(sessionsList);
  body.appendChild(sessionsCard);

  // Changement de mot de passe
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

  // Charger les sessions & quota D1 en direct si en ligne
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
  body.replaceChildren();

  const authState = getAuthState();
  const titleEl = $('sheet-account-title');
  if (titleEl) {
    titleEl.textContent = authState.signedIn ? 'Mon compte & Synchro' : 'Compte & Synchronisation';
  }

  if (authState.signedIn) {
    await renderSignedInView(body, authState);
  } else {
    await renderGuestView(body);
  }
}

export async function openAccountSheet(callbacks = {}) {
  hostCallbacks = { ...hostCallbacks, ...callbacks };
  await renderAccountSheet();
}
