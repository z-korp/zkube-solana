# zKube MagicBlock Devnet Architecture

This is the repository's authoritative MagicBlock implementation guide. It
consolidates the patterns proven in `/home/djizus/cycling-sim`, adapted to
zKube's turn-based campaign and Daily Arena. If code, another document, or an
old command conflicts with this file, stop and reconcile the difference before
sending a transaction.

## Non-negotiable target

- Cluster: Solana Devnet only during Iteration 1.
- Base RPC: `https://rpc.magicblock.app/devnet`.
- Router: `https://devnet-router.magicblock.app/`.
- Program: `5NfTo5ML4UTa6ep4x9d616fyWQYM3CTcpcE5V9P7YUbA`.
- The client asks the Router for the closest validator before delegation.
- After delegation, the client resolves the actual ER from
  `getDelegationStatus` for the delegated account. It never assumes that the
  requested validator is the final execution endpoint.
- Regional ER URLs are not hardcoded into gameplay or proof runners.
- All Solana CLI invocations are prefixed with `NO_DNA=1`.
- Mainnet and localhost are outside the current deployment path.

## Player identity and fee model

zKube does not require Phantom or any injected browser wallet.

1. On first launch, the client silently generates a Solana keypair.
2. That embedded identity is stable across reloads and owns the player's
   campaign, progress, Daily entries, receipts, and assets.
3. The app signs owner-authorized transactions locally without popups.
4. The stateless paymaster supplies base transaction fees and approved account
   rent. Gameplay should work while the player's SOL balance is zero.
5. Settings exposes a zKube Vault: deposit address, SOL/USDC balances,
   simulation-first SOL/USDC withdrawal, Recovery Code export, and Recovery
   Code restore.
6. A player can send SOL or canonical Devnet USDC to the deposit address from
   any wallet or exchange when paid content requires funds. The external wallet
   is never connected to zKube.

The embedded secret currently follows cycling-sim's device-local storage
model. The Recovery Code is the only cross-device recovery mechanism. The UI
must warn users that anyone holding it controls the identity. Application logs,
analytics, proof artifacts, and server requests must never contain it.

The paymaster is not a custody service and never holds player keys. It validates
the complete submitted message, permits only known zKube/MagicBlock instruction
shapes, enforces signer and writable-account constraints, simulates before
submission, and refuses arbitrary transfers. Quotas and sponsorship counters
that must survive restarts belong on-chain; Redis or another durable backend is
not part of the architecture.

## Base layer and ER boundary

Solana base is the durable authority for:

- protocol configuration and governance;
- campaign and progress catalogs;
- player campaign/progress accounts;
- Daily challenge definitions, accounting, leaderboards, and prize vaults;
- treasury, reward reserve, paymaster reserve, payment custody, and yield
  policy;
- finalized run receipts and copied-back run state.

The Ephemeral Rollup is used only for the latency-sensitive active run:

- authoritative grid and score state;
- player moves and bonus application;
- fresh VRF row requests and callbacks;
- sealing the final score before copyback.

Token accounts, treasury accounts, player USDC accounts, prize liabilities,
catalogs, and governance state are never delegated. Prize settlement and token
movement happen against durable base accounts after the run result is copied
back and validated.

## Complete zKube run lifecycle

### 1. Prepare on base

- Load and validate the live protocol, campaign catalog, player state, and mode
  prerequisites from the base RPC.
- Generate a fresh per-run session keypair. Persist only the minimum recovery
  marker required to resume a run after refresh.
- Create the ActiveRun shell and receipt/session authorization accounts through
  sponsored base transactions.
- Derive every game PDA from the program's canonical helpers.
- Derive MagicBlock delegation buffer, record, and metadata PDAs with
  `@magicblock-labs/ephemeral-rollups-sdk`; do not duplicate SDK seeds.
- Ask the Router for the closest available validator and include that validator
  in the delegation request.

### 2. Delegate on base

- Validate the ActiveRun owner, player, run id, mode, and lifecycle before
  delegation.
- Submit delegation through the base RPC.
- Keep base funding/account creation separate from delegation. This makes
  failures and retries observable and avoids ambiguous partially prepared runs.
- Record the base signature and requested validator in the run marker/proof.

### 3. Resolve the actual ER

- Poll the Router's `getDelegationStatus` for the ActiveRun.
- Validate the delegation record owner before decoding it.
- Treat account-not-found, pending delegation, pending owner transition, stale
  blockhash, and short cloner lag as bounded transient failures.
- Retry with bounded exponential backoff. Do not retry deterministic program
  errors, signer failures, invalid owners, or invalid account layouts.
- Use the Router-returned `fqdn` as the ER RPC endpoint.
- Fetch the ActiveRun from that endpoint and require it to be owned by the zKube
  program before decoding.

Selecting a nearby validator and resolving the delegated account are separate
steps. Both are required, exactly as in cycling-sim.

### 4. Play on the ER

- Send interactive instructions only to the Router-resolved ER.
- The owner authorizes the run once; the short-lived session key signs gameplay
  instructions after authorization.
- Request fresh MagicBlock VRF for every generated row. Never recycle a VRF
  account or use client randomness for authoritative gameplay.
- Validate the oracle queue, scoped identity/callback authority, ActiveRun
  address, request counter, and callback freshness on-chain.
- The client renders decoded account state. It does not invent authoritative
  rows, scores, lifecycle transitions, or results.
- Persist enough session/run routing data to resume, but re-resolve the ER
  through the Router after a refresh or routing failure.

### 5. Seal, commit, and undelegate

- Seal the terminal run on the ER before settlement.
- Base-only Magic Action targets must be read-only in the outer ER commit
  instruction. The delegated `ActiveRun`, payer, and Magic context are writable
  there; receipt/profile/campaign or Daily targets become writable only in the
  base-layer `CallHandler`. Marking a base-only target writable in the outer
  instruction makes the ER reject the transaction with
  `InvalidWritableAccount` before the Magic Action executes.
- Commit and undelegate through the ER. The copyback must return the ActiveRun
  to the zKube program on base.
- Record the ER signature and the MagicBlock base commitment/copyback evidence.
- Poll base until the copied-back account exists, has the expected owner,
  discriminator, player, run id, mode, lifecycle, and result hash.
- Create or validate the durable receipt idempotently. Repeated settlement for
  the same run must not double-award Stars, Daily score, rank, or prize rights.

### 6. Clean up only after proof

- Never close session, ActiveRun, or auxiliary accounts merely because the ER
  transaction returned success.
- Cleanup is allowed only after base copyback and durable receipt/postcondition
  checks pass.
- If execution stops after commit but before cleanup, resume from the persisted
  marker and verify base state again. Leaving recoverable rent temporarily is
  safer than deleting evidence.

## VRF rules

- Every authoritative row uses a fresh request.
- The callback is accepted only from the expected MagicBlock VRF identity.
- Request counters bind callbacks to the current pending request.
- Randomness is domain-separated by program, run, row/request counter, and
  relevant mode data before deriving game values.
- Client fallback randomness is forbidden for rewards-bearing play.
- A timeout is a visible recoverable state, not permission to fabricate a row.

## Account and decoding rules

All RPC data is untrusted.

- Check account existence, owner, data length, and discriminator before
  decoding.
- Check embedded addresses and authorities after decoding.
- Reject substituted delegation records, ER accounts, token programs, mints,
  vaults, and callbacks.
- Canonical Devnet USDC is
  `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`, has six decimals, and uses
  the legacy SPL Token program
  `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`.
- Generated Anchor IDL and instruction account-meta drift checks must pass
  before a live proof.

## Deployment and transaction discipline

Every deployment/bootstrap/proof runner is dry-run-first and fail-closed:

1. Verify the Devnet genesis hash.
2. Verify the executable program, ProgramData address, deployed byte hash,
   loader ownership, and upgrade authority expectations.
3. Verify every signer public key without exposing secret paths in a public
   artifact.
4. Verify prerequisites, account owners, rent, balances, token mint/program,
   and decimal precision.
5. Build the exact instruction messages and fingerprint program ids, account
   metas, data hashes, funding, policies, and signer roles.
6. Simulate every unsigned transaction against the target RPC.
7. Present cluster, fee payer, recipients/accounts, token/SOL movement, maximum
   spend, and fingerprint for explicit approval.
8. Require the exact approved fingerprint at execution time.
9. Immediately before each send, sign and simulate with signature verification.
10. Keep preflight enabled for normal gameplay/bootstrap sends and verify
    postconditions after confirmation.
11. Write sanitized proof artifacts containing signatures and decoded public
    evidence, never key material.

Program upgrades additionally verify that the built SBF fits the live program
allocation. If it does not, extend the program first under its own approval.
Failed deploys can strand rent in upgrade buffers; inspect and reclaim owned
buffers before seeking new funding. A program deployment, custody bootstrap,
protocol initialization, catalog publication, and live gameplay proof are
separate approval scopes.

## Devnet custody deployed on 2026-07-11

Custody fingerprint `08063b99625c0a82` completed with six confirmed
transactions:

- team USDC vault: `8nBxUByKv1PiC7GNzxZYkCBXeLJhg2rVqpobvQeLFivG`;
- paymaster USDC vault: `5HsAQ4ZZ3kExamfCiap6mT88DAmkVW8J7v7s5rBpga8Y`;
- treasury USDC vault: `34gQiFnfFnfav5VmzFg15EqoEBtW2oi25wVNv36TsNAH`;
- reward USDC vault: `FpRj7daRRbcZmGLMHRHpP6qnXuGu8XKABuiNtuBs1oTV`;
- payment USDC vault: `6x2Qmn4zkCkQa5ZvDhRpHMXPUnRrNoN5k8MdcJKbXgyD`;
- paymaster: `CNhMPp5p3ViMEzBpeRRjXX1G672rwxHkyNG4gVRN7SgY`, funded with `0.1 SOL`.

The five vaults were verified as empty 165-byte canonical-USDC accounts owned
by the legacy SPL Token program. The sanitized execution proof is
`artifacts/devnet-bootstrap.custody.proof.json`.

Protocol fingerprint `1f6cd8031b2ec13a` completed at slot `475566455`. The
protocol, treasury ledger, and disabled yield-policy PDAs are owned by zKube
with their expected layouts. Its sanitized execution proof is
`artifacts/devnet-bootstrap.protocol.proof.json`.

Catalog fingerprint `d3d34aa2e7528cad` completed in eleven confirmed
transactions. Progress v1 and all ten content-v1 maps decode to their canonical
zKube rules and are owned by the zKube program. Its sanitized execution proof
is `artifacts/devnet-bootstrap.catalogs.proof.json`.

## Required proof and monitoring evidence

A complete Iteration 1 proof records:

- base prepare and delegation signatures;
- requested validator and Router-resolved ER endpoint/identity;
- delegation record owner and final ActiveRun owner;
- VRF request/callback counters and row progression;
- ER gameplay, seal, commit, and undelegate signatures;
- base copyback slot, receipt/result hash, and decoded postconditions;
- cleanup signature and reclaimed account state, if cleanup is requested;
- paymaster decisions, sponsorship counters, fee spend, and rejection reasons;
- client resume behavior across a refresh.

Operational alerts should cover Router resolution failures, cloner lag beyond
the retry budget, VRF timeouts, owner/discriminator mismatches, copyback delays,
paymaster reserve thresholds, Daily prize liabilities, unclaimed prizes nearing
the three-month forfeiture boundary, and any treasury/yield invariant breach.

## Source hierarchy

When changing this integration, consult in this order:

1. zKube program invariants and this document;
2. `/home/djizus/cycling-sim/docs/magicblock-focg.md`;
3. `/home/djizus/cycling-sim/docs/devnet-deploy-runbook.md`;
4. cycling-sim's Router, chain flow, embedded identity, paymaster, and smoke
   runner implementations;
5. the installed official MagicBlock development skill and pinned SDK source.

Do not copy a cycling-specific race mechanic blindly. Copy its infrastructure
invariants: routing, account ownership, session authorization, paymaster
validation, VRF authority, settlement idempotency, proof artifacts, and staged
approval discipline.
