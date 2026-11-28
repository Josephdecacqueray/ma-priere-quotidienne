-- Migration v9 : codes temporaires de réinitialisation de mot de passe par e-mail (valables 15 min)
CREATE TABLE IF NOT EXISTS password_reset_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_pw_reset_user ON password_reset_codes(user_id, expires_at DESC);
