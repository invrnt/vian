export const registryMigrations = [`
CREATE TABLE bots (
  id TEXT PRIMARY KEY,
  alias TEXT NOT NULL UNIQUE,
  path TEXT NOT NULL UNIQUE,
  registered_at TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  observed_name TEXT,
  observed_status TEXT
);
`] as const;

export const botMigrations = [`
CREATE TABLE principals (id TEXT PRIMARY KEY, is_admin INTEGER NOT NULL DEFAULT 0 CHECK(is_admin IN (0,1)));
CREATE TABLE actor_bindings (
  gate TEXT NOT NULL, external_id TEXT NOT NULL,
  principal_id TEXT NOT NULL REFERENCES principals(id),
  created_at TEXT NOT NULL, revoked_at TEXT,
  PRIMARY KEY(gate, external_id)
);
CREATE TABLE conversations (
  id TEXT PRIMARY KEY, initiator_id TEXT NOT NULL REFERENCES principals(id),
  active_session_id TEXT, created_at TEXT NOT NULL
);
CREATE TABLE destination_bindings (
  gate TEXT NOT NULL, external_id TEXT NOT NULL, thread_id TEXT NOT NULL DEFAULT '',
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  created_at TEXT NOT NULL, revoked_at TEXT,
  PRIMARY KEY(gate, external_id, thread_id)
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id),
  initiator_id TEXT NOT NULL REFERENCES principals(id), created_at TEXT NOT NULL,
  lease_holder TEXT, lease_expires_at TEXT
);
CREATE TABLE pairing_requests (
  code TEXT PRIMARY KEY, gate TEXT NOT NULL, external_id TEXT NOT NULL,
  expires_at TEXT NOT NULL, used_at TEXT
);
CREATE TABLE events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
  conversation_id TEXT, session_id TEXT, run_id TEXT, principal_id TEXT,
  kind TEXT NOT NULL, at TEXT NOT NULL, payload_json TEXT NOT NULL
);
CREATE INDEX events_session_sequence ON events(session_id, sequence);
CREATE INDEX events_principal_sequence ON events(principal_id, sequence);
CREATE TABLE inbox (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
  gate TEXT NOT NULL, external_event_id TEXT NOT NULL,
  event_json TEXT NOT NULL, accepted_at TEXT NOT NULL,
  message_id TEXT, session_id TEXT REFERENCES sessions(id),
  state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','claimed','consumed')),
  run_id TEXT, UNIQUE(gate, external_event_id)
);
CREATE INDEX inbox_session_state_sequence ON inbox(session_id, state, sequence);
CREATE TABLE reset_barriers (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id),
  actor_id TEXT NOT NULL REFERENCES principals(id), inbox_sequence INTEGER NOT NULL,
  applied_at TEXT
);
CREATE TABLE runs (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id),
  input_id TEXT NOT NULL REFERENCES inbox(id),
  initiator_id TEXT NOT NULL REFERENCES principals(id),
  state TEXT NOT NULL CHECK(state IN ('running','completed','failed','interrupted','cancelled')),
  started_at TEXT NOT NULL, ended_at TEXT
);
CREATE TABLE tool_calls (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id),
  state TEXT NOT NULL CHECK(state IN ('pending','started','succeeded','failed','interrupted')),
  started_at TEXT, ended_at TEXT, audit_json TEXT NOT NULL,
  UNIQUE(run_id, id)
);
CREATE TABLE messages (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id),
  session_id TEXT NOT NULL REFERENCES sessions(id), run_id TEXT,
  role TEXT NOT NULL, message_json TEXT NOT NULL
);
CREATE TABLE outbox (
  id TEXT PRIMARY KEY, message_id TEXT NOT NULL REFERENCES messages(id),
  destination_key TEXT NOT NULL, ordinal INTEGER NOT NULL,
  part_json TEXT NOT NULL, state TEXT NOT NULL,
  attempt INTEGER NOT NULL, next_attempt_at TEXT,
  UNIQUE(message_id, ordinal)
);
CREATE INDEX outbox_destination_order ON outbox(destination_key, message_id, ordinal);
CREATE TABLE summaries (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id),
  text TEXT NOT NULL, through_sequence INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE attachments (
  id TEXT PRIMARY KEY, public_json TEXT NOT NULL, private_path TEXT NOT NULL,
  expires_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'available'
);
CREATE TABLE callback_actions (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id),
  session_id TEXT NOT NULL REFERENCES sessions(id), principal_id TEXT REFERENCES principals(id),
  destination_key TEXT NOT NULL, label TEXT NOT NULL, value_json TEXT NOT NULL,
  expires_at TEXT NOT NULL, consumed_at TEXT
);
`, `
ALTER TABLE attachments ADD COLUMN sha256 TEXT;
ALTER TABLE attachments ADD COLUMN origin TEXT;
ALTER TABLE attachments ADD COLUMN created_at TEXT;
`, `
CREATE TABLE delivery_order (sequence INTEGER PRIMARY KEY AUTOINCREMENT);
ALTER TABLE outbox ADD COLUMN delivery_sequence INTEGER;
INSERT INTO delivery_order(sequence) SELECT rowid FROM outbox;
UPDATE outbox SET delivery_sequence=rowid;
CREATE TABLE pairing_notices (
  id TEXT PRIMARY KEY, gate TEXT NOT NULL, external_event_id TEXT NOT NULL,
  destination_key TEXT NOT NULL, code TEXT NOT NULL REFERENCES pairing_requests(code),
  part_json TEXT NOT NULL, state TEXT NOT NULL, attempt INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT, created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
  delivery_sequence INTEGER NOT NULL REFERENCES delivery_order(sequence),
  UNIQUE(gate,external_event_id)
);
CREATE INDEX pairing_notices_destination_order ON pairing_notices(destination_key,delivery_sequence);
`, `
CREATE TABLE owner_verifications (
  code_hash TEXT PRIMARY KEY, principal_id TEXT NOT NULL,
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
  used_at TEXT, actor_id TEXT
);
CREATE INDEX owner_verifications_active ON owner_verifications(expires_at, used_at);
CREATE TABLE owner_verification_attempts (
  actor_id TEXT PRIMARY KEY, window_start TEXT NOT NULL, count INTEGER NOT NULL
);
CREATE TABLE owner_verification_events (
  external_event_id TEXT PRIMARY KEY, received_at TEXT NOT NULL
);
CREATE INDEX owner_verification_events_time ON owner_verification_events(received_at);
`] as const;
