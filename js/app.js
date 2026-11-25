import {
  initDbAndSeed,
  getAllPrayers,
  getPrayer,
  savePrayer,
  deletePrayer,
  getAllNovenas,
  getNovena,
  saveNovena,
  deleteNovena,
  generateId
} from './db.js';
import { formatPrayerContent, stripFormattingForPreview } from './formatter.js';
import { downloadNovenaIcs, buildSmsLink, buildMailtoLink, buildReminderMessage } from './ics.js';
import { renderPdfIntoContainer, openPdfNatively } from './pdf-viewer.js';

const FONT_SIZE_KEY = 'mpq_font_size_px';
const NOTIF_LOG_KEY = 'mpq_notified_today';

const state = {
  prayers: [],
  novenas: [],
  activeTab: 'prayers',
  filterType: 'all',
  searchQuery: '',
  currentPrayerId: null,
  currentNovenaId: null,
  returnView: 'list',
  editingPrayer: false,
  fontSizePx: Number(localStorage.getItem(FONT_SIZE_KEY)) || 15.5,
  pdfScale: 1
};

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

function updateOnlineBadge() {
  const pill = $('offline-pill');
  const label = $('offline-label');
  if (navigator.onLine) {
    pill.classList.remove('is-offline');
    label.textContent = 'Hors-ligne prêt';
  } else {
    pill.classList.add('is-offline');
    label.textContent = 'Mode hors-ligne actif';
  }
}

function applyPrayerFontSize() {
  document.documentElement.style.setProperty('--prayer-font-size', `${state.fontSizePx}px`);
  localStorage.setItem(FONT_SIZE_KEY, String(state.fontSizePx));
}

/* =========================================================
   NAVIGATION ENTRE VUES & MODALES
   ========================================================= */
function showView(name) {
  $('view-list').classList.toggle('hidden', name !== 'list');
  $('view-prayer').classList.toggle('hidden', name !== 'prayer');
  $('view-novena').classList.toggle('hidden', name !== 'novena');
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function closeAllSheets() {
  $('modal-backdrop').classList.add('hidden');
  $('sheet-add').classList.add('hidden');
  $('sheet-pdf').classList.add('hidden');
  $('sheet-novena').classList.add('hidden');
  $('sheet-info').classList.add('hidden');
}

function openSheet(sheetId) {
  closeAllSheets();
  $('modal-backdrop').classList.remove('hidden');
  $(sheetId).classList.remove('hidden');
}

/* =========================================================
   RENDU DE LA LISTE PRINCIPALE
   ========================================================= */
async function reloadData() {
  const [prayers, novenas] = await Promise.all([getAllPrayers(), getAllNovenas()]);
  state.prayers = prayers;
  state.novenas = novenas;
  renderList();
  checkInAppReminders();
}

function renderList() {
  $('count-prayers-badge').textContent = String(state.prayers.length);
  $('count-novenas-badge').textContent = String(state.novenas.length);

  const isPrayers = state.activeTab === 'prayers';
  $('tab-prayers').classList.toggle('active', isPrayers);
  $('tab-prayers').setAttribute('aria-selected', String(isPrayers));
  $('tab-novenas').classList.toggle('active', !isPrayers);
  $('tab-novenas').setAttribute('aria-selected', String(!isPrayers));

  $('panel-prayers').classList.toggle('hidden', !isPrayers);
  $('panel-novenas').classList.toggle('hidden', isPrayers);

  if (isPrayers) {
    const n = state.prayers.length;
    $('bottom-summary').textContent = `${n} prière${n > 1 ? 's' : ''}`;
    renderPrayersList();
  } else {
    const n = state.novenas.length;
    $('bottom-summary').textContent = `${n} neuvaine${n > 1 ? 's' : ''}`;
    renderNovenasList();
  }
}

function renderPrayersList() {
  const q = state.searchQuery.trim().toLowerCase();
  const filtered = state.prayers.filter((p) => {
    if (state.filterType !== 'all' && p.type !== state.filterType) return false;
    if (!q) return true;
    const hay = `${p.title || ''} ${p.content || ''} ${p.fileName || ''}`.toLowerCase();
    return hay.includes(q);
  });

  const container = $('prayers-list');
  container.innerHTML = '';
  $('prayers-empty').classList.toggle('hidden', filtered.length > 0);

  for (const p of filtered) {
    const linkedNovena = state.novenas.find((n) => n.prayerId === p.id);
    const row = document.createElement('div');
    row.className = 'note-row';

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
    if (p.type === 'pdf') {
      const b = document.createElement('span');
      b.className = 'badge-pdf';
      b.textContent = 'PDF';
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
    } else {
      preview.textContent = stripFormattingForPreview(p.content) || 'Note vide…';
    }
    mainBtn.appendChild(preview);

    const meta = document.createElement('div');
    meta.className = 'note-row-meta';
    meta.textContent = `Modifiée ${formatShortDate(p.updatedAt)}`;
    mainBtn.appendChild(meta);

    mainBtn.addEventListener('click', () => openPrayer(p.id, 'list'));

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'row-delete-btn';
    delBtn.setAttribute('aria-label', `Supprimer ${p.title || 'cette prière'}`);
    delBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path></svg>`;
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      confirmAndDeletePrayer(p.id);
    });

    row.appendChild(mainBtn);
    row.appendChild(delBtn);
    container.appendChild(row);
  }
}

function renderNovenasList() {
  const q = state.searchQuery.trim().toLowerCase();
  const filtered = state.novenas.filter((n) => {
    if (!q) return true;
    const hay = `${n.title || ''} ${n.intention || ''}`.toLowerCase();
    return hay.includes(q);
  });

  // Bannière de rappel du jour
  const dueToday = state.novenas.filter((n) => {
    const doneCount = (n.completedDays || []).length;
    if (doneCount >= n.totalDays) return false;
    const curDay = computeCurrentDay(n);
    return !(n.completedDays || []).includes(curDay);
  });

  const banner = $('novena-reminder-banner');
  if (dueToday.length > 0) {
    banner.classList.remove('hidden');
    banner.innerHTML = `<span>🕯️ <strong>${dueToday.length}</strong> neuvaine${dueToday.length > 1 ? 's' : ''} à prier aujourd'hui</span>`;
    const quickBtn = document.createElement('button');
    quickBtn.type = 'button';
    quickBtn.className = 'btn-validate-day';
    quickBtn.textContent = 'Ouvrir';
    quickBtn.addEventListener('click', () => openNovena(dueToday[0].id));
    banner.appendChild(quickBtn);
  } else {
    banner.classList.add('hidden');
  }

  const container = $('novenas-list');
  container.innerHTML = '';
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
    prog.innerHTML = `
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
      <span class="progress-label">${done}/${total} j</span>
    `;
    mainBtn.appendChild(prog);

    const meta = document.createElement('div');
    meta.className = 'note-row-meta';
    meta.textContent = n.reminder?.enabled
      ? `🔔 Rappel ${n.reminder.time || '08:00'} (${channelLabel(n.reminder.channel)})`
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
  return 'iPhone';
}

/* =========================================================
   VUE PRIÈRE (LECTURE / ÉDITION / PDF)
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

  $('prayer-back-label').textContent = returnView === 'novena' ? 'Neuvaine' : 'Prières';
  showView('prayer');
  await renderCurrentPrayer();
}

async function renderCurrentPrayer() {
  const prayer = await getPrayer(state.currentPrayerId);
  if (!prayer) return;

  const isText = prayer.type === 'text';
  $('btn-prayer-edit-toggle').classList.toggle('hidden', !isText);
  $('btn-prayer-edit-toggle').textContent = state.editingPrayer ? 'OK' : 'Modifier';

  // Barre contexte neuvaine si ouverte depuis une neuvaine ou liée
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
  $('prayer-pdf-pane').classList.toggle('hidden', isText);

  if (isText) {
    if (state.editingPrayer) {
      $('edit-prayer-title').value = prayer.title || '';
      $('edit-prayer-content').value = prayer.content || '';
    } else {
      $('prayer-meta-date').textContent = `Modifiée le ${new Date(prayer.updatedAt || Date.now()).toLocaleDateString('fr-FR')}`;
      $('prayer-cover-title').textContent = prayer.title || 'Prière sans titre';
      $('prayer-rendered-body').innerHTML = formatPrayerContent(prayer.content || '');
    }
  } else {
    $('pdf-zoom-label').textContent = `${Math.round(state.pdfScale * 100)}%`;
    $('btn-pdf-open-native').onclick = () => {
      if (prayer.pdfBlob) openPdfNatively(prayer.pdfBlob, prayer.fileName || 'priere.pdf');
    };
    const container = $('pdf-pages-container');
    if (!prayer.pdfBlob) {
      container.innerHTML = '<p class="empty-sub">Fichier PDF introuvable.</p>';
      return;
    }
    try {
      await renderPdfIntoContainer(prayer.pdfBlob, container, {
        scale: state.pdfScale,
        onPageCount: (count) => {
          $('pdf-page-info').textContent = `${prayer.title || 'PDF'} • ${count} page${count > 1 ? 's' : ''}`;
        }
      });
    } catch (err) {
      container.innerHTML = `<div class="empty-state"><p class="empty-title">Aperçu PDF indisponible</p><p class="empty-sub">${err.message}</p><button id="btn-fallback-pdf" class="btn-primary-soft" type="button">Ouvrir le PDF avec iOS</button></div>`;
      const fb = document.getElementById('btn-fallback-pdf');
      if (fb) fb.addEventListener('click', () => openPdfNatively(prayer.pdfBlob, prayer.fileName));
    }
  }
}

async function saveEditedPrayer({ exitEdit = false } = {}) {
  const prayer = await getPrayer(state.currentPrayerId);
  if (!prayer || prayer.type !== 'text') return;
  prayer.title = $('edit-prayer-title').value.trim() || 'Prière sans titre';
  prayer.content = $('edit-prayer-content').value;
  prayer.updatedAt = Date.now();
  await savePrayer(prayer);
  await reloadData();
  if (exitEdit) {
    state.editingPrayer = false;
    await renderCurrentPrayer();
    showToast('Prière enregistrée');
  }
}

async function createNewTextPrayer() {
  const now = Date.now();
  const prayer = {
    id: generateId('prayer'),
    type: 'text',
    title: 'Nouvelle prière',
    content: '',
    createdAt: now,
    updatedAt: now
  };
  await savePrayer(prayer);
  await reloadData();
  await openPrayer(prayer.id, 'list', true);
  $('edit-prayer-title').select();
}

async function confirmAndDeletePrayer(id) {
  const prayer = await getPrayer(id);
  if (!prayer) return;
  if (!confirm(`Supprimer « ${prayer.title || 'cette prière'} » ?`)) return;

  await deletePrayer(id);
  // Détacher des neuvaines qui référencent cette prière
  const allNovenas = await getAllNovenas();
  for (const n of allNovenas) {
    if (n.prayerId === id) {
      n.prayerId = '';
      await saveNovena(n);
    }
  }
  await reloadData();
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
}

/* =========================================================
   IMPORT PDF
   ========================================================= */
function openPdfImportSheet() {
  $('pdf-file-input').value = '';
  $('pdf-title-input').value = '';
  $('pdf-file-meta').textContent = 'Le fichier est enregistré directement sur votre iPhone pour fonctionner sans connexion.';
  openSheet('sheet-pdf');
}

async function handleSavePdf() {
  const file = $('pdf-file-input').files?.[0];
  if (!file) {
    showToast('Veuillez choisir un fichier PDF.');
    return;
  }
  const title = $('pdf-title-input').value.trim() || file.name.replace(/\.pdf$/i, '') || 'Prière PDF';
  const now = Date.now();
  const prayer = {
    id: generateId('pdf'),
    type: 'pdf',
    title,
    pdfBlob: file,
    fileName: file.name,
    fileSize: file.size,
    createdAt: now,
    updatedAt: now
  };
  await savePrayer(prayer);
  await reloadData();
  closeAllSheets();
  showToast('PDF ajouté au carnet');
  await openPrayer(prayer.id, 'list', false);
}

/* =========================================================
   MODULE NEUVAINE
   ========================================================= */
function openNovenaSheet({ existingNovena = null, prefillPrayerId = '' } = {}) {
  const select = $('novena-prayer-select');
  select.innerHTML = '<option value="">— Aucune prière liée —</option>';
  for (const p of state.prayers) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.title || 'Sans titre'}${p.type === 'pdf' ? ' (PDF)' : ''}`;
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
  await reloadData();
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

  // Grille des jours
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
    sub.textContent = doneSet.has(d) ? 'Fait ✓' : (d === curDay ? "Aujourd'hui" : 'À faire');

    cell.appendChild(top);
    cell.appendChild(sub);
    cell.addEventListener('click', async () => {
      await toggleNovenaDay(n.id, d);
      await renderCurrentNovena();
    });
    grid.appendChild(cell);
  }

  // Résumé rappel
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
  $('btn-novena-download-ics').onclick = () => {
    downloadNovenaIcs(n, linkedPrayer?.title || '', window.location.href.split('#')[0]);
    showToast('Calendrier .ics généré pour iPhone');
  };
  $('btn-novena-send-sms').onclick = () => {
    window.location.href = buildSmsLink(rem.phone, n, linkedPrayer?.title || '', curDay);
  };
  $('btn-novena-send-email').onclick = () => {
    window.location.href = buildMailtoLink(rem.email, n, linkedPrayer?.title || '', curDay);
  };
  $('btn-novena-pwa-notif').onclick = () => requestAndTestPwaNotification(n, linkedPrayer?.title || '', curDay);
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
  await reloadData();
}

async function confirmAndDeleteNovena(id) {
  const n = await getNovena(id);
  if (!n) return;
  if (!confirm(`Supprimer le module neuvaine « ${n.title} » ?`)) return;
  await deleteNovena(id);
  await reloadData();
  if (state.currentNovenaId === id) {
    state.currentNovenaId = null;
    showView('list');
  }
  showToast('Neuvaine supprimée');
}

/* =========================================================
   NOTIFICATIONS PWA LOCALES (LORSQUE SUPPORTÉ SUR iOS 16.4+)
   ========================================================= */
async function requestAndTestPwaNotification(novena, prayerTitle, curDay) {
  if (!('Notification' in window)) {
    showToast('Notifications web indisponibles ici : utilisez le bouton Calendrier .ics.');
    return;
  }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    showToast('Permission refusée. Utilisez le bouton Calendrier .ics pour iPhone.');
    return;
  }
  const body = buildReminderMessage(novena, prayerTitle, curDay);
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (reg?.showNotification) {
      await reg.showNotification('Ma prière quotidienne', {
        body,
        icon: './icons/icon-192.png',
        tag: `novena-${novena.id}`
      });
    } else {
      new Notification('Ma prière quotidienne', { body });
    }
    showToast('Notification activée !');
  } catch {
    showToast('Utilisez le fichier .ics pour les rappels hors-ligne iOS.');
  }
}

function checkInAppReminders() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const now = new Date();
  const nowHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const today = todayIso();
  const sentMap = JSON.parse(localStorage.getItem(NOTIF_LOG_KEY) || '{}');

  for (const n of state.novenas) {
    if (!n.reminder?.enabled) continue;
    const curDay = computeCurrentDay(n);
    if ((n.completedDays || []).includes(curDay)) continue;
    const logKey = `${n.id}-${today}`;
    if (sentMap[logKey]) continue;
    if (nowHHMM >= (n.reminder.time || '08:00')) {
      const prayer = state.prayers.find((p) => p.id === n.prayerId);
      const body = buildReminderMessage(n, prayer?.title || '', curDay);
      navigator.serviceWorker?.ready.then((reg) => {
        if (reg?.showNotification) {
          reg.showNotification('Ma prière quotidienne', { body, icon: './icons/icon-192.png', tag: logKey });
        }
      }).catch(() => {});
      sentMap[logKey] = true;
    }
  }
  localStorage.setItem(NOTIF_LOG_KEY, JSON.stringify(sentMap));
}

/* =========================================================
   INITIALISATION & ÉVÉNEMENTS
   ========================================================= */
function bindEvents() {
  window.addEventListener('online', updateOnlineBadge);
  window.addEventListener('offline', updateOnlineBadge);

  $('btn-open-info').addEventListener('click', () => openSheet('sheet-info'));
  $('modal-backdrop').addEventListener('click', closeAllSheets);
  document.querySelectorAll('[data-close-sheet]').forEach((btn) => btn.addEventListener('click', closeAllSheets));

  // Recherche
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
  });

  // Onglets Prières / Neuvaines
  document.querySelectorAll('.segment-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.activeTab = btn.dataset.tab;
      renderList();
    });
  });

  // Filtres Prières
  document.querySelectorAll('.pill-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.filterType = btn.dataset.filter;
      document.querySelectorAll('.pill-btn').forEach((b) => b.classList.toggle('active', b === btn));
      renderPrayersList();
    });
  });

  // Action Sheet ajout
  $('btn-add-menu').addEventListener('click', () => openSheet('sheet-add'));
  $('act-cancel-add').addEventListener('click', closeAllSheets);
  $('act-new-text-prayer').addEventListener('click', () => {
    closeAllSheets();
    createNewTextPrayer();
  });
  $('act-new-pdf-prayer').addEventListener('click', openPdfImportSheet);
  $('act-new-novena').addEventListener('click', () => openNovenaSheet());
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

  // Navigation Vue Prière
  $('btn-prayer-back').addEventListener('click', async () => {
    if (state.editingPrayer) {
      await saveEditedPrayer({ exitEdit: false });
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

  $('btn-prayer-edit-toggle').addEventListener('click', async () => {
    if (state.editingPrayer) {
      await saveEditedPrayer({ exitEdit: true });
    } else {
      state.editingPrayer = true;
      await renderCurrentPrayer();
    }
  });

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

  // Zoom PDF
  $('btn-pdf-zoom-out').addEventListener('click', () => {
    state.pdfScale = Math.max(0.75, +(state.pdfScale - 0.25).toFixed(2));
    renderCurrentPrayer();
  });
  $('btn-pdf-zoom-in').addEventListener('click', () => {
    state.pdfScale = Math.min(2.5, +(state.pdfScale + 0.25).toFixed(2));
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

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('./sw.js', { scope: './' });
  } catch (err) {
    console.warn('Service worker registration failed:', err);
  }
}

async function boot() {
  applyPrayerFontSize();
  updateOnlineBadge();
  bindEvents();
  await initDbAndSeed();
  await reloadData();
  await registerServiceWorker();
  setInterval(checkInAppReminders, 60000);
}

boot();
