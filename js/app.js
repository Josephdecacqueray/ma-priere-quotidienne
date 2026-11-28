import {
  initDbAndSeed,
  getAllPrayers,
  getPrayer,
  getPrayerBinary,
  savePrayer,
  deletePrayer,
  getAllNovenas,
  getNovena,
  saveNovena,
  deleteNovena,
  getAllIntentions,
  getIntention,
  saveIntention,
  deleteIntention,
  exportBackupData,
  importBackupData,
  getBackupWitness,
  requestPersistentStorage,
  generateId
} from './db.js';
import { syncWithServer, flushFeedbackQueue } from './sync.js';
import { initAuth, isSignedIn, onAuthChange } from './auth.js';
import { getLiturgicalSeason, getTodayRosarySummary } from './liturgy.js';

let formatterModPromise = null;
let icsModPromise = null;
let pdfViewerModPromise = null;
let pushModPromise = null;
let rosaryModPromise = null;
let cachedRosaryMod = null;

function loadFormatter() {
  if (!formatterModPromise) formatterModPromise = import('./formatter.js');
  return formatterModPromise;
}
function loadIcs() {
  if (!icsModPromise) icsModPromise = import('./ics.js');
  return icsModPromise;
}
function loadPdfViewer() {
  if (!pdfViewerModPromise) pdfViewerModPromise = import('./pdf-viewer.js');
  return pdfViewerModPromise;
}
function loadPush() {
  if (!pushModPromise) pushModPromise = import('./push.js');
  return pushModPromise;
}
function loadRosary() {
  if (!rosaryModPromise) {
    rosaryModPromise = import('./rosary.js').then((m) => {
      cachedRosaryMod = m;
      return m;
    });
  }
  return rosaryModPromise;
}
function stripFormattingForPreview(rawText) {
  return String(rawText ?? '')
    .replace(/^#{1,3}\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const FONT_SIZE_KEY = 'mpq_font_size_px';
const THEME_MODE_KEY = 'mpq_theme_mode';
const ROSARY_COUNTER_KEY = 'mpq_rosary_counter';
const ROSARY_UPDATED_KEY = 'mpq_rosary_updated_at';
const SETTINGS_UPDATED_KEY = 'mpq_settings_updated_at';
const STANDARD_FOLDERS = ['Matin', 'Soir', 'Saints', 'Litanies', 'Messe', 'Psaumes'];

function loadRosaryCounter() {
  const today = getTodayRosarySummary();
  try {
    const saved = JSON.parse(localStorage.getItem(ROSARY_COUNTER_KEY) || 'null');
    if (saved && saved.groupKey) {
      return {
        groupKey: saved.groupKey,
        decadeIndex: Math.max(0, Math.min(4, Number(saved.decadeIndex) || 0)),
        beadIndex: Math.max(0, Math.min(10, Number(saved.beadIndex) || 0))
      };
    }
  } catch {
    // Ignoré
  }
  return { groupKey: today.key, decadeIndex: 0, beadIndex: 0 };
}

const state = {
  prayers: [],
  novenas: [],
  intentions: [],
  activeTab: 'home',
  filterType: 'all',
  searchQuery: '',
  currentPrayerId: null,
  currentNovenaId: null,
  returnView: 'list',
  editingPrayer: false,
  focusMode: false,
  fontSizePx: Number(localStorage.getItem(FONT_SIZE_KEY)) || 15.5,
  themeMode: localStorage.getItem(THEME_MODE_KEY) || 'auto',
  pdfScale: 1,
  imageScale: 1,
  pendingPhotoBlob: null,
  rosaryFilter: 'all',
  rosaryCounter: loadRosaryCounter(),
  syncStatus: navigator.onLine ? 'idle' : 'offline'
};

let currentImageObjectUrl = null;
let wakeLockSentinel = null;

const $ = (id) => document.getElementById(id);

function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function computeCurrentDay(novena) {
  if (!novena?.startDate) return 1;
  const start = new Date(`${novena.startDate}T00:00:00`);
  const now = new Date(`${todayIso()}T00:00:00`);
  const diffDays = Math.floor((now - start) / 86400000) + 1;
  return Math.max(1, Math.min(novena.totalDays || 9, diffDays));
}

function formatShortDate(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function formatBytes(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

let toastTimer = null;
function showToast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2800);
}

/* =========================================================
   THÈME (JOUR / NUIT / AUTO) & COULEUR LITURGIQUE
   ========================================================= */
function applyTheme() {
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const resolved = state.themeMode === 'dark' || (state.themeMode === 'auto' && prefersDark)
    ? 'dark'
    : 'light';

  document.documentElement.setAttribute('data-theme', resolved);
  const metaTheme = $('meta-theme-color');
  if (metaTheme) metaTheme.setAttribute('content', resolved === 'dark' ? '#0B101B' : '#F6F5F1');

  const iconSvg = $('theme-icon-svg');
  if (iconSvg) {
    if (resolved === 'dark') {
      iconSvg.innerHTML = '<circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>';
    } else {
      iconSvg.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>';
    }
  }
}

function cycleTheme() {
  const order = ['auto', 'dark', 'light'];
  const next = order[(order.indexOf(state.themeMode) + 1) % order.length];
  state.themeMode = next;
  localStorage.setItem(THEME_MODE_KEY, next);
  localStorage.setItem(SETTINGS_UPDATED_KEY, String(Date.now()));
  applyTheme();
  scheduleServerSync();
  const labels = { auto: 'Thème automatique (appareil)', dark: 'Mode Nuit activé', light: 'Mode Jour activé' };
  showToast(labels[next]);
}

function applyLiturgicalSeason() {
  const season = getLiturgicalSeason(new Date());
  document.documentElement.style.setProperty('--liturgy-rgb', season.rgb);
  document.documentElement.style.setProperty('--liturgy-accent', season.accentHex);
  const nameEl = $('liturgy-name');
  if (nameEl) nameEl.textContent = season.name;
  const dateEl = $('today-date-label');
  if (dateEl) {
    dateEl.textContent = new Date().toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long'
    });
  }
}

/* =========================================================
   WAKE LOCK (ÉCRAN ALLUMÉ PENDANT LA PRIÈRE)
   ========================================================= */
function updateWakeLockButtons() {
  const active = Boolean(wakeLockSentinel);
  const label = active ? 'Écran actif' : 'Veille off';
  for (const id of ['btn-wake-lock', 'btn-rosary-wake-lock']) {
    const btn = $(id);
    if (!btn) continue;
    btn.textContent = label;
    btn.classList.toggle('is-active', active);
    btn.classList.toggle('is-active-wake', active);
  }
}

async function toggleWakeLock() {
  if (!('wakeLock' in navigator)) {
    showToast("Le maintien d'écran n'est pas supporté sur ce navigateur.");
    return;
  }
  if (wakeLockSentinel) {
    await releaseWakeLock();
    showToast('Mise en veille normale rétablie');
    return;
  }
  try {
    wakeLockSentinel = await navigator.wakeLock.request('screen');
    wakeLockSentinel.addEventListener('release', () => {
      wakeLockSentinel = null;
      updateWakeLockButtons();
    });
    updateWakeLockButtons();
    showToast("L'écran restera allumé pendant la prière");
  } catch {
    showToast("Impossible de maintenir l'écran allumé.");
  }
}

async function releaseWakeLock() {
  if (wakeLockSentinel) {
    try {
      await wakeLockSentinel.release();
    } catch {
      // Ignoré
    }
    wakeLockSentinel = null;
  }
  updateWakeLockButtons();
}

/* =========================================================
   SYNCHRO, COMPTE, CONTACT, PARTAGE & POLICES
   ========================================================= */
function setSyncStatus(status) {
  state.syncStatus = status;
  const pill = $('sync-status-btn');
  const label = $('offline-label');
  pill.classList.remove('is-offline', 'is-syncing', 'is-error', 'is-local');

  if (!navigator.onLine || status === 'offline') {
    pill.classList.add('is-offline');
    label.textContent = 'Hors connexion · Appareil';
  } else if (status === 'syncing') {
    pill.classList.add('is-syncing');
    label.textContent = 'Synchronisation…';
  } else if (status === 'quota') {
    pill.classList.add('is-error');
    label.textContent = 'Quota texte 2 Mo atteint';
  } else if (status === 'revoked') {
    pill.classList.add('is-error');
    label.textContent = 'Session fermée · Compte';
  } else if (status === 'error') {
    pill.classList.add('is-error');
    label.textContent = 'Sauvegardé sur l’appareil';
  } else if (status === 'synced') {
    label.textContent = 'Synchronisé ✓';
  } else if (!isSignedIn() || status === 'local') {
    pill.classList.add('is-local');
    label.textContent = 'Mode local · Compte';
  } else {
    label.textContent = 'Synchronisé ✓';
  }
}

let syncDebounceTimer = null;
function scheduleServerSync() {
  if (!isSignedIn()) return;
  clearTimeout(syncDebounceTimer);
  // Debounce 6 s pour limiter drastiquement les écritures D1 (1 000 comptes à 0 €)
  syncDebounceTimer = setTimeout(async () => {
    const res = await syncWithServer({ onStatus: setSyncStatus });
    if (res?.ok && !res.skipped) {
      await refreshFromDbOnly();
    } else if (res?.quotaExceeded) {
      showToast('Plafond 2 Mo de texte atteint. Utilisez Google Drive pour vos PDF.');
    }
  }, 6000);
}

let accountModulePromise = null;
async function openAccountModal() {
  openSheet('sheet-account');
  try {
    if (!accountModulePromise) {
      accountModulePromise = import('./account-ui.js');
    }
    const mod = await accountModulePromise;
    await mod.openAccountSheet({
      onSynced: async ({ force = false } = {}) => {
        const res = await syncWithServer({ force: true, onStatus: setSyncStatus });
        if (res?.ok || force) {
          await refreshFromDbOnly();
        }
        await refreshPushUi();
      },
      onStatusChange: (s) => setSyncStatus(s),
      showToast,
      closeSheet: closeAllSheets
    });
  } catch (err) {
    console.error('Erreur ouverture Compte:', err);
    showToast('Impossible d’ouvrir le panneau Compte.');
  }
}

let feedbackModulePromise = null;
async function openFeedbackModal() {
  openSheet('sheet-feedback');
  try {
    if (!feedbackModulePromise) {
      feedbackModulePromise = import('./feedback.js');
    }
    const mod = await feedbackModulePromise;
    await mod.prepareFeedbackSheet({
      showToast,
      closeSheet: closeAllSheets
    });
  } catch (err) {
    console.error('Erreur ouverture Contact:', err);
    showToast('Impossible d’ouvrir le formulaire.');
  }
}

async function shareApplication() {
  const url = window.location.href.split('#')[0];
  const shareData = {
    title: 'Ma prière quotidienne',
    text: 'Carnet de prières hors-ligne, chapelet interactif, neuvaines, Catéchisme & saint Thomas d’Aquin.',
    url
  };
  if (navigator.share) {
    try {
      await navigator.share(shareData);
      return;
    } catch {
      // Annulé ou indisponible -> fallback presse-papiers
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    showToast('Lien de l’application copié ✓');
  } catch {
    showToast(url);
  }
}

function applyPrayerFontSize() {
  document.documentElement.style.setProperty('--prayer-font-size', `${state.fontSizePx}px`);
  localStorage.setItem(FONT_SIZE_KEY, String(state.fontSizePx));
  localStorage.setItem(SETTINGS_UPDATED_KEY, String(Date.now()));
}

function adjustPrayerFontSize(delta) {
  state.fontSizePx = Math.max(13, Math.min(22, Number((state.fontSizePx + delta).toFixed(1))));
  applyPrayerFontSize();
  scheduleServerSync();
}

let laPriereModulePromise = null;
async function openLaPriereView() {
  showView('la-priere');
  try {
    if (!laPriereModulePromise) {
      laPriereModulePromise = import('./la-priere.js');
    }
    const mod = await laPriereModulePromise;
    await mod.openLaPriere({
      onExit: () => {
        showView('list');
        renderList();
      },
      adjustFontSize: adjustPrayerFontSize,
      showToast
    });
  } catch (err) {
    console.error('Erreur ouverture section La prière:', err);
    showToast("Impossible d'ouvrir la section La prière.");
  }
}

/* =========================================================
   NAVIGATION ENTRE VUES & MODALES
   ========================================================= */
function setFocusMode(enabled) {
  state.focusMode = Boolean(enabled);
  document.body.classList.toggle('focus-mode', state.focusMode);
  $('btn-exit-focus').classList.toggle('hidden', !state.focusMode);
}

function releasePrayerMediaResources() {
  if (pdfViewerModPromise) {
    pdfViewerModPromise.then((m) => m.releasePdfResources($('pdf-pages-container'))).catch(() => {});
  } else {
    const pdfBox = $('pdf-pages-container');
    if (pdfBox) pdfBox.replaceChildren();
  }
  if (currentImageObjectUrl) {
    URL.revokeObjectURL(currentImageObjectUrl);
    currentImageObjectUrl = null;
  }
  const imgBox = $('prayer-image-container');
  if (imgBox) imgBox.replaceChildren();
}

function syncBottomTabBar(activeKey, visible) {
  const bar = $('bottom-tab-bar');
  if (!bar) return;
  bar.classList.toggle('hidden', !visible);
  bar.querySelectorAll('.bottom-tab-btn').forEach((btn) => {
    const isActive = btn.dataset.navTab === activeKey;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
  });
}

function showView(name) {
  if (name !== 'prayer') {
    setFocusMode(false);
    releasePrayerMediaResources();
  }
  if (name === 'list') {
    releaseWakeLock();
  }
  $('view-list').classList.toggle('hidden', name !== 'list');
  $('view-prayer').classList.toggle('hidden', name !== 'prayer');
  $('view-novena').classList.toggle('hidden', name !== 'novena');
  $('view-intentions').classList.toggle('hidden', name !== 'intentions');
  $('view-rosary').classList.toggle('hidden', name !== 'rosary');
  $('view-la-priere').classList.toggle('hidden', name !== 'la-priere');

  const isRootView = name === 'list' || name === 'rosary';
  const activeNav = name === 'rosary' ? 'rosary' : (state.activeTab === 'rosary' ? 'home' : state.activeTab);
  syncBottomTabBar(activeNav, isRootView);
  window.scrollTo({ top: 0, behavior: 'instant' });
}

async function switchMainTab(tab, { focusSearch = false } = {}) {
  state.activeTab = tab;
  if (tab === 'rosary') {
    await openRosaryView(state.rosaryFilter || 'all');
    return;
  }
  showView('list');
  renderList();
  if (focusSearch && tab === 'carnet') {
    requestAnimationFrame(() => $('search-input')?.focus());
  }
}

function closeAllSheets() {
  $('modal-backdrop').classList.add('hidden');
  $('sheet-add').classList.add('hidden');
  $('sheet-pdf').classList.add('hidden');
  $('sheet-photo').classList.add('hidden');
  $('sheet-novena').classList.add('hidden');
  $('sheet-quick-intentions').classList.add('hidden');
  $('sheet-info').classList.add('hidden');
  $('sheet-account').classList.add('hidden');
  $('sheet-feedback').classList.add('hidden');
}

function openSheet(sheetId) {
  closeAllSheets();
  $('toast').classList.add('hidden');
  $('modal-backdrop').classList.remove('hidden');
  $(sheetId).classList.remove('hidden');
}

/* =========================================================
   CHARGEMENT & RENDU GLOBAL
   ========================================================= */
function formatWitnessDate(ts) {
  if (!ts) return 'aucun';
  try {
    const d = new Date(ts);
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    const hm = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    if (sameDay) return `aujourd’hui à ${hm}`;
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ` à ${hm}`;
  } catch {
    return '—';
  }
}

async function refreshBackupWitness() {
  try {
    const w = await getBackupWitness();
    const parts = [];
    if (w.lastSyncAt) parts.push(`Synchro cloud : ${formatWitnessDate(w.lastSyncAt)}`);
    if (w.lastDriveSyncAt) parts.push(`Drive : ${formatWitnessDate(w.lastDriveSyncAt)}`);
    parts.push(`Export .json : ${formatWitnessDate(w.lastBackupExportAt)}`);
    const line = parts.join(' · ');

    const homeEl = $('home-backup-witness');
    if (homeEl) homeEl.textContent = line;
    const infoEl = $('info-backup-witness');
    if (infoEl) infoEl.textContent = `Témoin de sauvegarde — ${line}`;
  } catch {
    // Ignoré
  }
}

async function refreshFromDbOnly() {
  const [prayers, novenas, intentions] = await Promise.all([
    getAllPrayers(),
    getAllNovenas(),
    getAllIntentions()
  ]);
  state.prayers = prayers;
  state.novenas = novenas;
  state.intentions = intentions;

  populateFolderSelects();
  renderList();
  refreshBackupWitness();
  if (!$('view-intentions').classList.contains('hidden')) {
    renderIntentionsView();
  }
  if (!$('view-novena').classList.contains('hidden') && state.currentNovenaId) {
    await renderCurrentNovena();
  }
  if (!$('view-prayer').classList.contains('hidden') && !state.editingPrayer && state.currentPrayerId) {
    await renderCurrentPrayer();
  }
  if (!$('sheet-quick-intentions').classList.contains('hidden')) {
    renderQuickIntentionsSheet();
  }
}

async function reloadData({ sync = true } = {}) {
  await refreshFromDbOnly();
  if (sync) {
    scheduleServerSync();
  }
}

function populateFolderSelects() {
  const used = new Set(STANDARD_FOLDERS);
  for (const p of state.prayers) {
    if (p.folder) used.add(p.folder);
  }
  const folders = Array.from(used);

  for (const id of ['edit-prayer-folder', 'pdf-folder-select', 'photo-folder-select']) {
    const sel = $(id);
    if (!sel) continue;
    const prev = sel.value;
    const defOpt = document.createElement('option');
    defOpt.value = '';
    defOpt.textContent = 'Aucun dossier';
    sel.replaceChildren(defOpt);
    for (const f of folders) {
      const opt = document.createElement('option');
      opt.value = f;
      opt.textContent = f;
      sel.appendChild(opt);
    }
    sel.value = prev;
  }

  // Filtres dynamiques pour les dossiers qui contiennent au moins 1 prière
  const usedInPrayers = Array.from(new Set(state.prayers.map((p) => p.folder).filter(Boolean)));
  const container = $('folder-filter-pills');
  if (container) {
    container.replaceChildren();
    for (const f of usedInPrayers) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pill-btn';
      btn.dataset.filter = `folder:${f}`;
      btn.textContent = f;
      btn.classList.toggle('active', state.filterType === `folder:${f}`);
      btn.addEventListener('click', () => {
        state.filterType = `folder:${f}`;
        syncFilterPillsActive();
        renderPrayersList();
      });
      container.appendChild(btn);
    }
  }
}

function syncFilterPillsActive() {
  document.querySelectorAll('#panel-prayers .pill-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.filter === state.filterType);
  });
}

function renderTodayCard() {
  const linksEl = $('today-summary-links');
  linksEl.innerHTML = '';

  const dueNovenas = state.novenas.filter((n) => {
    if ((n.completedDays || []).length >= n.totalDays) return false;
    const curDay = computeCurrentDay(n);
    return !(n.completedDays || []).includes(curDay);
  });

  if (dueNovenas.length > 0) {
    for (const n of dueNovenas.slice(0, 2)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'today-chip-btn is-novena';
      btn.textContent = `${n.title} • J${computeCurrentDay(n)}/${n.totalDays}`;
      btn.addEventListener('click', () => openNovena(n.id));
      linksEl.appendChild(btn);
    }
  }

  const todayRosary = getTodayRosarySummary();
  const rosaryBtn = document.createElement('button');
  rosaryBtn.type = 'button';
  rosaryBtn.className = 'today-chip-btn';
  rosaryBtn.textContent = `Chapelet : ${todayRosary.title}`;
  rosaryBtn.addEventListener('click', () => openRosaryView(todayRosary.key));
  linksEl.appendChild(rosaryBtn);

  const pinnedWrap = $('today-pinned-chips');
  const pinnedPrayers = state.prayers.filter((p) => p.pinned);
  if (pinnedPrayers.length > 0) {
    pinnedWrap.classList.remove('hidden');
    pinnedWrap.innerHTML = '';
    for (const p of pinnedPrayers.slice(0, 4)) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'pinned-quick-chip';
      chip.textContent = p.title || 'Prière';
      chip.addEventListener('click', () => openPrayer(p.id, 'list'));
      pinnedWrap.appendChild(chip);
    }
  } else {
    pinnedWrap.classList.add('hidden');
    pinnedWrap.innerHTML = '';
  }
}

function renderGlobalSearchResults() {
  const q = state.searchQuery.trim().toLowerCase();
  const box = $('global-search-results');

  if (!q) {
    box.classList.add('hidden');
    box.replaceChildren();
    return 0;
  }

  box.replaceChildren();

  const matchingIntentions = state.intentions.filter((i) => (i.text || '').toLowerCase().includes(q));
  const matchingMysteries = [];
  if (!cachedRosaryMod) {
    loadRosary().then(() => {
      if (state.searchQuery.trim()) renderList();
    }).catch(() => {});
  } else {
    for (const g of cachedRosaryMod.ROSARY_GROUPS) {
      for (const m of g.mysteries) {
        const hay = `${g.title} ${m.title} ${m.fruit} ${m.meditation} ${m.ref}`.toLowerCase();
        if (hay.includes(q)) {
          matchingMysteries.push({ group: g, mystery: m });
        }
      }
    }
  }

  if (matchingIntentions.length === 0 && matchingMysteries.length === 0) {
    box.classList.add('hidden');
    return 0;
  }

  box.classList.remove('hidden');

  if (matchingIntentions.length > 0) {
    const card = document.createElement('div');
    card.className = 'global-search-card';
    const heading = document.createElement('h3');
    heading.className = 'global-search-heading';
    heading.textContent = 'Dans Mes intentions';
    card.appendChild(heading);
    for (const item of matchingIntentions.slice(0, 4)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'global-search-hit';
      const strong = document.createElement('strong');
      strong.textContent = 'Intention';
      const span = document.createElement('span');
      span.textContent = item.text || '';
      btn.append(strong, span);
      btn.addEventListener('click', openIntentionsView);
      card.appendChild(btn);
    }
    box.appendChild(card);
  }

  if (matchingMysteries.length > 0) {
    const card = document.createElement('div');
    card.className = 'global-search-card';
    const heading = document.createElement('h3');
    heading.className = 'global-search-heading';
    heading.textContent = 'Dans les Mystères du chapelet';
    card.appendChild(heading);
    for (const hit of matchingMysteries.slice(0, 4)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'global-search-hit';
      const strong = document.createElement('strong');
      strong.textContent = `${hit.mystery.title} (${hit.group.title})`;
      const span = document.createElement('span');
      span.textContent = hit.mystery.meditation;
      btn.append(strong, span);
      btn.addEventListener('click', () => openRosaryView(hit.group.key));
      card.appendChild(btn);
    }
    box.appendChild(card);
  }

  return matchingIntentions.length + matchingMysteries.length;
}

function renderList() {
  const pBadge = $('count-prayers-badge');
  if (pBadge) {
    pBadge.textContent = String(state.prayers.length);
    pBadge.classList.toggle('hidden', state.prayers.length === 0);
  }
  const nBadge = $('count-novenas-badge');
  if (nBadge) {
    nBadge.textContent = String(state.novenas.length);
    nBadge.classList.toggle('hidden', state.novenas.length === 0);
  }

  const activeIntentions = state.intentions.filter((i) => !i.done);
  const novenaWithIntentions = state.novenas.filter((n) => (n.intention || '').trim() !== '');
  const totalBadge = activeIntentions.length || state.intentions.length;
  $('count-intentions-badge').textContent = String(totalBadge);
  if (activeIntentions.length > 0) {
    $('intentions-home-sub').textContent = activeIntentions[0].text;
  } else if (novenaWithIntentions.length > 0) {
    $('intentions-home-sub').textContent = `${novenaWithIntentions.length} intention${novenaWithIntentions.length > 1 ? 's' : ''} de neuvaine`;
  } else {
    $('intentions-home-sub').textContent = 'Carnet de toutes mes intentions';
  }

  const tab = state.activeTab === 'carnet' || state.activeTab === 'novenas' ? state.activeTab : 'home';

  const brandTitle = $('main-brand-title');
  if (brandTitle) {
    brandTitle.textContent = tab === 'carnet'
      ? 'Carnet de prières'
      : tab === 'novenas'
        ? 'Mes neuvaines'
        : 'Ma prière quotidienne';
  }

  $('carnet-search-wrap')?.classList.toggle('hidden', tab !== 'carnet');
  $('btn-header-search')?.classList.toggle('hidden', tab === 'carnet');

  $('panel-home')?.classList.toggle('hidden', tab !== 'home');
  $('panel-prayers')?.classList.toggle('hidden', tab !== 'carnet');
  $('panel-novenas')?.classList.toggle('hidden', tab !== 'novenas');

  if (!$('view-list').classList.contains('hidden')) {
    syncBottomTabBar(tab, true);
  }

  if (tab === 'home') {
    renderTodayCard();
    renderHomeRecentPrayers();
  } else if (tab === 'carnet') {
    const extraHits = renderGlobalSearchResults();
    const prayerHits = renderPrayersList();
    const countEl = $('search-results-count');
    if (countEl) {
      const q = state.searchQuery.trim();
      if (q) {
        const total = prayerHits + extraHits;
        countEl.textContent = `${total} résultat${total > 1 ? 's' : ''}`;
        countEl.classList.remove('hidden');
      } else {
        countEl.classList.add('hidden');
      }
    }
  } else if (tab === 'novenas') {
    renderNovenasList();
  }
}

/* Swipe-to-reveal helper pour les lignes de prières */
function attachSwipeHandlers(rowEl, contentEl) {
  let startX = 0;
  let startY = 0;
  let dragging = false;
  let currentOffset = 0;
  const maxReveal = -128;

  const closeOthers = () => {
    document.querySelectorAll('.swipe-row.is-open').forEach((el) => {
      if (el !== rowEl) {
        el.classList.remove('is-open');
        const c = el.querySelector('.swipe-content');
        if (c) c.style.transform = 'translateX(0px)';
      }
    });
  };

  const onStart = (x, y) => {
    startX = x;
    startY = y;
    dragging = false;
    currentOffset = rowEl.classList.contains('is-open') ? maxReveal : 0;
  };

  const onMove = (x, y) => {
    const dx = x - startX;
    const dy = y - startY;
    if (!dragging) {
      if (Math.abs(dx) < 10 || Math.abs(dy) > Math.abs(dx)) return;
      dragging = true;
      closeOthers();
      rowEl.classList.add('is-swiping');
      contentEl.style.transition = 'none';
    }
    const next = Math.max(maxReveal, Math.min(0, currentOffset + dx));
    contentEl.style.transform = `translateX(${next}px)`;
  };

  const onEnd = (x) => {
    if (!dragging) return;
    contentEl.style.transition = '';
    rowEl.classList.remove('is-swiping');
    const dx = x - startX;
    const finalOffset = currentOffset + dx;
    if (finalOffset < maxReveal / 2) {
      rowEl.classList.add('is-open');
      contentEl.style.transform = `translateX(${maxReveal}px)`;
    } else {
      rowEl.classList.remove('is-open');
      contentEl.style.transform = 'translateX(0px)';
    }
    dragging = false;
  };

  contentEl.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    onStart(t.clientX, t.clientY);
  }, { passive: true });
  contentEl.addEventListener('touchmove', (e) => {
    const t = e.touches[0];
    onMove(t.clientX, t.clientY);
  }, { passive: true });
  contentEl.addEventListener('touchend', (e) => {
    const t = e.changedTouches[0];
    onEnd(t.clientX);
  });
}

async function togglePrayerPinned(id) {
  const p = await getPrayer(id);
  if (!p) return;
  p.pinned = !p.pinned;
  p.updatedAt = Date.now();
  await savePrayer(p);
  await reloadData({ sync: true });
  showToast(p.pinned ? 'Prière épinglée en haut' : 'Prière désépinglée');
}

function buildPrayerRowElement(p) {
  const linkedNovena = state.novenas.find((n) => n.prayerId === p.id);
  const swipeRow = document.createElement('div');
  swipeRow.className = 'swipe-row';

  const actions = document.createElement('div');
  actions.className = 'swipe-actions';

  const pinAct = document.createElement('button');
  pinAct.type = 'button';
  pinAct.className = 'swipe-act-btn swipe-act-pin';
  pinAct.textContent = p.pinned ? 'Retirer' : 'Épingler';
  pinAct.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePrayerPinned(p.id);
  });

  const delAct = document.createElement('button');
  delAct.type = 'button';
  delAct.className = 'swipe-act-btn swipe-act-del';
  delAct.textContent = 'Suppr.';
  delAct.addEventListener('click', (e) => {
    e.stopPropagation();
    confirmAndDeletePrayer(p.id);
  });

  actions.appendChild(pinAct);
  actions.appendChild(delAct);

  const content = document.createElement('div');
  content.className = 'swipe-content';

  const mainBtn = document.createElement('button');
  mainBtn.type = 'button';
  mainBtn.className = 'note-row-main';

  const top = document.createElement('div');
  top.className = 'note-row-top';

  const title = document.createElement('span');
  title.className = 'note-row-title';
  title.textContent = p.title || 'Sans titre';
  top.appendChild(title);

  const badges = document.createElement('span');
  badges.className = 'note-row-badges';
  if (p.pinned) {
    const b = document.createElement('span');
    b.className = 'badge-pin';
    b.textContent = 'Épinglée';
    badges.appendChild(b);
  }
  if (p.type === 'pdf') {
    const b = document.createElement('span');
    b.className = 'badge-pdf';
    b.textContent = 'PDF';
    badges.appendChild(b);
  } else if (p.type === 'image') {
    const b = document.createElement('span');
    b.className = 'badge-photo';
    b.textContent = 'Photo';
    badges.appendChild(b);
  }
  if (linkedNovena) {
    const b = document.createElement('span');
    b.className = 'badge-novena';
    b.textContent = `${(linkedNovena.completedDays || []).length}/${linkedNovena.totalDays}j`;
    badges.appendChild(b);
  }
  top.appendChild(badges);
  mainBtn.appendChild(top);

  const preview = document.createElement('div');
  preview.className = 'note-row-preview';
  if (p.type === 'pdf') {
    preview.textContent = `Document PDF${p.fileName ? ` • ${p.fileName}` : ''}${p.fileSize ? ` (${formatBytes(p.fileSize)})` : ''}`;
  } else if (p.type === 'image') {
    preview.textContent = `Photo / Scan${p.fileSize ? ` (${formatBytes(p.fileSize)})` : ''}`;
  } else {
    preview.textContent = stripFormattingForPreview(p.content) || 'Note vide…';
  }
  mainBtn.appendChild(preview);

  const meta = document.createElement('div');
  meta.className = 'note-row-meta';
  const dateTxt = p.updatedAt && p.updatedAt > 1000
    ? `Modifiée ${formatShortDate(p.updatedAt)}`
    : 'Prière incluse';
  meta.textContent = dateTxt;
  if (p.folder) {
    const fTag = document.createElement('span');
    fTag.className = 'folder-tag';
    fTag.textContent = p.folder;
    meta.appendChild(fTag);
  }
  mainBtn.appendChild(meta);

  mainBtn.addEventListener('click', () => {
    if (swipeRow.classList.contains('is-open')) {
      swipeRow.classList.remove('is-open');
      content.style.transform = 'translateX(0px)';
      return;
    }
    openPrayer(p.id, 'list');
  });

  content.appendChild(mainBtn);
  swipeRow.appendChild(actions);
  swipeRow.appendChild(content);
  attachSwipeHandlers(swipeRow, content);
  return swipeRow;
}

function renderHomeRecentPrayers() {
  const sec = $('home-recent-section');
  const listEl = $('home-recent-list');
  const countLabel = $('home-carnet-count-label');
  if (!sec || !listEl) return;

  const recent = state.prayers.slice(0, 3);
  sec.classList.toggle('hidden', recent.length === 0);
  if (countLabel) {
    countLabel.textContent = `Carnet (${state.prayers.length})`;
  }
  listEl.replaceChildren();
  for (const p of recent) {
    listEl.appendChild(buildPrayerRowElement(p));
  }
}

function renderPrayersList() {
  const q = state.searchQuery.trim().toLowerCase();
  const filtered = state.prayers.filter((p) => {
    if (state.filterType === 'pinned' && !p.pinned) return false;
    else if (state.filterType.startsWith('folder:')) {
      if ((p.folder || '') !== state.filterType.slice(7)) return false;
    } else if (state.filterType !== 'all' && state.filterType !== 'pinned' && p.type !== state.filterType) {
      return false;
    }
    if (!q) return true;
    const hay = `${p.title || ''} ${p.content || ''} ${p.fileName || ''} ${p.folder || ''}`.toLowerCase();
    return hay.includes(q);
  });

  const container = $('prayers-list');
  container.replaceChildren();
  $('prayers-empty').classList.toggle('hidden', filtered.length > 0);

  for (const p of filtered) {
    container.appendChild(buildPrayerRowElement(p));
  }
  return filtered.length;
}

function renderNovenasList() {
  const q = state.searchQuery.trim().toLowerCase();
  const filtered = state.novenas.filter((n) => {
    if (!q) return true;
    const hay = `${n.title || ''} ${n.intention || ''}`.toLowerCase();
    return hay.includes(q);
  });

  const dueToday = state.novenas.filter((n) => {
    const doneCount = (n.completedDays || []).length;
    if (doneCount >= n.totalDays) return false;
    const curDay = computeCurrentDay(n);
    return !(n.completedDays || []).includes(curDay);
  });

  const banner = $('novena-reminder-banner');
  if (dueToday.length > 0) {
    banner.classList.remove('hidden');
    const txtSpan = document.createElement('span');
    const countStrong = document.createElement('strong');
    countStrong.textContent = String(dueToday.length);
    txtSpan.append(
      countStrong,
      document.createTextNode(` neuvaine${dueToday.length > 1 ? 's' : ''} à prier aujourd'hui`)
    );
    const quickBtn = document.createElement('button');
    quickBtn.type = 'button';
    quickBtn.className = 'btn-validate-day';
    quickBtn.textContent = 'Ouvrir';
    quickBtn.addEventListener('click', () => openNovena(dueToday[0].id));
    banner.replaceChildren(txtSpan, quickBtn);
  } else {
    banner.classList.add('hidden');
    banner.replaceChildren();
  }

  const container = $('novenas-list');
  container.replaceChildren();
  $('novenas-empty').classList.toggle('hidden', filtered.length > 0);

  for (const n of filtered) {
    const done = (n.completedDays || []).length;
    const total = n.totalDays || 9;
    const pct = Math.min(100, Math.round((done / total) * 100));

    const row = document.createElement('div');
    row.className = 'note-row';

    const mainBtn = document.createElement('button');
    mainBtn.type = 'button';
    mainBtn.className = 'note-row-main';

    const top = document.createElement('div');
    top.className = 'note-row-top';

    const title = document.createElement('span');
    title.className = 'note-row-title';
    title.textContent = n.title || 'Neuvaine';
    top.appendChild(title);

    const badge = document.createElement('span');
    badge.className = 'badge-novena';
    badge.textContent = done >= total ? 'Terminée ✓' : `Jour ${computeCurrentDay(n)}/${total}`;
    top.appendChild(badge);
    mainBtn.appendChild(top);

    if (n.intention) {
      const intent = document.createElement('div');
      intent.className = 'note-row-preview';
      intent.textContent = n.intention;
      mainBtn.appendChild(intent);
    }

    const prog = document.createElement('div');
    prog.className = 'novena-row-progress';
    const track = document.createElement('div');
    track.className = 'progress-track';
    const fill = document.createElement('div');
    fill.className = 'progress-fill';
    fill.style.width = `${pct}%`;
    track.appendChild(fill);
    const pLabel = document.createElement('span');
    pLabel.className = 'progress-label';
    pLabel.textContent = `${done}/${total} j`;
    prog.append(track, pLabel);
    mainBtn.appendChild(prog);

    const meta = document.createElement('div');
    meta.className = 'note-row-meta';
    meta.textContent = n.reminder?.enabled
      ? `Rappel ${n.reminder.time || '08:00'} • ${channelLabel(n.reminder.channel)}`
      : 'Rappel désactivé';
    mainBtn.appendChild(meta);

    mainBtn.addEventListener('click', () => openNovena(n.id));

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'row-delete-btn';
    delBtn.setAttribute('aria-label', `Supprimer ${n.title || 'cette neuvaine'}`);
    delBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path></svg>`;
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      confirmAndDeleteNovena(n.id);
    });

    row.appendChild(mainBtn);
    row.appendChild(delBtn);
    container.appendChild(row);
  }
}

function channelLabel(ch) {
  if (ch === 'sms') return 'SMS';
  if (ch === 'email') return 'E-mail';
  return 'Appareil';
}

/* =========================================================
   VUE PRIÈRE (LECTURE / ÉDITION / PDF / PHOTO)
   ========================================================= */
async function openPrayer(id, returnView = 'list', startEditing = false) {
  const prayer = await getPrayer(id);
  if (!prayer) {
    showToast('Prière introuvable.');
    return;
  }
  state.currentPrayerId = id;
  state.returnView = returnView;
  state.editingPrayer = Boolean(startEditing && prayer.type === 'text');
  state.pdfScale = 1;
  state.imageScale = 1;

  $('prayer-back-label').textContent = returnView === 'novena' ? 'Neuvaine' : 'Prières';
  showView('prayer');
  await renderCurrentPrayer();
}

async function renderCurrentPrayer() {
  const prayer = await getPrayer(state.currentPrayerId);
  if (!prayer) return;

  const isText = prayer.type === 'text';
  const isPdf = prayer.type === 'pdf';
  const isImage = prayer.type === 'image';

  $('btn-prayer-edit-toggle').classList.toggle('hidden', !isText);
  $('btn-prayer-edit-toggle').textContent = state.editingPrayer ? 'OK' : 'Modifier';
  $('btn-prayer-pin').classList.toggle('is-pinned', Boolean(prayer.pinned));
  $('btn-prayer-focus').classList.toggle('hidden', state.editingPrayer || !isText);

  const linkedNovena = state.returnView === 'novena' && state.currentNovenaId
    ? await getNovena(state.currentNovenaId)
    : state.novenas.find((n) => n.prayerId === prayer.id);

  const novBar = $('prayer-novena-bar');
  if (linkedNovena) {
    novBar.classList.remove('hidden');
    const curDay = computeCurrentDay(linkedNovena);
    const isDone = (linkedNovena.completedDays || []).includes(curDay);
    $('prayer-novena-name').textContent = linkedNovena.title;
    $('prayer-novena-progress').textContent = `Jour ${curDay} / ${linkedNovena.totalDays}`;
    const btn = $('btn-prayer-novena-validate');
    btn.textContent = isDone ? `✓ Jour ${curDay} validé` : `✓ Valider le Jour ${curDay}`;
    btn.classList.toggle('is-done', isDone);
    btn.onclick = async () => {
      await toggleNovenaDay(linkedNovena.id, curDay);
      await renderCurrentPrayer();
    };
  } else {
    novBar.classList.add('hidden');
  }

  $('prayer-read-pane').classList.toggle('hidden', !isText || state.editingPrayer);
  $('prayer-edit-pane').classList.toggle('hidden', !isText || !state.editingPrayer);
  $('prayer-pdf-pane').classList.toggle('hidden', !isPdf);
  $('prayer-image-pane').classList.toggle('hidden', !isImage);

  if (isText) {
    if (state.editingPrayer) {
      $('edit-prayer-title').value = prayer.title || '';
      $('edit-prayer-folder').value = prayer.folder || '';
      $('edit-prayer-content').value = prayer.content || '';
    } else {
      $('prayer-meta-date').textContent = prayer.updatedAt && prayer.updatedAt > 1000
        ? `Modifiée le ${new Date(prayer.updatedAt).toLocaleDateString('fr-FR')}`
        : 'Carnet de prières';
      const fBadge = $('prayer-folder-badge');
      if (prayer.folder) {
        fBadge.textContent = prayer.folder;
        fBadge.classList.remove('hidden');
      } else {
        fBadge.classList.add('hidden');
      }
      $('prayer-cover-title').textContent = prayer.title || 'Prière sans titre';
      const fmtMod = await loadFormatter();
      fmtMod.renderPrayerContentToNode($('prayer-rendered-body'), prayer.content || '');
    }
  } else if (isPdf) {
    const bin = getPrayerBinary(prayer);
    $('pdf-zoom-label').textContent = `${Math.round(state.pdfScale * 100)}%`;
    $('btn-pdf-open-native').onclick = async () => {
      if (bin) {
        const pdfMod = await loadPdfViewer();
        pdfMod.openPdfNatively(bin, prayer.fileName || 'priere.pdf');
      }
    };
    const container = $('pdf-pages-container');
    if (!bin) {
      renderMissingMediaDriveCard(container, prayer, 'PDF');
      return;
    }
    try {
      const pdfMod = await loadPdfViewer();
      await pdfMod.renderPdfIntoContainer(bin, container, {
        scale: state.pdfScale,
        onPageCount: (count) => {
          $('pdf-page-info').textContent = `${prayer.title || 'PDF'} • ${count} page${count > 1 ? 's' : ''}`;
        }
      });
    } catch (err) {
      const box = document.createElement('div');
      box.className = 'empty-state';
      const titleEl = document.createElement('p');
      titleEl.className = 'empty-title';
      titleEl.textContent = 'Aperçu PDF indisponible';
      const subEl = document.createElement('p');
      subEl.className = 'empty-sub';
      subEl.textContent = err?.message || 'Erreur de lecture du document.';
      const fb = document.createElement('button');
      fb.id = 'btn-fallback-pdf';
      fb.className = 'btn-primary-soft';
      fb.type = 'button';
      fb.textContent = 'Ouvrir le PDF dans le lecteur système';
      fb.addEventListener('click', async () => {
        const pdfMod = await loadPdfViewer();
        pdfMod.openPdfNatively(bin, prayer.fileName);
      });
      box.append(titleEl, subEl, fb);
      container.replaceChildren(box);
    }
  } else if (isImage) {
    const bin = getPrayerBinary(prayer);
    $('image-title-info').textContent = prayer.title || 'Photo de prière';
    $('image-zoom-label').textContent = `${Math.round(state.imageScale * 100)}%`;
    const container = $('prayer-image-container');
    container.replaceChildren();
    if (!bin) {
      renderMissingMediaDriveCard(container, prayer, 'Photo');
      return;
    }
    if (currentImageObjectUrl) URL.revokeObjectURL(currentImageObjectUrl);
    currentImageObjectUrl = URL.createObjectURL(bin);
    const img = document.createElement('img');
    img.src = currentImageObjectUrl;
    img.alt = prayer.title || 'Prière en photo';
    img.className = 'prayer-photo-full';
    img.style.width = `${Math.round(state.imageScale * 100)}%`;
    container.appendChild(img);

    $('btn-image-open-native').onclick = async () => {
      const pdfMod = await loadPdfViewer();
      pdfMod.openPdfNatively(bin, prayer.fileName || 'priere.jpg');
    };
  }
}

function renderMissingMediaDriveCard(container, prayer, kindLabel) {
  const card = document.createElement('div');
  card.className = 'pdf-drive-card';

  const title = document.createElement('p');
  title.className = 'empty-title';
  title.textContent = `${kindLabel} non présent sur cet appareil`;
  card.appendChild(title);

  const sub = document.createElement('p');
  sub.className = 'empty-sub';

  if (prayer.driveFileId) {
    sub.textContent = 'Ce fichier est sauvegardé sur votre Google Drive personnel (0 octet sur notre serveur). Touchez ci-dessous pour le télécharger hors-ligne sur cet appareil.';
    card.appendChild(sub);

    const dlBtn = document.createElement('button');
    dlBtn.type = 'button';
    dlBtn.className = 'btn-primary-ios';
    dlBtn.textContent = 'Télécharger depuis mon Google Drive';
    dlBtn.addEventListener('click', async () => {
      if (!navigator.onLine) {
        showToast('Connexion Internet requise pour télécharger depuis Google Drive.');
        return;
      }
      dlBtn.disabled = true;
      dlBtn.textContent = 'Téléchargement…';
      try {
        const mod = await import('./drive-sync.js');
        await mod.downloadPrayerMediaFromDrive(prayer);
        await refreshFromDbOnly();
        await renderCurrentPrayer();
        showToast(`${kindLabel} téléchargé et prêt hors-ligne ✓`);
      } catch (err) {
        showToast(err?.message || 'Téléchargement Google Drive impossible.');
        dlBtn.disabled = false;
        dlBtn.textContent = 'Télécharger depuis mon Google Drive';
      }
    });
    card.appendChild(dlBtn);
  } else {
    sub.textContent = 'Ce fichier a été ajouté depuis un autre appareil sans synchronisation Google Drive. Activez Google Drive (jusqu’à 5 Go gratuit) dans Compte pour retrouver vos PDF partout.';
    card.appendChild(sub);

    const accBtn = document.createElement('button');
    accBtn.type = 'button';
    accBtn.className = 'btn-outline-ios';
    accBtn.textContent = 'Configurer Google Drive (5 Go)';
    accBtn.addEventListener('click', openAccountModal);
    card.appendChild(accBtn);
  }

  container.replaceChildren(card);
}

async function saveEditedPrayer({ exitEdit = false, silent = false } = {}) {
  const prayer = await getPrayer(state.currentPrayerId);
  if (!prayer || prayer.type !== 'text') return;
  const nextTitle = $('edit-prayer-title').value.trim() || 'Prière sans titre';
  const nextFolder = $('edit-prayer-folder').value || '';
  const nextContent = $('edit-prayer-content').value;
  if (prayer.title === nextTitle && (prayer.folder || '') === nextFolder && prayer.content === nextContent && !exitEdit) {
    return;
  }

  prayer.title = nextTitle;
  prayer.folder = nextFolder;
  prayer.content = nextContent;
  prayer.updatedAt = Date.now();
  await savePrayer(prayer);
  await reloadData({ sync: true });
  if (exitEdit) {
    state.editingPrayer = false;
    await renderCurrentPrayer();
    if (!silent) showToast('Prière enregistrée');
  }
}

async function createNewTextPrayer() {
  const now = Date.now();
  const prayer = {
    id: generateId('prayer'),
    type: 'text',
    title: 'Nouvelle prière',
    folder: '',
    pinned: false,
    content: '',
    createdAt: now,
    updatedAt: now
  };
  await savePrayer(prayer);
  await reloadData({ sync: true });
  await openPrayer(prayer.id, 'list', true);
  $('edit-prayer-title').select();
}

async function confirmAndDeletePrayer(id) {
  const prayer = await getPrayer(id);
  if (!prayer) return;
  if (!confirm(`Supprimer « ${prayer.title || 'cette prière'} » ?`)) return;

  const driveFileId = prayer.driveFileId || '';
  await deletePrayer(id);
  if (driveFileId && localStorage.getItem('mpq_drive_sync_enabled') === '1') {
    import('./drive-sync.js')
      .then((m) => m.deleteDriveFile(driveFileId))
      .catch(() => {});
  }

  const allNovenas = await getAllNovenas();
  for (const n of allNovenas) {
    if (n.prayerId === id) {
      n.prayerId = '';
      n.updatedAt = Date.now();
      await saveNovena(n);
    }
  }
  await reloadData({ sync: true });
  if (state.currentPrayerId === id) {
    state.currentPrayerId = null;
    showView('list');
  }
  showToast('Prière supprimée');
}

function insertHeadingPrefix(prefix) {
  const ta = $('edit-prayer-content');
  const start = ta.selectionStart ?? ta.value.length;
  const lineStart = ta.value.lastIndexOf('\n', start - 1) + 1;
  const before = ta.value.slice(0, lineStart);
  const after = ta.value.slice(lineStart);
  const cleanAfter = after.replace(/^#{1,3}\s+/, '');
  ta.value = `${before}${prefix}${cleanAfter}`;
  const cursor = lineStart + prefix.length;
  ta.focus();
  ta.setSelectionRange(cursor, cursor);
  scheduleAutoSaveEdit();
}

let autoSaveEditTimer = null;
function scheduleAutoSaveEdit() {
  if (!state.editingPrayer) return;
  clearTimeout(autoSaveEditTimer);
  autoSaveEditTimer = setTimeout(() => {
    saveEditedPrayer({ exitEdit: false, silent: true });
  }, 500);
}

/* =========================================================
   IMPORT PDF & PHOTO / SCAN
   ========================================================= */
function openPdfImportSheet() {
  $('pdf-file-input').value = '';
  $('pdf-title-input').value = '';
  $('pdf-folder-select').value = '';
  $('pdf-file-meta').textContent = 'Conservé hors connexion sur cet appareil (et synchronisable sur votre Google Drive personnel jusqu’à 5 Go).';
  openSheet('sheet-pdf');
}

async function maybeUploadMediaToDrive(prayerId) {
  if (!navigator.onLine || localStorage.getItem('mpq_drive_sync_enabled') !== '1') return;
  try {
    const fresh = await getPrayer(prayerId);
    if (!fresh || fresh.driveFileId) return;
    const mod = await import('./drive-sync.js');
    if (mod.hasActiveDriveToken()) {
      await mod.uploadPrayerMediaToDrive(fresh);
      scheduleServerSync();
    }
  } catch {
    // Le fichier reste intact en local sur l'appareil
  }
}

async function handleSavePdf() {
  const file = $('pdf-file-input').files?.[0];
  if (!file) {
    showToast('Veuillez choisir un fichier PDF.');
    return;
  }
  const title = $('pdf-title-input').value.trim() || file.name.replace(/\.pdf$/i, '') || 'Prière PDF';
  const folder = $('pdf-folder-select').value || '';
  const now = Date.now();
  const prayer = {
    id: generateId('pdf'),
    type: 'pdf',
    title,
    folder,
    pinned: false,
    pdfBlob: file,
    mimeType: 'application/pdf',
    pdfSynced: false,
    fileName: file.name,
    fileSize: file.size,
    createdAt: now,
    updatedAt: now
  };
  await requestPersistentStorage();
  await savePrayer(prayer);
  await reloadData({ sync: true });
  maybeUploadMediaToDrive(prayer.id);
  closeAllSheets();
  showToast('PDF ajouté au carnet (prêt hors-ligne)');
  await openPrayer(prayer.id, 'list', false);
}

function openPhotoImportSheet() {
  state.pendingPhotoBlob = null;
  $('photo-file-input').value = '';
  $('photo-title-input').value = '';
  $('photo-folder-select').value = '';
  $('photo-preview-wrap').classList.add('hidden');
  $('photo-preview-img').src = '';
  $('photo-file-meta').textContent = 'La photo est compressée proprement et conservée hors connexion sur votre appareil.';
  openSheet('sheet-photo');
}

function compressImageFile(file, maxDim = 1600, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const ratio = Math.min(maxDim / width, maxDim / height);
        width = Math.max(1, Math.round(width * ratio));
        height = Math.max(1, Math.round(height * ratio));
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Compression impossible'));
        },
        'image/jpeg',
        quality
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Image illisible'));
    };
    img.src = url;
  });
}

async function handlePhotoSelected(file) {
  if (!file) return;
  try {
    const compressed = await compressImageFile(file);
    state.pendingPhotoBlob = compressed;
    const previewUrl = URL.createObjectURL(compressed);
    $('photo-preview-img').src = previewUrl;
    $('photo-preview-wrap').classList.remove('hidden');
    if (!$('photo-title-input').value.trim()) {
      $('photo-title-input').value = file.name.replace(/\.[^.]+$/, '') || 'Prière en photo';
    }
    $('photo-file-meta').textContent = `Prête (${formatBytes(compressed.size)})`;
  } catch {
    state.pendingPhotoBlob = file;
    $('photo-file-meta').textContent = `${file.name} (${formatBytes(file.size)})`;
  }
}

async function handleSavePhoto() {
  const blob = state.pendingPhotoBlob || $('photo-file-input').files?.[0];
  if (!blob) {
    showToast('Veuillez prendre ou choisir une photo.');
    return;
  }
  const title = $('photo-title-input').value.trim() || 'Prière en photo';
  const folder = $('photo-folder-select').value || '';
  const now = Date.now();
  const prayer = {
    id: generateId('photo'),
    type: 'image',
    title,
    folder,
    pinned: false,
    mediaBlob: blob,
    mimeType: blob.type || 'image/jpeg',
    pdfSynced: false,
    fileName: `${title.toLowerCase().replace(/[^a-z0-9]+/gi, '-') || 'priere'}.jpg`,
    fileSize: blob.size,
    createdAt: now,
    updatedAt: now
  };
  await requestPersistentStorage();
  await savePrayer(prayer);
  await reloadData({ sync: true });
  maybeUploadMediaToDrive(prayer.id);
  closeAllSheets();
  showToast('Photo ajoutée au carnet');
  await openPrayer(prayer.id, 'list', false);
}

/* =========================================================
   MODULE NEUVAINE & NOTIFICATIONS PUSH iPHONE
   ========================================================= */
function openNovenaSheet({ existingNovena = null, prefillPrayerId = '' } = {}) {
  const select = $('novena-prayer-select');
  const defOpt = document.createElement('option');
  defOpt.value = '';
  defOpt.textContent = '— Aucune prière liée —';
  select.replaceChildren(defOpt);
  for (const p of state.prayers) {
    const opt = document.createElement('option');
    opt.value = p.id;
    const suffix = p.type === 'pdf' ? ' (PDF)' : p.type === 'image' ? ' (Photo)' : '';
    opt.textContent = `${p.title || 'Sans titre'}${suffix}`;
    select.appendChild(opt);
  }

  if (existingNovena) {
    $('sheet-novena-title').textContent = 'Modifier la neuvaine';
    $('novena-edit-id').value = existingNovena.id;
    $('novena-title-input').value = existingNovena.title || '';
    select.value = existingNovena.prayerId || '';
    $('novena-intention-input').value = existingNovena.intention || '';
    $('novena-days-input').value = String(existingNovena.totalDays || 9);
    $('novena-start-input').value = existingNovena.startDate || todayIso();
    $('novena-reminder-enabled').checked = Boolean(existingNovena.reminder?.enabled);
    $('novena-reminder-time').value = existingNovena.reminder?.time || '08:00';
    $('novena-reminder-channel').value = existingNovena.reminder?.channel || 'iphone';
    $('novena-reminder-phone').value = existingNovena.reminder?.phone || '';
    $('novena-reminder-email').value = existingNovena.reminder?.email || '';
  } else {
    $('sheet-novena-title').textContent = 'Nouvelle neuvaine';
    $('novena-edit-id').value = '';
    const linked = state.prayers.find((p) => p.id === prefillPrayerId);
    $('novena-title-input').value = linked ? `Neuvaine — ${linked.title}` : '';
    select.value = prefillPrayerId || (state.prayers[0]?.id || '');
    $('novena-intention-input').value = '';
    $('novena-days-input').value = '9';
    $('novena-start-input').value = todayIso();
    $('novena-reminder-enabled').checked = true;
    $('novena-reminder-time').value = '08:00';
    $('novena-reminder-channel').value = 'iphone';
    $('novena-reminder-phone').value = '';
    $('novena-reminder-email').value = '';
  }

  syncNovenaSheetFields();
  openSheet('sheet-novena');
}

function syncNovenaSheetFields() {
  const daysVal = Number($('novena-days-input').value);
  document.querySelectorAll('.preset-chip').forEach((btn) => {
    btn.classList.toggle('active', Number(btn.dataset.days) === daysVal);
  });

  const enabled = $('novena-reminder-enabled').checked;
  $('novena-reminder-fields').classList.toggle('hidden', !enabled);

  const channel = $('novena-reminder-channel').value;
  $('novena-phone-wrap').classList.toggle('hidden', channel !== 'sms');
  $('novena-email-wrap').classList.toggle('hidden', channel !== 'email');
}

async function handleSaveNovena() {
  const editId = $('novena-edit-id').value;
  const existing = editId ? await getNovena(editId) : null;
  const title = $('novena-title-input').value.trim() || 'Ma neuvaine';
  const totalDays = Math.max(1, Math.min(365, Number($('novena-days-input').value) || 9));
  const now = Date.now();

  const novena = {
    id: existing ? existing.id : generateId('novena'),
    title,
    prayerId: $('novena-prayer-select').value,
    intention: $('novena-intention-input').value.trim(),
    totalDays,
    startDate: $('novena-start-input').value || todayIso(),
    completedDays: (existing?.completedDays || []).filter((d) => d >= 1 && d <= totalDays),
    reminder: {
      enabled: $('novena-reminder-enabled').checked,
      time: $('novena-reminder-time').value || '08:00',
      channel: $('novena-reminder-channel').value || 'iphone',
      phone: $('novena-reminder-phone').value.trim(),
      email: $('novena-reminder-email').value.trim()
    },
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now
  };

  await saveNovena(novena);
  await reloadData({ sync: true });
  closeAllSheets();
  state.activeTab = 'novenas';
  await openNovena(novena.id);
  showToast(existing ? 'Neuvaine mise à jour' : 'Neuvaine créée');
}

async function openNovena(id) {
  const novena = await getNovena(id);
  if (!novena) {
    showToast('Neuvaine introuvable.');
    return;
  }
  state.currentNovenaId = id;
  showView('novena');
  await renderCurrentNovena();
}

async function refreshPushUi() {
  const pushMod = await loadPush();
  const supported = pushMod.isPushSupported();
  let sub = null;
  if (supported) {
    try {
      sub = await pushMod.getPushSubscription();
    } catch {
      sub = null;
    }
  }
  const active = Boolean(sub);

  const novToggle = $('btn-novena-push-toggle');
  const novLabel = $('novena-push-toggle-label');
  const novTest = $('btn-novena-push-test');
  if (novToggle && novLabel && novTest) {
    novToggle.classList.toggle('is-subscribed', active);
    novLabel.textContent = !supported
      ? 'Push disponible après installation sur l’écran d’accueil'
      : active
        ? 'Notifications Push activées ✓ (désactiver)'
        : 'Activer les notifications Push';
    novTest.classList.toggle('hidden', !active);
  }

  const infoToggle = $('btn-info-push-toggle');
  const infoTest = $('btn-info-push-test');
  const infoStatus = $('info-push-status');
  if (infoToggle && infoTest && infoStatus) {
    infoToggle.classList.toggle('is-subscribed', active);
    infoToggle.textContent = !supported
      ? 'Push disponible sur l’application installée'
      : active
        ? 'Désactiver les notifications Push'
        : 'Activer les notifications Push';
    infoTest.classList.toggle('hidden', !active);
    infoStatus.textContent = !supported
      ? 'Installez l’application sur l’écran d’accueil de votre appareil pour activer les notifications Push.'
      : active
        ? 'Cet appareil est abonné : vos rappels de neuvaine arriveront automatiquement.'
        : 'Activez les notifications Push pour recevoir vos rappels de neuvaine même application fermée.';
  }
}

async function handlePushToggle() {
  const pushMod = await loadPush();
  if (!pushMod.isPushSupported()) {
    showToast('Installez d’abord l’application sur votre écran d’accueil pour activer les notifications Push.');
    return;
  }
  try {
    const existing = await pushMod.getPushSubscription();
    if (existing) {
      await pushMod.unsubscribeFromPush();
      showToast('Notifications Push désactivées');
    } else {
      await pushMod.subscribeToPush();
      await syncWithServer({ onStatus: setSyncStatus });
      showToast('Notifications Push activées ✓');
    }
  } catch (err) {
    if (err?.message === 'AUTH_REQUIRED') {
      showToast('Connectez-vous pour activer les notifications Push de votre compte.');
      openAccountModal();
    } else if (err?.message === 'API_NOT_CONFIGURED') {
      showToast('Serveur momentanément indisponible.');
    } else if (err?.message === 'PERMISSION_DENIED') {
      showToast('Autorisation refusée dans les réglages de votre appareil.');
    } else {
      showToast('Activation Push impossible (vérifiez la connexion).');
    }
  }
  await refreshPushUi();
}

async function handlePushTest() {
  try {
    const pushMod = await loadPush();
    const res = await pushMod.sendTestPush();
    showToast(res.sent > 0 ? 'Notification de test envoyée sur votre appareil !' : 'Aucun appareil abonné.');
  } catch (err) {
    if (err?.message === 'AUTH_REQUIRED') {
      showToast('Connectez-vous d’abord à votre compte.');
    } else {
      showToast("Échec de l'envoi test.");
    }
  }
}

async function renderCurrentNovena() {
  const n = await getNovena(state.currentNovenaId);
  if (!n) return;

  const linkedPrayer = n.prayerId ? await getPrayer(n.prayerId) : null;
  const doneSet = new Set(n.completedDays || []);
  const total = n.totalDays || 9;
  const doneCount = doneSet.size;
  const curDay = computeCurrentDay(n);

  $('novena-detail-title').textContent = n.title || 'Neuvaine';
  $('novena-detail-intention').textContent = n.intention || 'Aucune intention particulière renseignée.';
  $('novena-detail-dates').textContent = `Début : ${new Date(`${n.startDate}T00:00:00`).toLocaleDateString('fr-FR')} • ${total} jours`;
  $('novena-detail-counter').textContent = `${doneCount} / ${total} jours`;
  $('novena-detail-progress-fill').style.width = `${Math.min(100, Math.round((doneCount / total) * 100))}%`;

  const linkedBtn = $('btn-novena-open-prayer');
  if (linkedPrayer) {
    linkedBtn.disabled = false;
    $('novena-linked-prayer-title').textContent = linkedPrayer.title || 'Prière';
    linkedBtn.onclick = () => openPrayer(linkedPrayer.id, 'novena', false);
  } else {
    linkedBtn.disabled = true;
    $('novena-linked-prayer-title').textContent = 'Aucune prière associée (touchez Modifier)';
    linkedBtn.onclick = null;
  }

  const grid = $('novena-days-grid');
  grid.innerHTML = '';
  for (let d = 1; d <= total; d += 1) {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'day-cell';
    if (d === curDay) cell.classList.add('is-today');
    if (doneSet.has(d)) cell.classList.add('is-checked');

    const top = document.createElement('span');
    top.textContent = `J${d}`;
    const sub = document.createElement('span');
    sub.className = 'day-cell-sub';
    sub.textContent = doneSet.has(d) ? 'Fait ✓' : (d === curDay ? 'Auj.' : 'À faire');

    cell.appendChild(top);
    cell.appendChild(sub);
    cell.addEventListener('click', async () => {
      await toggleNovenaDay(n.id, d);
      await renderCurrentNovena();
    });
    grid.appendChild(cell);
  }

  const rem = n.reminder || {};
  const pill = $('novena-reminder-status-pill');
  pill.textContent = rem.enabled ? `Actif • ${rem.time || '08:00'}` : 'Désactivé';
  pill.classList.toggle('active', Boolean(rem.enabled));

  if (rem.enabled) {
    const targetDetail = rem.channel === 'sms' && rem.phone
      ? ` vers ${rem.phone}`
      : rem.channel === 'email' && rem.email
        ? ` vers ${rem.email}`
        : '';
    $('novena-reminder-summary').textContent = `Rappel prévu chaque jour à ${rem.time || '08:00'} pendant ${total} jours via ${channelLabel(rem.channel)}${targetDetail}.`;
  } else {
    $('novena-reminder-summary').textContent = 'Aucun rappel programmé pour cette neuvaine.';
  }

  $('btn-novena-configure-reminder').onclick = () => openNovenaSheet({ existingNovena: n });
  $('btn-novena-download-ics').onclick = async () => {
    const icsMod = await loadIcs();
    icsMod.downloadNovenaIcs(n, linkedPrayer?.title || '', window.location.href.split('#')[0]);
    showToast('Calendrier (.ics) généré');
  };
  $('btn-novena-send-sms').onclick = async () => {
    const icsMod = await loadIcs();
    window.location.href = icsMod.buildSmsLink(rem.phone, n, linkedPrayer?.title || '', curDay);
  };
  $('btn-novena-send-email').onclick = async () => {
    const icsMod = await loadIcs();
    window.location.href = icsMod.buildMailtoLink(rem.email, n, linkedPrayer?.title || '', curDay);
  };

  await refreshPushUi();
}

async function toggleNovenaDay(novenaId, dayNumber) {
  const n = await getNovena(novenaId);
  if (!n) return;
  const set = new Set(n.completedDays || []);
  if (set.has(dayNumber)) {
    set.delete(dayNumber);
  } else {
    set.add(dayNumber);
  }
  n.completedDays = Array.from(set).sort((a, b) => a - b);
  n.updatedAt = Date.now();
  await saveNovena(n);
  await reloadData({ sync: true });
}

async function confirmAndDeleteNovena(id) {
  const n = await getNovena(id);
  if (!n) return;
  if (!confirm(`Supprimer le module neuvaine « ${n.title} » ?`)) return;
  await deleteNovena(id);
  await reloadData({ sync: true });
  if (state.currentNovenaId === id) {
    state.currentNovenaId = null;
    showView('list');
  }
  showToast('Neuvaine supprimée');
}

/* =========================================================
   VUE « MES INTENTIONS » & TIROIR RAPIDE EN LECTURE
   ========================================================= */
function openIntentionsView() {
  showView('intentions');
  renderIntentionsView();
}

function buildIntentionRowElement(item) {
  const row = document.createElement('div');
  row.className = 'intention-item';

  const checkBtn = document.createElement('button');
  checkBtn.type = 'button';
  checkBtn.className = `intention-check-btn${item.done ? ' is-done' : ''}`;
  checkBtn.setAttribute('aria-label', item.done ? 'Marquer comme en cours' : 'Marquer comme exaucée / confiée');
  checkBtn.textContent = item.done ? '✓' : '';
  checkBtn.addEventListener('click', async () => {
    const fresh = await getIntention(item.id);
    if (!fresh) return;
    fresh.done = !fresh.done;
    fresh.updatedAt = Date.now();
    await saveIntention(fresh);
    await reloadData({ sync: true });
  });

  const contentCol = document.createElement('div');
  contentCol.className = 'intention-content-col';

  const textP = document.createElement('p');
  textP.className = `intention-text${item.done ? ' is-done' : ''}`;
  textP.textContent = item.text;
  contentCol.appendChild(textP);

  const meta = document.createElement('div');
  meta.className = 'intention-meta';
  meta.textContent = `${item.done ? 'Exaucée / confiée • ' : ''}${formatShortDate(item.updatedAt || item.createdAt)}`;
  contentCol.appendChild(meta);

  const actions = document.createElement('div');
  actions.className = 'intention-actions';

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'intention-mini-btn';
  editBtn.setAttribute('aria-label', "Modifier l'intention");
  editBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>`;
  editBtn.addEventListener('click', async () => {
    const updated = prompt("Modifier l'intention :", item.text);
    if (updated === null) return;
    const clean = updated.trim();
    if (!clean) return;
    const fresh = await getIntention(item.id);
    if (!fresh) return;
    fresh.text = clean;
    fresh.updatedAt = Date.now();
    await saveIntention(fresh);
    await reloadData({ sync: true });
    showToast('Intention mise à jour');
  });

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'intention-mini-btn danger';
  delBtn.setAttribute('aria-label', "Supprimer l'intention");
  delBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path></svg>`;
  delBtn.addEventListener('click', async () => {
    if (!confirm('Supprimer cette intention ?')) return;
    await deleteIntention(item.id);
    await reloadData({ sync: true });
    showToast('Intention supprimée');
  });

  actions.appendChild(editBtn);
  actions.appendChild(delBtn);

  row.appendChild(checkBtn);
  row.appendChild(contentCol);
  row.appendChild(actions);
  return row;
}

function renderIntentionsView() {
  const listEl = $('intentions-list');
  listEl.innerHTML = '';
  $('intentions-empty').classList.toggle('hidden', state.intentions.length > 0);
  for (const item of state.intentions) {
    listEl.appendChild(buildIntentionRowElement(item));
  }

  const novenaWithIntentions = state.novenas.filter((n) => (n.intention || '').trim() !== '');
  const sec = $('novena-intentions-section');
  const novList = $('novena-intentions-list');
  novList.innerHTML = '';
  sec.classList.toggle('hidden', novenaWithIntentions.length === 0);

  for (const n of novenaWithIntentions) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'novena-intention-link';
    const left = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = n.title;
    const span = document.createElement('span');
    span.textContent = n.intention;
    left.appendChild(strong);
    left.appendChild(span);
    const arrow = document.createElement('span');
    arrow.className = 'chevron';
    arrow.textContent = '›';
    btn.appendChild(left);
    btn.appendChild(arrow);
    btn.addEventListener('click', () => openNovena(n.id));
    novList.appendChild(btn);
  }
}

function openQuickIntentionsSheet() {
  renderQuickIntentionsSheet();
  openSheet('sheet-quick-intentions');
}

function renderQuickIntentionsSheet() {
  const listEl = $('quick-intentions-list');
  listEl.replaceChildren();
  if (state.intentions.length === 0) {
    const p = document.createElement('p');
    p.className = 'field-help';
    p.textContent = 'Aucune intention personnelle enregistrée.';
    listEl.appendChild(p);
    return;
  }
  for (const item of state.intentions) {
    listEl.appendChild(buildIntentionRowElement(item));
  }
}

async function addIntentionText(text) {
  const clean = text.trim();
  if (!clean) return false;
  const now = Date.now();
  await saveIntention({
    id: generateId('intent'),
    text: clean,
    done: false,
    createdAt: now,
    updatedAt: now
  });
  await reloadData({ sync: true });
  showToast('Intention enregistrée');
  return true;
}

function buildIntentionsTxt() {
  const lines = ['MES INTENTIONS — Ma prière quotidienne', '========================================', ''];
  if (state.intentions.length === 0) {
    lines.push('(Aucune intention personnelle)');
  } else {
    for (const item of state.intentions) {
      const mark = item.done ? '[x]' : '[ ]';
      const dateStr = formatShortDate(item.updatedAt || item.createdAt);
      lines.push(`${mark} ${item.text} (${dateStr})`);
    }
  }
  const novenaIntentions = state.novenas.filter((n) => (n.intention || '').trim());
  if (novenaIntentions.length > 0) {
    lines.push('', 'INTENTIONS DES NEUVAINES', '------------------------');
    for (const n of novenaIntentions) {
      lines.push(`• ${n.title} : ${n.intention}`);
    }
  }
  return lines.join('\n');
}

async function exportIntentionsFile() {
  const text = buildIntentionsTxt();
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const file = new File([blob], 'mes-intentions.txt', { type: 'text/plain' });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ title: 'Mes intentions', files: [file] });
      return;
    } catch {
      // Fallback
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'mes-intentions.txt';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  showToast('Fichier mes-intentions.txt exporté');
}

/* =========================================================
   VUE « MYSTÈRES DU CHAPELET » & CHAPELET INTERACTIF
   ========================================================= */
function saveRosaryCounter() {
  const now = Date.now();
  const stamped = { ...state.rosaryCounter, updatedAt: now };
  localStorage.setItem(ROSARY_COUNTER_KEY, JSON.stringify(stamped));
  localStorage.setItem(ROSARY_UPDATED_KEY, String(now));
  scheduleServerSync();
}

async function renderRosaryInteractive() {
  const { ROSARY_GROUPS, getTodayRosaryGroup } = await loadRosary();
  const rc = state.rosaryCounter;
  const group = ROSARY_GROUPS.find((g) => g.key === rc.groupKey) || getTodayRosaryGroup();
  const mystery = group.mysteries[rc.decadeIndex] || group.mysteries[0];

  $('rosary-decade-badge').textContent = `Dizaine ${rc.decadeIndex + 1} / 5`;
  $('rosary-counter-mystery').textContent = `${mystery.number}) ${mystery.title}`;
  $('rosary-counter-fruit').textContent = `Fruit : ${mystery.fruit} (${group.title})`;

  const row = $('rosary-beads-row');
  row.replaceChildren();
  for (let i = 0; i <= 10; i += 1) {
    const bead = document.createElement('button');
    bead.type = 'button';
    bead.className = 'rosary-bead';
    if (i === 0) bead.classList.add('is-our-father');
    if (i <= rc.beadIndex) bead.classList.add('is-done');
    if (i === rc.beadIndex) bead.classList.add('is-current');
    bead.setAttribute('aria-label', i === 0 ? 'Notre Père' : `Je vous salue Marie ${i} sur 10`);
    bead.addEventListener('click', () => {
      rc.beadIndex = i;
      saveRosaryCounter();
      renderRosaryInteractive();
    });
    row.appendChild(bead);
  }

  $('rosary-bead-status').textContent = rc.beadIndex === 0
    ? 'Notre Père (début de la dizaine)'
    : `Je vous salue Marie : ${rc.beadIndex} / 10`;
}

function stepRosaryBead(delta) {
  const rc = state.rosaryCounter;
  if (delta > 0) {
    if (rc.beadIndex < 10) {
      rc.beadIndex += 1;
    } else if (rc.decadeIndex < 4) {
      rc.decadeIndex += 1;
      rc.beadIndex = 0;
      showToast(`Dizaine ${rc.decadeIndex + 1} / 5`);
    } else {
      rc.decadeIndex = 0;
      rc.beadIndex = 0;
      showToast('Chapelet terminé ! Gloire à Dieu.');
    }
  } else {
    if (rc.beadIndex > 0) {
      rc.beadIndex -= 1;
    } else if (rc.decadeIndex > 0) {
      rc.decadeIndex -= 1;
      rc.beadIndex = 10;
    }
  }
  navigator.vibrate?.(10);
  saveRosaryCounter();
  renderRosaryInteractive();
}

async function openRosaryView(filterKey = 'all') {
  state.rosaryFilter = filterKey;
  if (filterKey !== 'all') {
    state.rosaryCounter.groupKey = filterKey;
    saveRosaryCounter();
  }
  showView('rosary');
  await renderRosaryView();
}

async function renderRosaryView() {
  const { ROSARY_GROUPS, ROSARY_PRAYERS, getTodayRosaryGroup } = await loadRosary();
  const todayGroup = getTodayRosaryGroup();
  $('rosary-today-banner').textContent = `Aujourd'hui (${todayGroup.daysLabel}) : ${todayGroup.title}`;

  document.querySelectorAll('.rosary-pill').forEach((btn) => {
    const k = btn.dataset.rosaryFilter;
    btn.classList.toggle('active', k === state.rosaryFilter);
    btn.classList.toggle('is-today-pill', k === todayGroup.key);
  });

  await renderRosaryInteractive();

  const groupsToShow = state.rosaryFilter === 'all'
    ? ROSARY_GROUPS
    : ROSARY_GROUPS.filter((g) => g.key === state.rosaryFilter);

  const container = $('rosary-groups-container');
  container.replaceChildren();

  for (const group of groupsToShow) {
    const card = document.createElement('article');
    card.className = 'prayer-sheet rosary-group-card';

    const head = document.createElement('div');
    head.className = 'rosary-group-head';

    const title = document.createElement('h2');
    title.className = 'prayer-h1 rosary-group-title';
    const titleSpan = document.createElement('span');
    titleSpan.textContent = `${group.roman} ${group.title}`;
    title.appendChild(titleSpan);
    head.appendChild(title);

    const badges = document.createElement('div');
    badges.className = 'rosary-group-badges';

    const daysBadge = document.createElement('span');
    daysBadge.className = 'rosary-days-badge';
    daysBadge.textContent = group.daysLabel;
    badges.appendChild(daysBadge);

    if (group.key === todayGroup.key) {
      const todayBadge = document.createElement('span');
      todayBadge.className = 'badge-novena';
      todayBadge.textContent = "Aujourd'hui";
      badges.appendChild(todayBadge);
    }

    head.appendChild(badges);
    card.appendChild(head);

    for (const m of group.mysteries) {
      const item = document.createElement('div');
      item.className = 'rosary-mystery-item';

      const mHead = document.createElement('div');
      mHead.className = 'rosary-mystery-head';

      const mTitle = document.createElement('h3');
      mTitle.className = 'prayer-h2 rosary-mystery-title';
      const mSpan = document.createElement('span');
      mSpan.textContent = `${m.number}) ${m.title}`;
      mTitle.appendChild(mSpan);
      mHead.appendChild(mTitle);

      const refPill = document.createElement('span');
      refPill.className = 'rosary-ref-pill';
      refPill.textContent = m.ref;
      mHead.appendChild(refPill);

      item.appendChild(mHead);

      const fruitP = document.createElement('p');
      fruitP.className = 'rosary-fruit';
      fruitP.textContent = `Fruit du mystère : ${m.fruit}`;
      item.appendChild(fruitP);

      const medP = document.createElement('p');
      medP.className = 'prayer-body rosary-meditation';
      medP.textContent = m.meditation;
      item.appendChild(medP);

      card.appendChild(item);
    }

    container.appendChild(card);
  }

  // Prières du chapelet dans l'accordéon (rendu DOM pur, zéro innerHTML)
  const prayersBody = $('rosary-prayers-body');
  if (prayersBody && prayersBody.childElementCount === 0) {
    for (const pr of ROSARY_PRAYERS) {
      const block = document.createElement('div');
      block.className = 'rosary-prayer-block';
      const h4 = document.createElement('h4');
      h4.textContent = pr.title;
      const p = document.createElement('p');
      const lines = String(pr.text || '').split('\n');
      lines.forEach((line, idx) => {
        if (idx > 0) p.appendChild(document.createElement('br'));
        p.appendChild(document.createTextNode(line));
      });
      block.appendChild(h4);
      block.appendChild(p);
      prayersBody.appendChild(block);
    }
  }
}

/* =========================================================
   SAUVEGARDE / RESTAURATION JSON
   ========================================================= */
async function handleExportBackup() {
  try {
    const data = await exportBackupData();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const fileName = `ma-priere-sauvegarde-${todayIso()}.json`;
    const file = new File([blob], fileName, { type: 'application/json' });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ title: 'Sauvegarde Ma prière quotidienne', files: [file] });
        return;
      } catch {
        // Fallback
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    await refreshBackupWitness();
    showToast('Sauvegarde exportée ✓');
  } catch {
    showToast("Erreur lors de l'export.");
  }
}

async function handleImportBackup(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    await importBackupData(data);
    await reloadData({ sync: true });
    closeAllSheets();
    showToast('Sauvegarde importée ✓');
  } catch {
    showToast('Fichier de sauvegarde invalide.');
  }
}

/* =========================================================
   SAUVEGARDE AUTOMATIQUE À LA FERMETURE / ARRIÈRE-PLAN
   ========================================================= */
async function flushAndSyncOnLeave() {
  clearTimeout(autoSaveEditTimer);
  clearTimeout(syncDebounceTimer);
  if (state.editingPrayer && state.currentPrayerId) {
    try {
      await saveEditedPrayer({ exitEdit: false, silent: true });
    } catch {
      // Ignoré
    }
  }
  syncWithServer({ keepalive: true, onStatus: setSyncStatus });
}

/* =========================================================
   INITIALISATION & ÉVÉNEMENTS
   ========================================================= */
function bindEvents() {
  window.addEventListener('online', async () => {
    flushFeedbackQueue().catch(() => {});
    if (!isSignedIn()) {
      setSyncStatus('local');
      return;
    }
    setSyncStatus('syncing');
    const res = await syncWithServer({ onStatus: setSyncStatus });
    if (res?.ok && !res.skipped) await refreshFromDbOnly();
  });
  window.addEventListener('offline', () => setSyncStatus('offline'));

  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (state.themeMode === 'auto') applyTheme();
    });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushAndSyncOnLeave();
    } else if (document.visibilityState === 'visible' && navigator.onLine) {
      applyLiturgicalSeason();
      flushFeedbackQueue().catch(() => {});
      if (isSignedIn()) {
        syncWithServer({ pullOnly: true, onStatus: setSyncStatus }).then((r) => {
          if (r?.ok && !r.skipped) refreshFromDbOnly();
        });
      }
    }
  });
  window.addEventListener('pagehide', () => flushAndSyncOnLeave());
  window.addEventListener('beforeunload', () => flushAndSyncOnLeave());

  $('sync-status-btn').addEventListener('click', openAccountModal);

  $('btn-open-feedback')?.addEventListener('click', openFeedbackModal);
  $('btn-share-app')?.addEventListener('click', shareApplication);
  $('btn-info-share-app')?.addEventListener('click', shareApplication);
  $('btn-trigger-offline-precache')?.addEventListener('click', () => {
    triggerOfflineCorpusPrecache({ notify: true });
  });

  $('btn-header-search')?.addEventListener('click', () => {
    switchMainTab('carnet', { focusSearch: true });
  });
  $('btn-home-open-carnet')?.addEventListener('click', () => {
    switchMainTab('carnet');
  });

  $('btn-toggle-theme').addEventListener('click', cycleTheme);
  $('btn-open-info').addEventListener('click', async () => {
    await Promise.all([refreshPushUi(), refreshBackupWitness()]);
    openSheet('sheet-info');
  });
  $('modal-backdrop').addEventListener('click', closeAllSheets);
  document.querySelectorAll('[data-close-sheet]').forEach((btn) => btn.addEventListener('click', closeAllSheets));

  // Recherche instantanée dans le Carnet
  const searchEl = $('search-input');
  searchEl.addEventListener('input', () => {
    state.searchQuery = searchEl.value;
    $('btn-clear-search').classList.toggle('hidden', !searchEl.value);
    renderList();
  });
  $('btn-clear-search').addEventListener('click', () => {
    searchEl.value = '';
    state.searchQuery = '';
    $('btn-clear-search').classList.add('hidden');
    renderList();
    searchEl.focus();
  });

  // Barre de navigation fixe en bas (Accueil / Carnet / Chapelet / Neuvaines)
  document.querySelectorAll('#bottom-tab-bar .bottom-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetTab = btn.dataset.navTab || 'home';
      switchMainTab(targetTab);
    });
  });

  // Filtres Prières
  document.querySelectorAll('#panel-prayers .pill-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.filterType = btn.dataset.filter;
      syncFilterPillsActive();
      renderPrayersList();
    });
  });

  // Mes intentions
  $('btn-open-intentions').addEventListener('click', openIntentionsView);
  $('btn-intentions-back').addEventListener('click', () => {
    showView('list');
    renderList();
  });
  $('intention-add-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('intention-quick-input');
    if (await addIntentionText(input.value)) {
      input.value = '';
    } else {
      showToast("Écrivez votre intention avant de l'ajouter.");
    }
  });
  $('btn-intentions-export').addEventListener('click', exportIntentionsFile);

  // Tiroir intentions rapides en lecture
  $('btn-prayer-quick-intentions').addEventListener('click', openQuickIntentionsSheet);
  $('quick-intention-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('quick-intention-input');
    if (await addIntentionText(input.value)) {
      input.value = '';
    }
  });

  // Mystères du chapelet & Chapelet interactif
  $('btn-open-la-priere').addEventListener('click', openLaPriereView);
  $('btn-rosary-back').addEventListener('click', () => {
    switchMainTab('home');
  });
  $('btn-rosary-wake-lock').addEventListener('click', toggleWakeLock);
  $('btn-rosary-today').addEventListener('click', () => {
    const today = getTodayRosarySummary();
    state.rosaryFilter = today.key;
    state.rosaryCounter = { groupKey: today.key, decadeIndex: 0, beadIndex: 0 };
    saveRosaryCounter();
    renderRosaryView();
    showToast(`${today.title} (${today.daysLabel})`);
  });
  document.querySelectorAll('.rosary-pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.rosaryFilter;
      state.rosaryFilter = k;
      if (k !== 'all') {
        state.rosaryCounter = { groupKey: k, decadeIndex: 0, beadIndex: 0 };
        saveRosaryCounter();
      }
      renderRosaryView();
    });
  });
  $('btn-rosary-next-bead').addEventListener('click', () => stepRosaryBead(1));
  $('btn-rosary-prev-bead').addEventListener('click', () => stepRosaryBead(-1));
  $('btn-rosary-reset-bead').addEventListener('click', () => {
    state.rosaryCounter.decadeIndex = 0;
    state.rosaryCounter.beadIndex = 0;
    saveRosaryCounter();
    renderRosaryInteractive();
    showToast('Chapelet remis à zéro');
  });

  // Action Sheet ajout
  $('btn-add-menu').addEventListener('click', () => openSheet('sheet-add'));
  $('act-cancel-add').addEventListener('click', closeAllSheets);
  $('act-new-text-prayer').addEventListener('click', () => {
    closeAllSheets();
    createNewTextPrayer();
  });
  $('act-new-pdf-prayer').addEventListener('click', openPdfImportSheet);
  $('act-new-photo-prayer').addEventListener('click', openPhotoImportSheet);
  $('act-new-novena').addEventListener('click', () => openNovenaSheet());
  $('act-new-intention').addEventListener('click', () => {
    closeAllSheets();
    openIntentionsView();
    $('intention-quick-input').focus();
  });
  $('btn-empty-new-novena').addEventListener('click', () => openNovenaSheet());

  // Import PDF
  $('pdf-file-input').addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!$('pdf-title-input').value.trim()) {
        $('pdf-title-input').value = file.name.replace(/\.pdf$/i, '');
      }
      $('pdf-file-meta').textContent = `${file.name} (${formatBytes(file.size)})`;
    }
  });
  $('btn-save-pdf').addEventListener('click', handleSavePdf);

  // Import Photo / Scan
  $('photo-file-input').addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) handlePhotoSelected(file);
  });
  $('btn-save-photo').addEventListener('click', handleSavePhoto);

  // Navigation Vue Prière
  $('btn-prayer-back').addEventListener('click', async () => {
    if (state.editingPrayer) {
      await saveEditedPrayer({ exitEdit: false, silent: true });
      state.editingPrayer = false;
    }
    if (state.returnView === 'novena' && state.currentNovenaId) {
      showView('novena');
      await renderCurrentNovena();
    } else {
      showView('list');
      renderList();
    }
  });

  $('btn-prayer-pin').addEventListener('click', async () => {
    if (state.currentPrayerId) {
      await togglePrayerPinned(state.currentPrayerId);
      await renderCurrentPrayer();
    }
  });

  $('btn-prayer-focus').addEventListener('click', () => setFocusMode(!state.focusMode));
  $('btn-exit-focus').addEventListener('click', () => setFocusMode(false));
  $('prayer-rendered-body').addEventListener('click', () => {
    if (window.getSelection && window.getSelection().toString().length > 0) return;
    if (state.focusMode) setFocusMode(false);
  });

  $('btn-wake-lock').addEventListener('click', toggleWakeLock);

  $('btn-prayer-edit-toggle').addEventListener('click', async () => {
    if (state.editingPrayer) {
      await saveEditedPrayer({ exitEdit: true });
    } else {
      state.editingPrayer = true;
      await renderCurrentPrayer();
    }
  });

  $('edit-prayer-title').addEventListener('input', scheduleAutoSaveEdit);
  $('edit-prayer-folder').addEventListener('change', scheduleAutoSaveEdit);
  $('edit-prayer-content').addEventListener('input', scheduleAutoSaveEdit);

  $('btn-prayer-delete').addEventListener('click', () => {
    if (state.currentPrayerId) confirmAndDeletePrayer(state.currentPrayerId);
  });

  $('btn-prayer-to-novena').addEventListener('click', () => {
    openNovenaSheet({ prefillPrayerId: state.currentPrayerId || '' });
  });

  // Taille police lecture
  $('btn-font-smaller').addEventListener('click', () => {
    state.fontSizePx = Math.max(13, state.fontSizePx - 1);
    applyPrayerFontSize();
  });
  $('btn-font-larger').addEventListener('click', () => {
    state.fontSizePx = Math.min(20, state.fontSizePx + 1);
    applyPrayerFontSize();
  });

  // Outils mise en page rapide
  document.querySelectorAll('.fmt-btn').forEach((btn) => {
    btn.addEventListener('click', () => insertHeadingPrefix(btn.dataset.prefix));
  });

  // Zoom PDF & Photo
  $('btn-pdf-zoom-out').addEventListener('click', () => {
    state.pdfScale = Math.max(0.75, +(state.pdfScale - 0.25).toFixed(2));
    renderCurrentPrayer();
  });
  $('btn-pdf-zoom-in').addEventListener('click', () => {
    state.pdfScale = Math.min(2.5, +(state.pdfScale + 0.25).toFixed(2));
    renderCurrentPrayer();
  });
  $('btn-image-zoom-out').addEventListener('click', () => {
    state.imageScale = Math.max(0.75, +(state.imageScale - 0.25).toFixed(2));
    renderCurrentPrayer();
  });
  $('btn-image-zoom-in').addEventListener('click', () => {
    state.imageScale = Math.min(2.5, +(state.imageScale + 0.25).toFixed(2));
    renderCurrentPrayer();
  });

  // Navigation Vue Neuvaine
  $('btn-novena-back').addEventListener('click', () => {
    showView('list');
    renderList();
  });
  $('btn-novena-edit').addEventListener('click', async () => {
    const n = await getNovena(state.currentNovenaId);
    if (n) openNovenaSheet({ existingNovena: n });
  });
  $('btn-novena-delete').addEventListener('click', () => {
    if (state.currentNovenaId) confirmAndDeleteNovena(state.currentNovenaId);
  });

  // Web Push iPhone (Neuvaine + Infos)
  $('btn-novena-push-toggle').addEventListener('click', handlePushToggle);
  $('btn-novena-push-test').addEventListener('click', handlePushTest);
  $('btn-info-push-toggle').addEventListener('click', handlePushToggle);
  $('btn-info-push-test').addEventListener('click', handlePushTest);

  // Sauvegarde / Restauration JSON
  $('btn-export-backup').addEventListener('click', handleExportBackup);
  $('btn-import-backup').addEventListener('click', () => $('backup-file-input').click());
  $('backup-file-input').addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) handleImportBackup(file);
    e.target.value = '';
  });

  // Formulaire Neuvaine
  document.querySelectorAll('.preset-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      $('novena-days-input').value = btn.dataset.days;
      syncNovenaSheetFields();
    });
  });
  $('novena-days-input').addEventListener('input', syncNovenaSheetFields);
  $('novena-reminder-enabled').addEventListener('change', syncNovenaSheetFields);
  $('novena-reminder-channel').addEventListener('change', syncNovenaSheetFields);
  $('btn-save-novena').addEventListener('click', handleSaveNovena);
}

function updateOfflineCorpusUi(status) {
  const homeNote = $('home-offline-corpus-note');
  const infoText = $('info-offline-corpus-status');
  const texts = status?.textsCount || 66;
  const guides = status?.guidesCount || 10;

  if (status?.ready) {
    if (homeNote) {
      homeNote.textContent = `Mode hors connexion prêt (${texts} textes + ${guides} guides)`;
      homeNote.classList.remove('hidden');
    }
    if (infoText) {
      infoText.textContent = `Prêt pour le mode avion ✓ — L’intégralité de l’application, le lecteur PDF, les ${texts} textes (CEC & saint Thomas) et les ${guides} guides sont en cache local.`;
    }
  } else if (status && typeof status.cached === 'number') {
    if (infoText) {
      infoText.textContent = `Mise en cache hors connexion : ${status.cached} / ${status.total || 70} ressources prêtes…`;
    }
  }
}

async function triggerOfflineCorpusPrecache({ notify = false } = {}) {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const worker = reg.active || navigator.serviceWorker.controller;
    if (worker) {
      worker.postMessage({ type: 'PRECACHE_OFFLINE_CORPUS' });
      if (notify) showToast('Vérification du cache hors connexion en cours…');
    }
  } catch {
    // Ignoré
  }
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'OFFLINE_CORPUS_STATUS') {
        updateOfflineCorpusUi(event.data);
      }
    });

    const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    const worker = reg.active || navigator.serviceWorker.controller;
    if (worker) {
      worker.postMessage({ type: 'GET_OFFLINE_CORPUS_STATUS' });
    }

    // Précaching silencieux des 66 textes + 10 guides APRÈS chargement complet + temps mort (0 impact au boot)
    const scheduleBackgroundPrecache = () => {
      const start = () => {
        setTimeout(() => {
          if (navigator.onLine) {
            triggerOfflineCorpusPrecache({ notify: false });
          }
        }, 2500);
      };
      if ('requestIdleCallback' in window) {
        window.requestIdleCallback(start, { timeout: 5000 });
      } else {
        start();
      }
    };

    if (document.readyState === 'complete') {
      scheduleBackgroundPrecache();
    } else {
      window.addEventListener('load', scheduleBackgroundPrecache, { once: true });
    }
  } catch (err) {
    console.warn('Service worker registration failed:', err);
  }
}

async function boot() {
  applyTheme();
  applyLiturgicalSeason();
  applyPrayerFontSize();
  updateWakeLockButtons();
  bindEvents();
  await initDbAndSeed();
  await initAuth();

  onAuthChange(() => {
    setSyncStatus(!navigator.onLine ? 'offline' : (isSignedIn() ? 'idle' : 'local'));
  });
  setSyncStatus(!navigator.onLine ? 'offline' : (isSignedIn() ? 'idle' : 'local'));

  await refreshFromDbOnly();
  await registerServiceWorker();

  if (navigator.onLine) {
    flushFeedbackQueue().catch(() => {});
    if (isSignedIn()) {
      const res = await syncWithServer({ pullOnly: true, onStatus: setSyncStatus });
      if (res?.ok && !res.skipped) await refreshFromDbOnly();
    }
  }
}

boot();
