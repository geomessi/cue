-- Run once against your Neon database to initialize the schema.
-- Command: psql $DATABASE_URL -f schema.sql

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS contacts (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT        NOT NULL,
  email         TEXT        UNIQUE,
  company       TEXT,
  role          TEXT,
  last_contact_date DATE,
  relationship_context TEXT,
  follow_up_hook TEXT,
  source        TEXT        NOT NULL DEFAULT 'email_import',
  status        TEXT        NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tracks which Gmail messages have been processed so we never double-import.
CREATE TABLE IF NOT EXISTS email_history (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  gmail_message_id   TEXT        UNIQUE NOT NULL,
  processed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  subject            TEXT,
  contacts_extracted INTEGER     DEFAULT 0
);

-- Key-value store for runtime state (e.g. last Gmail historyId).
CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT        PRIMARY KEY,
  value      TEXT        NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
