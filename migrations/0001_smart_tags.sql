-- Smart QR tag, D1 schema v1 (ADR 2026-11-16, section 5). Migrations only ever ADD: never edit this file after it has
-- been applied; put changes in 0002_*.sql. All times are epoch milliseconds (UTC). No raw IPs, ever (ip_hash is salted and
-- nulled after 24 h). Location, finder message, and finder reply live on scans rows and are purged after 30 days.

CREATE TABLE IF NOT EXISTS tags (
  id                    TEXT PRIMARY KEY,                -- 10 chars, Crockford base32 upper case (see functions/api/_tagid.js)
  order_id              TEXT NOT NULL,                   -- SDT-XXXX (the order itself stays in KV)
  tag_index             INTEGER NOT NULL,                -- index into order.tags
  shape                 TEXT NOT NULL,
  finish                TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'issued'
                        CHECK (status IN ('issued','engraved','qc_pass','qc_fail','shipped','claimed','disabled')),
  claim_ver             INTEGER NOT NULL DEFAULT 1,      -- bump to invalidate the printed claim code (code is HMAC, never stored)
  owner_id              TEXT,
  buyer_email           TEXT,                            -- order email, only for the "not set up yet" forward; nulled at claim
  dog_name              TEXT,
  message               TEXT,                            -- owner's note to a finder, 200 chars, links removed
  show_phone            INTEGER NOT NULL DEFAULT 0,      -- finder page shows a tel: link only when 1
  alerts_paused_until   INTEGER,                         -- epoch ms; NULL = running; 4102444800000 (2100) = off
  plan                  TEXT NOT NULL DEFAULT 'free',
  paid_through          INTEGER,
  qr_version            INTEGER,
  qr_ecl                TEXT,
  qr_module_mm          REAL,
  payload               TEXT,                            -- exact text the QR encodes (QC decode must match it)
  native_scan_seen_at   INTEGER,                         -- first beacon from an engraved, unshipped tag (phone camera check)
  qc_decode_at          INTEGER,                         -- in-page camera decode matched the payload
  qc_fail_note          TEXT,
  burst_id              TEXT,
  burst_at              INTEGER,
  burst_loc_alerts      INTEGER NOT NULL DEFAULT 0,
  burst_lat             REAL,
  burst_lng             REAL,
  unclaimed_notified_at INTEGER,
  created_at            INTEGER NOT NULL,
  engraved_at           INTEGER,
  shipped_at            INTEGER,
  claimed_at            INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS tags_order_entry ON tags(order_id, tag_index);
CREATE INDEX IF NOT EXISTS tags_owner ON tags(owner_id);
CREATE INDEX IF NOT EXISTS tags_status ON tags(status);

CREATE TABLE IF NOT EXISTS owners (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  tz              TEXT NOT NULL DEFAULT 'America/Denver',
  marketing_optin INTEGER NOT NULL DEFAULT 0,            -- its own box, never bundled with alerts
  created_at      INTEGER NOT NULL,
  last_login_at   INTEGER
);

CREATE TABLE IF NOT EXISTS contacts (
  id               TEXT PRIMARY KEY,
  owner_id         TEXT NOT NULL,
  tag_id           TEXT NOT NULL,
  slot             INTEGER NOT NULL CHECK (slot IN (1,2)),
  label            TEXT,
  phone_e164       TEXT,
  email            TEXT,
  sms_on           INTEGER NOT NULL DEFAULT 0,
  email_on         INTEGER NOT NULL DEFAULT 1,
  sms_consent_ver  TEXT,                                 -- versioned consent text id, stored with its hash
  sms_consent_hash TEXT,
  sms_consent_at   INTEGER,
  sms_pending_at   INTEGER,                              -- slot 2: confirmation text sent, waiting for YES
  sms_verified_at  INTEGER,
  sms_stopped_at   INTEGER                               -- STOP received; email keeps flowing
);
CREATE UNIQUE INDEX IF NOT EXISTS contacts_slot ON contacts(tag_id, slot);
CREATE INDEX IF NOT EXISTS contacts_phone ON contacts(phone_e164);

CREATE TABLE IF NOT EXISTS scans (
  id              TEXT PRIMARY KEY,
  tag_id          TEXT NOT NULL,
  at              INTEGER NOT NULL,
  burst_id        TEXT,
  kind            TEXT NOT NULL CHECK (kind IN ('scan','location','message')),
  lat             REAL,
  lng             REAL,
  accuracy_m      REAL,
  place_text      TEXT,
  message         TEXT,
  finder_reply    TEXT,                                  -- "how to reach you", optional, finder-typed
  loc_consent_ver TEXT,
  by_owner        INTEGER NOT NULL DEFAULT 0,            -- the signed-in owner's own scan: counted, never alerted
  ip_hash         TEXT,                                  -- salted; set to NULL after 24 h
  keep            INTEGER NOT NULL DEFAULT 0             -- owner pinned it (max 20 per tag)
);
CREATE INDEX IF NOT EXISTS scans_tag_at ON scans(tag_id, at);
CREATE INDEX IF NOT EXISTS scans_at ON scans(at);

CREATE TABLE IF NOT EXISTS alerts (
  id          TEXT PRIMARY KEY,
  scan_id     TEXT,
  tag_id      TEXT NOT NULL,
  contact_id  TEXT,
  channel     TEXT NOT NULL CHECK (channel IN ('email','sms')),
  kind        TEXT NOT NULL DEFAULT 'scan',              -- scan | location | message | test | capped | digest | unclaimed
  status      TEXT NOT NULL CHECK (status IN ('queued','sent','failed','capped')),
  provider_id TEXT,
  error_code  TEXT,                                      -- short code only, never a body, number, or address
  tries       INTEGER NOT NULL DEFAULT 0,
  at          INTEGER NOT NULL,
  last_try_at INTEGER
);
CREATE INDEX IF NOT EXISTS alerts_tag_at ON alerts(tag_id, at);
CREATE INDEX IF NOT EXISTS alerts_status ON alerts(status, at);

CREATE TABLE IF NOT EXISTS sessions (
  id_hash    TEXT PRIMARY KEY,                           -- SHA-256 of the cookie value
  owner_id   TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_exp ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS login_tokens (
  id_hash    TEXT PRIMARY KEY,                           -- SHA-256 of the 32-byte token; the token is never stored
  email      TEXT NOT NULL,
  purpose    TEXT NOT NULL CHECK (purpose IN ('claim','login')),
  tag_id     TEXT,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER
);
CREATE INDEX IF NOT EXISTS login_tokens_exp ON login_tokens(expires_at);

CREATE TABLE IF NOT EXISTS sms_codes (
  contact_id TEXT PRIMARY KEY,
  code_hash  TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  tries      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS counters (
  k          TEXT PRIMARY KEY,
  n          INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS counters_exp ON counters(expires_at);

CREATE TABLE IF NOT EXISTS meta (
  k TEXT PRIMARY KEY,
  v TEXT,
  at INTEGER
);
