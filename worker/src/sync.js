/* =========================================================
   SYNCHRONISATION MULTI-UTILISATEURS (CLOUDFLARE D1)
   - Isolation absolue : user_id issu UNIQUEMENT du JWT vérifié
   - Zéro binaire PDF/image stocké dans D1 (métadonnées uniquement)
   - Plafond strict de texte par compte (2 Mo par défaut)
   - Fusion horodatée sans perte + tombstones
   ========================================================= */

import { sha256Hex } from './crypto.js';
import { SAFE_ID_RE, readJsonBounded, jsonResponse, sanitizeString, checkRateLimit } from './security.js';

const MAX_PRAYERS = 1000;
const MAX_NOVENAS = 200;
const MAX_INTENTIONS = 1000;
const MAX_SYNC_PAYLOAD_BYTES = 1024 * 1024; // 1 Mo max par requête sync

function cleanTs(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function validatePrayerInput(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '');
  if (!SAFE_ID_RE.test(id)) return null;

  const type = ['text', 'pdf', 'image'].includes(raw.type) ? raw.type : 'text';
  // Rejet absolu de tout contenu binaire ou data URL dans D1
  let content = type === 'text' ? sanitizeString(raw.content, 100000) : '';
  if (/^data:(application\/pdf|image\/)/i.test(content.trim())) {
    content = '';
  }

  return {
    id,
    type,
    title: sanitizeString(raw.title || 'Prière sans titre', 200).trim() || 'Prière sans titre',
    content,
    folder: sanitizeString(raw.folder || '', 60).trim(),
    pinned: raw.pinned ? 1 : 0,
    fileName: sanitizeString(raw.fileName || '', 240),
    mimeType: sanitizeString(raw.mimeType || '', 80),
    fileSize: Math.max(0, Math.floor(Number(raw.fileSize) || 0)),
    fileSha256: /^[a-f0-9]{64}$/i.test(String(raw.fileSha256 || '')) ? String(raw.fileSha256).toLowerCase() : '',
    driveFileId: /^[a-zA-Z0-9_-]{0,160}$/.test(String(raw.driveFileId || '')) ? String(raw.driveFileId || '') : '',
    createdAt: cleanTs(raw.createdAt) || Date.now(),
    updatedAt: cleanTs(raw.updatedAt) || Date.now()
  };
}

function validateNovenaInput(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '');
  if (!SAFE_ID_RE.test(id)) return null;

  const totalDays = Math.max(1, Math.min(365, Math.floor(Number(raw.totalDays) || 9)));
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(String(raw.startDate || ''))
    ? String(raw.startDate)
    : new Date().toISOString().slice(0, 10);

  const completedDays = Array.isArray(raw.completedDays)
    ? [...new Set(raw.completedDays.map((d) => Math.floor(Number(d))).filter((d) => d >= 1 && d <= totalDays))].sort((a, b) => a - b)
    : [];

  const rem = raw.reminder && typeof raw.reminder === 'object' ? raw.reminder : {};
  const remTime = /^\d{2}:\d{2}$/.test(String(rem.time || '')) ? String(rem.time) : '08:00';
  const remChannel = ['iphone', 'sms', 'email'].includes(rem.channel) ? rem.channel : 'iphone';

  return {
    id,
    title: sanitizeString(raw.title || 'Neuvaine', 200).trim() || 'Neuvaine',
    prayerId: SAFE_ID_RE.test(String(raw.prayerId || '')) ? String(raw.prayerId) : '',
    intention: sanitizeString(raw.intention || '', 1500),
    totalDays,
    startDate,
    completedDaysJson: JSON.stringify(completedDays),
    reminderEnabled: rem.enabled ? 1 : 0,
    reminderTime: remTime,
    reminderChannel: remChannel,
    reminderPhone: sanitizeString(rem.phone || '', 40),
    reminderEmail: sanitizeString(rem.email || '', 180),
    createdAt: cleanTs(raw.createdAt) || Date.now(),
    updatedAt: cleanTs(raw.updatedAt) || Date.now()
  };
}

function validateIntentionInput(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '');
  if (!SAFE_ID_RE.test(id)) return null;
  const text = sanitizeString(raw.text || '', 2000).trim();
  if (!text) return null;

  return {
    id,
    text,
    answered: (raw.done ?? raw.answered) ? 1 : 0,
    createdAt: cleanTs(raw.createdAt) || Date.now(),
    updatedAt: cleanTs(raw.updatedAt) || Date.now()
  };
}

async function readUserState(db, userId) {
  const [prayersRes, novenasRes, intentionsRes, rosaryRow, settingsRow] = await Promise.all([
    db.prepare('SELECT * FROM prayers WHERE user_id = ? ORDER BY pinned DESC, updated_at DESC').bind(userId).all(),
    db.prepare('SELECT * FROM novenas WHERE user_id = ? ORDER BY updated_at DESC').bind(userId).all(),
    db.prepare('SELECT * FROM intentions WHERE user_id = ? ORDER BY updated_at DESC').bind(userId).all(),
    db.prepare('SELECT * FROM rosary_state WHERE user_id = ?').bind(userId).first(),
    db.prepare('SELECT * FROM settings WHERE user_id = ?').bind(userId).first()
  ]);

  const prayers = [];
  const deletedPrayers = {};
  for (const r of prayersRes.results || []) {
    if (r.deleted_at > 0 && r.deleted_at >= r.updated_at) {
      deletedPrayers[r.id] = r.deleted_at;
    } else {
      prayers.push({
        id: r.id,
        type: r.type,
        title: r.title,
        content: r.content,
        folder: r.folder,
        pinned: Boolean(r.pinned),
        fileName: r.file_name || undefined,
        mimeType: r.mime_type || undefined,
        fileSize: r.file_size || undefined,
        fileSha256: r.file_sha256 || undefined,
        driveFileId: r.drive_file_id || undefined,
        hasPdf: r.type === 'pdf' || r.type === 'image',
        createdAt: r.created_at,
        updatedAt: r.updated_at
      });
    }
  }

  const novenas = [];
  const deletedNovenas = {};
  for (const r of novenasRes.results || []) {
    if (r.deleted_at > 0 && r.deleted_at >= r.updated_at) {
      deletedNovenas[r.id] = r.deleted_at;
    } else {
      let completedDays = [];
      try { completedDays = JSON.parse(r.completed_days_json || '[]'); } catch { completedDays = []; }
      novenas.push({
        id: r.id,
        title: r.title,
        prayerId: r.prayer_id || '',
        intention: r.intention || '',
        totalDays: r.total_days,
        startDate: r.start_date,
        completedDays,
        reminder: {
          enabled: Boolean(r.reminder_enabled),
          time: r.reminder_time || '08:00',
          channel: r.reminder_channel || 'iphone',
          phone: r.reminder_phone || '',
          email: r.reminder_email || ''
        },
        createdAt: r.created_at,
        updatedAt: r.updated_at
      });
    }
  }

  const intentions = [];
  const deletedIntentions = {};
  for (const r of intentionsRes.results || []) {
    if (r.deleted_at > 0 && r.deleted_at >= r.updated_at) {
      deletedIntentions[r.id] = r.deleted_at;
    } else {
      intentions.push({
        id: r.id,
        text: r.text,
        done: Boolean(r.answered),
        createdAt: r.created_at,
        updatedAt: r.updated_at
      });
    }
  }

  const state = {
    prayers,
    novenas,
    intentions,
    rosaryState: rosaryRow
      ? {
          groupKey: rosaryRow.group_key,
          decadeIndex: rosaryRow.decade_index,
          beadIndex: rosaryRow.bead_index,
          updatedAt: rosaryRow.updated_at
        }
      : null,
    settings: settingsRow
      ? {
          themeMode: settingsRow.theme_mode,
          fontSizePx: settingsRow.font_size_px,
          driveSyncEnabled: Boolean(settingsRow.drive_sync_enabled),
          updatedAt: settingsRow.updated_at
        }
      : null,
    deletedIds: {
      prayers: deletedPrayers,
      novenas: deletedNovenas,
      intentions: deletedIntentions
    }
  };

  const stateJson = JSON.stringify(state);
  const textBytesUsed = new TextEncoder().encode(stateJson).byteLength;
  const contentHash = (await sha256Hex(stateJson)).slice(0, 24);
  return { state, textBytesUsed, contentHash };
}

export async function handleGetSync(request, env, origin, auth) {
  const { state, textBytesUsed, contentHash } = await readUserState(env.DB, auth.userId);
  return jsonResponse({ ok: true, state, textBytesUsed, contentHash }, 200, origin);
}

export async function handlePostSync(request, env, origin, auth) {
  const rl = await checkRateLimit(env.DB, `sync:${auth.userId}`, 60, 600);
  if (!rl.allowed) {
    return jsonResponse(
      { error: 'Synchronisation temporairement limitée. Vos données restent sauvegardées sur l’appareil.' },
      429,
      origin,
      { 'Retry-After': rl.retryAfterSec }
    );
  }

  const body = await readJsonBounded(request, MAX_SYNC_PAYLOAD_BYTES);
  const userId = auth.userId;

  // Lire les horodatages existants pour ne mettre à jour que les éléments plus récents (LWW)
  const [exP, exN, exI] = await Promise.all([
    env.DB.prepare('SELECT id, updated_at, deleted_at FROM prayers WHERE user_id = ?').bind(userId).all(),
    env.DB.prepare('SELECT id, updated_at, deleted_at FROM novenas WHERE user_id = ?').bind(userId).all(),
    env.DB.prepare('SELECT id, updated_at, deleted_at FROM intentions WHERE user_id = ?').bind(userId).all()
  ]);

  const mapP = new Map((exP.results || []).map((r) => [r.id, r]));
  const mapN = new Map((exN.results || []).map((r) => [r.id, r]));
  const mapI = new Map((exI.results || []).map((r) => [r.id, r]));

  const statements = [];

  // Prières entrantes
  const incomingPrayers = Array.isArray(body.prayers) ? body.prayers.slice(0, MAX_PRAYERS) : [];
  for (const raw of incomingPrayers) {
    const p = validatePrayerInput(raw);
    if (!p) continue;
    const prev = mapP.get(p.id);
    const prevMax = prev ? Math.max(prev.updated_at || 0, prev.deleted_at || 0) : 0;
    if (!prev || p.updatedAt >= prevMax) {
      statements.push(
        env.DB
          .prepare(
            'INSERT INTO prayers (user_id, id, type, title, content, folder, pinned, file_name, mime_type, file_size, file_sha256, drive_file_id, created_at, updated_at, deleted_at) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0) ' +
            'ON CONFLICT(user_id, id) DO UPDATE SET ' +
            'type=excluded.type, title=excluded.title, content=excluded.content, folder=excluded.folder, pinned=excluded.pinned, ' +
            'file_name=excluded.file_name, mime_type=excluded.mime_type, file_size=excluded.file_size, file_sha256=excluded.file_sha256, ' +
            'drive_file_id=CASE WHEN excluded.drive_file_id != \'\' THEN excluded.drive_file_id ELSE prayers.drive_file_id END, ' +
            'updated_at=excluded.updated_at, deleted_at=0'
          )
          .bind(
            userId, p.id, p.type, p.title, p.content, p.folder, p.pinned,
            p.fileName, p.mimeType, p.fileSize, p.fileSha256, p.driveFileId,
            p.createdAt, p.updatedAt
          )
      );
    }
  }

  // Suppressions prières
  const delP = body.deletedIds?.prayers && typeof body.deletedIds.prayers === 'object' ? body.deletedIds.prayers : {};
  for (const [id, rawTs] of Object.entries(delP).slice(0, MAX_PRAYERS)) {
    const ts = cleanTs(rawTs);
    if (!SAFE_ID_RE.test(id) || ts <= 0) continue;
    const prev = mapP.get(id);
    if (!prev || ts >= Math.max(prev.updated_at || 0, prev.deleted_at || 0)) {
      statements.push(
        env.DB
          .prepare(
            'INSERT INTO prayers (user_id, id, type, title, content, created_at, updated_at, deleted_at) ' +
            'VALUES (?, ?, \'text\', \'\', \'\', ?, ?, ?) ' +
            'ON CONFLICT(user_id, id) DO UPDATE SET content=\'\', deleted_at=MAX(prayers.deleted_at, excluded.deleted_at)'
          )
          .bind(userId, id, ts, ts, ts)
      );
    }
  }

  // Neuvaines entrantes
  const incomingNovenas = Array.isArray(body.novenas) ? body.novenas.slice(0, MAX_NOVENAS) : [];
  for (const raw of incomingNovenas) {
    const n = validateNovenaInput(raw);
    if (!n) continue;
    const prev = mapN.get(n.id);
    const prevMax = prev ? Math.max(prev.updated_at || 0, prev.deleted_at || 0) : 0;
    if (!prev || n.updatedAt >= prevMax) {
      statements.push(
        env.DB
          .prepare(
            'INSERT INTO novenas (user_id, id, title, prayer_id, intention, total_days, start_date, completed_days_json, reminder_enabled, reminder_time, reminder_channel, reminder_phone, reminder_email, created_at, updated_at, deleted_at) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0) ' +
            'ON CONFLICT(user_id, id) DO UPDATE SET ' +
            'title=excluded.title, prayer_id=excluded.prayer_id, intention=excluded.intention, total_days=excluded.total_days, ' +
            'start_date=excluded.start_date, completed_days_json=excluded.completed_days_json, reminder_enabled=excluded.reminder_enabled, ' +
            'reminder_time=excluded.reminder_time, reminder_channel=excluded.reminder_channel, reminder_phone=excluded.reminder_phone, ' +
            'reminder_email=excluded.reminder_email, updated_at=excluded.updated_at, deleted_at=0'
          )
          .bind(
            userId, n.id, n.title, n.prayerId, n.intention, n.totalDays, n.startDate,
            n.completedDaysJson, n.reminderEnabled, n.reminderTime, n.reminderChannel,
            n.reminderPhone, n.reminderEmail, n.createdAt, n.updatedAt
          )
      );
    }
  }

  // Suppressions neuvaines
  const delN = body.deletedIds?.novenas && typeof body.deletedIds.novenas === 'object' ? body.deletedIds.novenas : {};
  for (const [id, rawTs] of Object.entries(delN).slice(0, MAX_NOVENAS)) {
    const ts = cleanTs(rawTs);
    if (!SAFE_ID_RE.test(id) || ts <= 0) continue;
    const prev = mapN.get(id);
    if (!prev || ts >= Math.max(prev.updated_at || 0, prev.deleted_at || 0)) {
      statements.push(
        env.DB
          .prepare(
            'INSERT INTO novenas (user_id, id, title, start_date, created_at, updated_at, deleted_at) ' +
            'VALUES (?, ?, \'\', \'2000-01-01\', ?, ?, ?) ' +
            'ON CONFLICT(user_id, id) DO UPDATE SET reminder_enabled=0, deleted_at=MAX(novenas.deleted_at, excluded.deleted_at)'
          )
          .bind(userId, id, ts, ts, ts)
      );
    }
  }

  // Intentions entrantes
  const incomingIntentions = Array.isArray(body.intentions) ? body.intentions.slice(0, MAX_INTENTIONS) : [];
  for (const raw of incomingIntentions) {
    const item = validateIntentionInput(raw);
    if (!item) continue;
    const prev = mapI.get(item.id);
    const prevMax = prev ? Math.max(prev.updated_at || 0, prev.deleted_at || 0) : 0;
    if (!prev || item.updatedAt >= prevMax) {
      statements.push(
        env.DB
          .prepare(
            'INSERT INTO intentions (user_id, id, text, answered, created_at, updated_at, deleted_at) ' +
            'VALUES (?, ?, ?, ?, ?, ?, 0) ' +
            'ON CONFLICT(user_id, id) DO UPDATE SET text=excluded.text, answered=excluded.answered, updated_at=excluded.updated_at, deleted_at=0'
          )
          .bind(userId, item.id, item.text, item.answered, item.createdAt, item.updatedAt)
      );
    }
  }

  // Suppressions intentions
  const delI = body.deletedIds?.intentions && typeof body.deletedIds.intentions === 'object' ? body.deletedIds.intentions : {};
  for (const [id, rawTs] of Object.entries(delI).slice(0, MAX_INTENTIONS)) {
    const ts = cleanTs(rawTs);
    if (!SAFE_ID_RE.test(id) || ts <= 0) continue;
    const prev = mapI.get(id);
    if (!prev || ts >= Math.max(prev.updated_at || 0, prev.deleted_at || 0)) {
      statements.push(
        env.DB
          .prepare(
            'INSERT INTO intentions (user_id, id, text, created_at, updated_at, deleted_at) ' +
            'VALUES (?, ?, \'\', ?, ?, ?) ' +
            'ON CONFLICT(user_id, id) DO UPDATE SET text=\'\', deleted_at=MAX(intentions.deleted_at, excluded.deleted_at)'
          )
          .bind(userId, id, ts, ts, ts)
      );
    }
  }

  // État du chapelet interactif
  if (body.rosaryState && typeof body.rosaryState === 'object') {
    const gk = ['joyeux', 'lumineux', 'douloureux', 'glorieux'].includes(body.rosaryState.groupKey)
      ? body.rosaryState.groupKey
      : 'joyeux';
    const dec = Math.max(0, Math.min(4, Math.floor(Number(body.rosaryState.decadeIndex) || 0)));
    const bead = Math.max(0, Math.min(10, Math.floor(Number(body.rosaryState.beadIndex) || 0)));
    const rTs = cleanTs(body.rosaryState.updatedAt) || Date.now();
    statements.push(
      env.DB
        .prepare(
          'INSERT INTO rosary_state (user_id, group_key, decade_index, bead_index, updated_at) VALUES (?, ?, ?, ?, ?) ' +
          'ON CONFLICT(user_id) DO UPDATE SET group_key=excluded.group_key, decade_index=excluded.decade_index, bead_index=excluded.bead_index, updated_at=excluded.updated_at ' +
          'WHERE excluded.updated_at >= rosary_state.updated_at'
        )
        .bind(userId, gk, dec, bead, rTs)
    );
  }

  // Préférences utilisateur
  if (body.settings && typeof body.settings === 'object') {
    const tm = ['auto', 'dark', 'light'].includes(body.settings.themeMode) ? body.settings.themeMode : 'auto';
    const fs = Math.max(13, Math.min(22, Number(body.settings.fontSizePx) || 15.5));
    const driveOn = body.settings.driveSyncEnabled ? 1 : 0;
    const sTs = cleanTs(body.settings.updatedAt) || Date.now();
    statements.push(
      env.DB
        .prepare(
          'INSERT INTO settings (user_id, theme_mode, font_size_px, drive_sync_enabled, updated_at) VALUES (?, ?, ?, ?, ?) ' +
          'ON CONFLICT(user_id) DO UPDATE SET theme_mode=excluded.theme_mode, font_size_px=excluded.font_size_px, drive_sync_enabled=excluded.drive_sync_enabled, updated_at=excluded.updated_at ' +
          'WHERE excluded.updated_at >= settings.updated_at'
        )
        .bind(userId, tm, fs, driveOn, sTs)
    );
  }

  // Vérification quota texte par utilisateur avant écriture (2 Mo max -> 2 Go max pour 1 000 comptes sur 5 Go D1)
  const maxTextBytes = Number(env.MAX_USER_TEXT_BYTES) || 2097152;
  const approxIncomingBytes = new TextEncoder().encode(JSON.stringify(incomingPrayers)).byteLength
    + new TextEncoder().encode(JSON.stringify(incomingNovenas)).byteLength
    + new TextEncoder().encode(JSON.stringify(incomingIntentions)).byteLength;
  if (approxIncomingBytes > maxTextBytes) {
    return jsonResponse(
      {
        code: 'TEXT_QUOTA_EXCEEDED',
        error: 'Le plafond de 2 Mo de texte par compte est atteint. Les PDF lourds doivent être synchronisés via votre Google Drive personnel.'
      },
      413,
      origin
    );
  }

  // Exécution par lots D1 (100 requêtes max par batch pour rester fluide)
  for (let i = 0; i < statements.length; i += 80) {
    await env.DB.batch(statements.slice(i, i + 80));
  }

  const { state, textBytesUsed, contentHash } = await readUserState(env.DB, userId);
  await env.DB
    .prepare('UPDATE users SET text_bytes_used = ?, updated_at = ? WHERE id = ?')
    .bind(textBytesUsed, Date.now(), userId)
    .run();

  return jsonResponse({ ok: true, state, textBytesUsed, contentHash }, 200, origin);
}
