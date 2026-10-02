-- The public read model and the keeper's ledger, in one D1 database.
-- Apply once: wrangler d1 execute <database> --remote --file services/worker/schema.sql
-- Nothing here is an authority. The program's boards are the leaderboard of
-- record; these rows are hints and history, re-derivable from the ledger.

-- Every transaction already ingested, by webhook or by catch-up.
CREATE TABLE IF NOT EXISTS transactions (
  signature TEXT PRIMARY KEY,
  slot INTEGER NOT NULL
);

-- Every scored run, from the RunScored log. Metrics are stored as fixed-width
-- decimal text so they order correctly beyond 53 bits; owner_hex orders
-- wallets by their bytes, as the program does.
CREATE TABLE IF NOT EXISTS results (
  day_id INTEGER NOT NULL,
  owner TEXT NOT NULL,
  owner_hex TEXT NOT NULL,
  run_id TEXT NOT NULL,
  score_key TEXT NOT NULL,
  objective_key TEXT NOT NULL,
  finalized_at INTEGER NOT NULL,
  replay_hash TEXT NOT NULL,
  signature TEXT NOT NULL,
  slot INTEGER NOT NULL,
  PRIMARY KEY (day_id, owner, run_id)
);
CREATE INDEX IF NOT EXISTS results_score ON results (day_id, score_key DESC, finalized_at, owner_hex);
CREATE INDEX IF NOT EXISTS results_objective ON results (day_id, objective_key DESC, finalized_at, owner_hex);

-- Days whose finalization was seen: their standings no longer change.
CREATE TABLE IF NOT EXISTS finalized_days (
  day_id INTEGER PRIMARY KEY,
  slot INTEGER NOT NULL
);

-- Discovery hints for the keeper: daily player accounts and runs in flight.
-- A hint only names an address to read; the keeper verifies each on chain.
CREATE TABLE IF NOT EXISTS daily_players (
  address TEXT PRIMARY KEY,
  day_id INTEGER NOT NULL,
  owner TEXT NOT NULL,
  entered_slot INTEGER,
  closed_slot INTEGER
);
CREATE INDEX IF NOT EXISTS daily_players_open ON daily_players (day_id) WHERE closed_slot IS NULL;
CREATE TABLE IF NOT EXISTS runs (
  address TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  day_id INTEGER NOT NULL,
  entered_slot INTEGER,
  consumed_slot INTEGER
);
CREATE INDEX IF NOT EXISTS runs_open ON runs (day_id) WHERE consumed_slot IS NULL;

-- Catch-up progress over the program's signatures. `tip` is the newest
-- signature below which everything is ingested. While a page of history is
-- still being walked, `gap_before`/`gap_tip` are set and the model is
-- incomplete.
CREATE TABLE IF NOT EXISTS sync (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  tip TEXT,
  gap_before TEXT,
  gap_tip TEXT,
  caught_up_at INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO sync (id) VALUES (1);

-- One keeper pass at a time.
CREATE TABLE IF NOT EXISTS keeper_lease (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  holder TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Every keeper write: its spend is reserved here before it is relayed, and
-- the row is settled afterwards. A row still reserved was sent with an
-- unknown outcome and keeps counting against the spend ceiling.
CREATE TABLE IF NOT EXISTS keeper_writes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pass TEXT NOT NULL,
  operation TEXT NOT NULL,
  reserved_lamports INTEGER NOT NULL,
  signature TEXT,
  state TEXT NOT NULL CHECK (state IN ('reserved', 'confirmed', 'failed')),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS keeper_writes_open ON keeper_writes (created_at) WHERE state = 'reserved';

-- The write switch. Absent, or naming another release than the one running,
-- the keeper only plans. The owner sets it by hand after reviewing a
-- read-only pass; no Worker code writes this table.
CREATE TABLE IF NOT EXISTS keeper_approval (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  fingerprint TEXT NOT NULL
);
