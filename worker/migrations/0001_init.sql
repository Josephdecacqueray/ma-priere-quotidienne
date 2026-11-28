-- Migration initiale v8 : Ma prière quotidienne (Multi-utilisateurs jusqu'à 1 000 comptes)
-- Cloudflare D1 (SQLite) — Strictement cloisonné par user_id, zéro binaire PDF/image dans D1.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email_normalized TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  recovery_key_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  text_bytes_used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  family_id TEXT NOT NULL,
  refresh_token_hash TEXT NOT NULL UNIQUE,
  device_label TEXT NOT NULL DEFAULT 'Appareil',
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  rotated_at INTEGER,
  revoked_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, revoked_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_family ON sessions(family_id);

-- Prières : texte pur et métadonnées légères uniquement (jamais de binaire PDF/image dans D1)
CREATE TABLE IF NOT EXISTS prayers (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'text',
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  folder TEXT NOT NULL DEFAULT '',
  pinned INTEGER NOT NULL DEFAULT 0,
  file_name TEXT NOT NULL DEFAULT '',
  mime_type TEXT NOT NULL DEFAULT '',
  file_size INTEGER NOT NULL DEFAULT 0,
  file_sha256 TEXT NOT NULL DEFAULT '',
  drive_file_id TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_prayers_user_updated ON prayers(user_id, deleted_at, updated_at DESC);

CREATE TABLE IF NOT EXISTS novenas (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  prayer_id TEXT NOT NULL DEFAULT '',
  intention TEXT NOT NULL DEFAULT '',
  total_days INTEGER NOT NULL DEFAULT 9,
  start_date TEXT NOT NULL,
  completed_days_json TEXT NOT NULL DEFAULT '[]',
  reminder_enabled INTEGER NOT NULL DEFAULT 0,
  reminder_time TEXT NOT NULL DEFAULT '08:00',
  reminder_channel TEXT NOT NULL DEFAULT 'iphone',
  reminder_phone TEXT NOT NULL DEFAULT '',
  reminder_email TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_novenas_user_updated ON novenas(user_id, deleted_at, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_novenas_active_reminders ON novenas(reminder_enabled, deleted_at, user_id);

CREATE TABLE IF NOT EXISTS intentions (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  text TEXT NOT NULL,
  answered INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_intentions_user_updated ON intentions(user_id, deleted_at, updated_at DESC);

CREATE TABLE IF NOT EXISTS rosary_state (
  user_id TEXT PRIMARY KEY,
  group_key TEXT NOT NULL DEFAULT 'joyeux',
  decade_index INTEGER NOT NULL DEFAULT 0,
  bead_index INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS settings (
  user_id TEXT PRIMARY KEY,
  theme_mode TEXT NOT NULL DEFAULT 'auto',
  font_size_px REAL NOT NULL DEFAULT 15.5,
  drive_sync_enabled INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Europe/Paris',
  tz_offset_minutes INTEGER NOT NULL DEFAULT -60,
  last_notified_key TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id);

CREATE TABLE IF NOT EXISTS push_sent_log (
  sub_id TEXT NOT NULL,
  novena_id TEXT NOT NULL,
  local_date TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  PRIMARY KEY (sub_id, novena_id, local_date),
  FOREIGN KEY (sub_id) REFERENCES push_subscriptions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_push_sent_date ON push_sent_log(local_date);

CREATE TABLE IF NOT EXISTS feedback_messages (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  category TEXT NOT NULL,
  message TEXT NOT NULL,
  reply_contact TEXT NOT NULL DEFAULT '',
  app_context TEXT NOT NULL DEFAULT '',
  ip_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback_messages(created_at DESC);

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket_key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_exp ON rate_limits(expires_at);
