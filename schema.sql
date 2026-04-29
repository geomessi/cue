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
  notes         TEXT,
  source        TEXT        NOT NULL DEFAULT 'email_import',
  status        TEXT        NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Update contacts status check to include pending_review and dismissed
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_status_check;
ALTER TABLE contacts ADD CONSTRAINT contacts_status_check
  CHECK (status IN ('pending_review','active','dormant','archived','dismissed'));

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

-- Companies table
CREATE TABLE IF NOT EXISTS companies (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  website         TEXT,
  industry        TEXT,
  stage           TEXT,
  description     TEXT,
  notes           TEXT,
  status          TEXT NOT NULL DEFAULT 'pending_review'
                    CHECK (status IN ('pending_review','active','dismissed')),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS companies_name_idx ON companies (lower(name));

-- Migration: set existing email-imported contacts back to pending_review for demo
UPDATE contacts SET status = 'pending_review' WHERE source = 'email_import' AND status = 'active';

-- Migration: add linkedin URL field
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS linkedin TEXT;
