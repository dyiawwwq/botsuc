-- Discord Community Knowledge Bot — SQLite schema
-- Applied idempotently at startup by src/db/migrate.ts.
--
-- Design notes:
--   * Every table that holds server-specific data carries guild_id and is always
--     queried scoped to a single guild_id (see src/db/repositories/*) to enforce
--     tenant isolation between Discord servers.
--   * Booleans are stored as INTEGER 0/1 (SQLite has no native boolean type).
--   * JSON-ish list/object fields are stored as TEXT containing JSON and are
--     parsed/serialized in the repository layer, never passed through raw.
--   * We deliberately do NOT have a table for raw message content, usernames,
--     tokens, or precise-location/health/political/protected-characteristic
--     data. conversation_context stores short derived summaries, not verbatim
--     transcripts, and is subject to expires_at + the /forget command.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS guilds (
  id         TEXT PRIMARY KEY,          -- Discord guild (server) snowflake ID
  name       TEXT,                      -- last-known guild name, display only
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per guild. Created with defaults the first time a guild is seen.
CREATE TABLE IF NOT EXISTS guild_config (
  guild_id                   TEXT PRIMARY KEY REFERENCES guilds(id) ON DELETE CASCADE,

  -- Identity (Core Requirements: "Server identity, purpose, description, culture")
  server_name                TEXT,
  server_purpose             TEXT,
  server_description         TEXT,
  server_culture             TEXT,

  -- Response behavior ("whether the bot responds publicly, privately, or only when mentioned")
  response_mode              TEXT NOT NULL DEFAULT 'mention_only'
                              CHECK (response_mode IN ('public','mention_only','private_only')),

  -- AI provider gating. ai_enabled must be explicitly turned on by an admin
  -- before ANY message content or question text is sent to an external
  -- provider; default is fully local keyword matching (provider = 'none').
  ai_enabled                 INTEGER NOT NULL DEFAULT 0,
  ai_provider                TEXT NOT NULL DEFAULT 'none' CHECK (ai_provider IN ('none','anthropic')),

  -- Moderation support (not autonomous punishment — see moderationSupport.ts)
  moderation_intensity       TEXT NOT NULL DEFAULT 'standard' CHECK (moderation_intensity IN ('lenient','standard','strict')),
  warning_threshold          INTEGER NOT NULL DEFAULT 3,
  prohibited_content_notes   TEXT,
  enforcement_style          TEXT NOT NULL DEFAULT 'warn_then_escalate',
  mod_alert_channel_id       TEXT,

  -- Continuous / message-analysis learning: OFF by default, opt-in only, and
  -- restricted to an explicit channel allowlist when enabled.
  message_analysis_enabled   INTEGER NOT NULL DEFAULT 0,
  message_analysis_channels  TEXT NOT NULL DEFAULT '[]', -- JSON array of channel IDs

  -- Retention
  retention_days             INTEGER NOT NULL DEFAULT 30,

  -- Feature toggles
  summarize_enabled          INTEGER NOT NULL DEFAULT 1,

  -- Access control beyond Discord's native Administrator/Manage Server perms
  admin_role_ids              TEXT NOT NULL DEFAULT '[]', -- JSON array of role IDs

  trusted_resource_links      TEXT NOT NULL DEFAULT '[]', -- JSON array of {label, url}

  updated_at                  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by_user_id          TEXT
);

-- Per-channel purpose/guidance and read/index permissioning.
-- "Which channels the bot may read, summarize, index, or answer from."
CREATE TABLE IF NOT EXISTS channel_config (
  id            TEXT PRIMARY KEY,
  guild_id      TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  channel_id    TEXT NOT NULL,
  purpose       TEXT,
  guidance      TEXT,
  category      TEXT,
  read_enabled  INTEGER NOT NULL DEFAULT 0, -- may the bot fetch message content here (summarize/analysis)
  index_enabled INTEGER NOT NULL DEFAULT 0, -- may derived knowledge from here be used to answer questions
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (guild_id, channel_id)
);

-- Authoritative + derived knowledge. This is the ONLY table /ask and /rules
-- read from — the bot never answers directly from raw live messages.
CREATE TABLE IF NOT EXISTS knowledge_entries (
  id                  TEXT PRIMARY KEY,
  guild_id            TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  type                TEXT NOT NULL CHECK (type IN
                        ('rule','policy','faq','onboarding','event','term','resource','derived_pattern','general')),
  title               TEXT NOT NULL,
  content             TEXT NOT NULL,
  source_channel_id   TEXT,
  source_message_id   TEXT,
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','outdated','archived')),
  confidence          TEXT NOT NULL DEFAULT 'authoritative' CHECK (confidence IN ('authoritative','derived_provisional')),
  created_by_user_id  TEXT NOT NULL,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_knowledge_guild_type   ON knowledge_entries(guild_id, type);
CREATE INDEX IF NOT EXISTS idx_knowledge_guild_status ON knowledge_entries(guild_id, status);

-- Ephemeral, short-lived conversational context ONLY (e.g. "what did I just
-- ask about" for a short follow-up window). Never a message transcript.
-- Always has an expiry and is deletable on request via /forget.
CREATE TABLE IF NOT EXISTS conversation_context (
  id           TEXT PRIMARY KEY,
  guild_id     TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  channel_id   TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  summary_text TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_conv_guild_user ON conversation_context(guild_id, user_id);
CREATE INDEX IF NOT EXISTS idx_conv_expiry     ON conversation_context(expires_at);

-- Append-only audit trail for admin/config actions, moderation-support
-- actions, and notable failures. Never contains message content or secrets.
CREATE TABLE IF NOT EXISTS audit_events (
  id             TEXT PRIMARY KEY,
  guild_id       TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  actor_user_id  TEXT NOT NULL,
  action         TEXT NOT NULL,
  target_type    TEXT,
  target_id      TEXT,
  metadata       TEXT,   -- JSON, non-sensitive only
  success        INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_guild_created ON audit_events(guild_id, created_at);

-- /feedback: "report an incorrect answer or suggest knowledge updates"
CREATE TABLE IF NOT EXISTS feedback_items (
  id               TEXT PRIMARY KEY,
  guild_id         TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  reporter_user_id TEXT NOT NULL,
  related_question TEXT,
  related_answer   TEXT,
  comment          TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewed','resolved','dismissed')),
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_feedback_guild ON feedback_items(guild_id, status);

-- /report: member-submitted moderation reports. Human-reviewed only; the bot
-- never actions these automatically (see moderationSupport.ts).
CREATE TABLE IF NOT EXISTS moderation_reports (
  id               TEXT PRIMARY KEY,
  guild_id         TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  reporter_user_id TEXT NOT NULL,
  channel_id       TEXT,
  message_id       TEXT,
  reason           TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewed','actioned','dismissed')),
  suggested_action TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reports_guild ON moderation_reports(guild_id, status);

CREATE TABLE IF NOT EXISTS schema_migrations (
  id          TEXT PRIMARY KEY,
  applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
