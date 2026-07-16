PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS questionnaire_invitations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL,
  respondent_name TEXT NOT NULL,
  respondent_email TEXT NOT NULL DEFAULT '',
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'opened', 'draft', 'submitted', 'revoked', 'expired')),
  expires_at TEXT NOT NULL,
  opened_at TEXT,
  submitted_at TEXT,
  folio TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS questionnaire_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invitation_id INTEGER NOT NULL UNIQUE,
  identity_json TEXT NOT NULL DEFAULT '{}',
  answers_json TEXT NOT NULL DEFAULT '{}',
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  consent_at TEXT,
  submitted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (invitation_id) REFERENCES questionnaire_invitations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS questionnaire_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invitation_id INTEGER,
  event_type TEXT NOT NULL,
  event_detail TEXT NOT NULL DEFAULT '{}',
  ip_hash TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (invitation_id) REFERENCES questionnaire_invitations(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS admin_login_attempts (
  ip_hash TEXT PRIMARY KEY,
  failed_count INTEGER NOT NULL DEFAULT 0,
  blocked_until TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_questionnaire_invitations_status
  ON questionnaire_invitations(status);
CREATE INDEX IF NOT EXISTS idx_questionnaire_invitations_expires
  ON questionnaire_invitations(expires_at);
CREATE INDEX IF NOT EXISTS idx_questionnaire_audit_invitation
  ON questionnaire_audit(invitation_id, created_at DESC);
