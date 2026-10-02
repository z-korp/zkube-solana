-- The public read model and the keeper's ledger, in one D1 database.
-- Apply to a new database: wrangler d1 execute <database> --remote --file services/worker/schema.sql
-- It creates tables only. No deployment exists; a later change to a table
-- that already holds rows needs its own migration.
-- Nothing here is an authority. The program's boards are the leaderboard of
-- record; these rows are hints and history, re-derivable from the ledger.

-- Every transaction already seen, by webhook or by catch-up. A transaction
-- of the program this model could not interpret is kept as unreadable: the
-- walk moves on, and the model reports itself incomplete while one remains.
CREATE TABLE IF NOT EXISTS transactions (
  signature TEXT PRIMARY KEY,
  slot INTEGER NOT NULL,
  unreadable INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS transactions_unreadable ON transactions (unreadable) WHERE unreadable = 1;

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

-- Dailies whose finalization was seen, by address: their standings no longer
-- change. A Daily is finalized whenever its last run resolves, however late.
CREATE TABLE IF NOT EXISTS finalized_dailies (
  daily TEXT PRIMARY KEY,
  slot INTEGER NOT NULL
);

-- Discovery hints for the keeper: daily player accounts and runs in flight,
-- each under its Daily's address. A hint only names an address to read; the
-- keeper verifies each on chain and checks the set against the Daily's own
-- count of unresolved entries.
CREATE TABLE IF NOT EXISTS daily_players (
  address TEXT PRIMARY KEY,
  daily TEXT NOT NULL,
  owner TEXT NOT NULL,
  entered_slot INTEGER,
  closed_slot INTEGER
);
CREATE INDEX IF NOT EXISTS daily_players_open ON daily_players (daily) WHERE closed_slot IS NULL;
CREATE TABLE IF NOT EXISTS runs (
  address TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  daily TEXT NOT NULL,
  entered_slot INTEGER,
  consumed_slot INTEGER
);
CREATE INDEX IF NOT EXISTS runs_open ON runs (daily) WHERE consumed_slot IS NULL;

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

-- Every keeper write: its spend is reserved here before it is relayed. A
-- row stays reserved, and keeps counting against the spend ceiling and the
-- wallet's reserve floor, until the cluster reports its outcome or its
-- blockhash is verifiably past: confirmed, failed (it landed and failed) or
-- expired (it can no longer land).
CREATE TABLE IF NOT EXISTS keeper_writes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pass TEXT NOT NULL,
  operation TEXT NOT NULL,
  reserved_lamports INTEGER NOT NULL,
  payer_lamports INTEGER NOT NULL,
  signature TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  last_valid_block_height INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('reserved', 'confirmed', 'failed', 'expired')),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS keeper_writes_open ON keeper_writes (id) WHERE state = 'reserved';

-- When the keeper last discovered by scanning the chain rather than from hints.
CREATE TABLE IF NOT EXISTS keeper_scan (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  scanned_at INTEGER NOT NULL
);

-- The write switch. Absent, or naming another release than the one running,
-- the keeper only plans. The owner sets it by hand after reviewing a
-- read-only pass; no Worker code writes this table.
CREATE TABLE IF NOT EXISTS keeper_approval (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  fingerprint TEXT NOT NULL
);
