# Agent working rules — zkube-solana

These rules govern coding agents and operators in this repository. They do not
add approval prompts to the shipped product.

`README.md` is the public product and contributor document. Agent rules, the
protocol reference below, and operator procedures live here. Implementation
detail belongs in code comments next to the code. Do not add new Markdown
documents, and do not move approval policy or operator runbooks into `README.md`.

## Product truth

- zKube v4 targets the Solana dApp Store and Seeker. Google Play is out.
- The connected Solana address is the player identity. There are no embedded
  wallets, recovery codes, deposits, soft currencies, shops, passes, or prize
  claims.
- Campaign is free. Practice preparation is retired; existing legacy Practice
  runs retain recovery, settlement, and expiry only. Arcade is immediately
  available; Campaign never gates paid play.
- Every ranked Arena run requires a separate owner-signed exact 0.01 SOL entry.
  Device sessions can never authorize that transfer.
- Entries split 60% to the following Daily, 20% to the following Weekly, 10%
  to the following Monday-aligned 28-day Season, and 10% to operator revenue.
  Daily and Season pay 45/25/15/10/5; each of three Weekly skill boards pays
  60/25/15. All transfers floor to 0.001 SOL and dust rolls forward.
- Settlement is push-only, may be late, and is never cancelled. Empty pots roll
  forward; profile synchronization never gates money.
- Paid entries close at 23:45 UTC. At 23:59 UTC a
  run with an accepted action scores its last committed state; an untouched or
  unrecoverable run expires and can never score late.
- Campaign changes only the compact lifetime-best star record. Arcade owns
  lifetime paid entries and Daily/Weekly/Season prize records. There is no XP,
  quest, achievement, title, rating, crest, or general gameplay progression;
  neither mode grants SOL, entries, prize eligibility, or mint odds.
- The owner funds the shared System-owned zero-data player funding PDA and the
  recyclable device fee allowance. A separately seeded System-owned zero-data
  cadence funding PDA recycles Daily/Weekly/Season account rent after finalized
  results are durably archived. Funding PDAs sign only narrow self-CPI rent
  paths; there is no Kora or generic paymaster.
- Separate durable Campaign and Arcade run slots prevent overlap within either
  mode and support cross-device recovery while allowing one run of each. They
  share one monotonic run-ID sequence. Base, Router, and resolved ER
  connections remain separate; resolve ER placement with
  `getDelegationStatus`.
- Fly runs only the independently funded Daily/Weekly/Season keeper. The web
  client is static PWA/TWA code with no server signer.
- The cadence-archive upgrade is deployed on Devnet only. Its deployment and
  observed recovery state do not imply Mainnet readiness; Mainnet requires
  counsel, economic, and distribution review.
- Fresh protocol initialization is paused. The approved schema-v11 recovery
  completed and v11 keeper writes are enabled on Devnet under the approved
  recurring authority. Initialization may seed only the first Daily, Weekly,
  and Season. Separately approved authority top-ups may add any positive
  lamport amount only to the canonical current or following Daily, Weekly, or
  Season and must update its accounted seeded balance. Recovery does not
  authorize reinitialization, deployment, funding, governance, or Mainnet
  actions.

## Transaction policy

- The Devnet deployment fee payer is the read-only keypair at
  `/home/djizus/cycling-sim/.devnet/deployer.json`, public key
  `7WFy4QkiUx9GZHkVz3wdWJbdMgMf6gtK8JnbWDYqZDRA`. Never copy, modify, expose,
  delete, or commit it.
- Never sign or send a transaction without explicit approval for exact
  instructions, accounts, signers, cluster, and spend. A short `I approve` is
  valid only when it directly answers the immediately preceding single
  enumerated bundle and no detail has drifted.
- The recurring keeper exception requires a separately approved fingerprinted
  release enforcing Devnet genesis, deployed ProgramData hash, exact signer,
  current/recent cadence PDAs, canonical instruction allowlist, at most eight
  writes and two expired-session closures, 0.1 SOL simulated spend per pass,
  and a 0.1 SOL reserve floor.
- Governance, initial competition seeding, manual reimbursement, terms/rules
  changes, funding, withdrawals, deployment, initial keeper enablement, and all
  mainnet actions remain outside recurring authority and require exact
  approval.
- Automated verification is offline. Prefix every Solana, Anchor, and pnpm
  chain command with `NO_DNA=1`.
- Never expose signer bytes, seed phrases, `.env` contents, keeper secrets,
  Android credentials, or the ignored v4 program keypair.

## Worktree and chain-data discipline

- Preserve unrelated and in-flight changes. Never use destructive restoration
  or blanket cleanup. Use `apply_patch` for edits and `rg` for discovery.
- `/home/djizus/zkube` and `/home/djizus/cycling-sim` are read-only references.
- Treat RPC data as untrusted: verify cluster genesis, owner, bounded length,
  discriminator, PDA seeds, and account relationships before decoding.
- A player funding PDA may never gain a generic transfer or arbitrary
  instruction-forwarding path.
- Preserve `ActiveRun` until copied-back terminal state is consumed, or until a
  deterministic expiry resolution and orphan reservation prevent late scoring
  and permit safe cleanup.
- Production Vercel publishing is Git-driven only from
  `z-korp/zkube-solana:main` to project
  `prj_5kqIxlxgXHXGhldje8unic9h3qYA` under `z-labs`. Never deploy zKube under
  JCN DATA; its temporary exception is Fly Devnet keeper hosting only.

## Validation gates

Static GitHub validation is manual-dispatch-only; run these gates locally for
steady-state validation without billed hosted compute.

```bash
NO_DNA=1 ./validate.sh program
cd services
NO_DNA=1 pnpm install --frozen-lockfile
NO_DNA=1 pnpm run build
NO_DNA=1 pnpm test
cd ../client
NO_DNA=1 pnpm idl:check
NO_DNA=1 pnpm core:wasm:check
NO_DNA=1 pnpm exec tsc -b --pretty false
NO_DNA=1 pnpm lint
NO_DNA=1 pnpm exec vitest run
NO_DNA=1 pnpm build
```

Start with `README.md`, then inspect `state`/`instructions` for contract work,
`services` for keeper work, and client chain/platform boundaries only when the
client is explicitly in scope. Never infer deployed state from source.

## Protocol reference

`README.md` states the product-level rules. This section holds the exact
behaviour agents must preserve.

### Accounting

Each paid entry transfers exactly 10,000,000 lamports: 6,000,000 to the
following Daily, 2,000,000 to the following Weekly, 1,000,000 to the following
Season, and 1,000,000 to operator revenue. Entries never increase their own
active pot. Every calculated transfer rounds down to 1,000,000 lamports;
division residue, rounding dust, and empty allocations roll into the following
competition of the same type. When fewer winners qualify, the occupied payout
weights are renormalized before rounding. The invariant is
`entries_scored + entries_expired == entries_paid`.

Settlement is atomic, push-only, may be late, and is never cancelled. A paid
entry has no refund or claim path. Operator withdrawals are governance actions
and cannot spend accounted prize balances.

All pots are prepaid. Initialization may seed only the first Daily, Weekly, and
Season with values from a separately approved release bundle; every later pot is
funded automatically from predecessor entries plus predecessor rollover.

A separately approved manual top-up may add any positive lamport amount to the
canonical current or following Daily, Weekly, or Season while that pool is live.
The pool kind and cadence ID select an exact PDA-specific instruction, and the
transfer increments the same on-chain seeded-funds ledger settlement reads.
A direct wallet transfer to a pool PDA is not prize funding — it does not touch
that ledger. The keeper has no authority to invoke this path.

Devnet may launch partway through a calendar Weekly or Season. The first seeded
Daily starts on the launch day; the first Weekly and Season keep canonical
closing timestamps but qualify only finalized Dailies from the launch day
onward. That qualification start is immutable and settlement validates every
included Daily on-chain. Successors start at normal Monday boundaries with full
calendar periods.

### Competitions

The next preactivated Daily opens at 00:00 even while the preceding payout pass
finishes, so settlement never creates a playable-day gap. The keeper prepares
successor accounts before entries open, so the client can show the active
guaranteed pot and following-period funding separately.

Daily keeps one best score per wallet while retaining attempt counts. Each
Monday-aligned Weekly selects one deterministic metric per category — combo
(maximum combo, combo-scoring actions, or combo-derived score); single action
(highest action score, most lines, or most blocks destroyed); full run (total
lines, total blocks destroyed, or perfect clears) — divides its pot equally
across the three boards, and a wallet may win more than one board.

A Season is a Monday-aligned 28-day period. Each finalized Daily contributes one
band result per wallet and the best 20 count:

| Daily band | Season points |
| --- | ---: |
| Top 1%, capped at rank 3 | 100 |
| Top 5%, capped at rank 10 | 60 |
| Top 10%, capped at rank 20 | 30 |
| Top 25%, capped at rank 50 | 10 |
| Another scoreable result | 2 |

Leaderboards order by primary score or metric descending, then earliest
finalized achievement, then wallet bytes.

### Campaign progression

Ten zones of ten levels: 100 levels, 300 stars, stored as one packed 25-byte
two-bits-per-level array. Zone unlocked, cleared, perfected, total stars, and
badges are derived views, never separately stored progression.

Only Zone 1 Level 1 starts playable. Within a zone each later level requires at
least one star on the preceding level; the first level of a later zone requires
at least one star on the preceding zone's guardian, Level 10. Completed levels
stay replayable and a level's best one-to-three-star result can only increase. A
guardian emblem unlocks with its guardian and renders gold at 30/30 zone stars.

Campaign uses the same engine and generated catalog as Arcade but a separate
progression boundary: completing Campaign content may only improve the packed
star array.

### Replay and determinism

`zkube-core` is the deterministic source for grid state, blocks, mutators,
scoring, pressure, metrics, period math, payout math, canonical encoding, and
the replay commitment schedule. Native Rust, WASM, and the Solana program must
pass the same committed golden vectors before an ABI is releasable.

Replay v2 binds the chain domain, challenge, rules hash, player, run ID, and
mode, then folds ordered VRF, action, bonus, abandon, and deadline events with
SHA-256. Permanent board rows retain the qualifying replay commitment; move
lists may stay off-chain and be independently recomputed.

After a perfect clear, one domain-separated VRF output deterministically derives
both the one-row board reseed and the next visible preview. The committed
continuation vector prevents a run stranded between two oracle requests or
accepting a stale move without a preview.

At the run deadline the resolved ER freezes the last fully accepted state and
adds a replay deadline event. A run with at least one accepted action is scored
from that partial state; an untouched run expires without a leaderboard row.
Pending or late VRF output is ignored, and expired or orphaned state can never
become scoreable later.

### Competitive profile

Player state keeps lifetime paid entries and one compact Daily, Weekly, and
Season record. Each record stores best payout-bearing rank, podiums, wins, and
pushed rewards in lamports. A non-paying leaderboard place stays visible on the
period board but is not a profile best rank, so Daily and Season profile ranks
cover only the top five; each Weekly skill board covers its own top three, and
Weekly podiums and wins count the three boards independently. Aggregate wins and
rewards are display-time sums.

The featured emblem is owner- or device-session-selectable. ID 0 automatically
chooses the strongest unlocked emblem; IDs 1–10 are zone guardians, 11 is Realm
Conqueror for all ten guardians, and 12 is World Perfect for 300/300 stars.
Emblems are identity display only with no monetary effect.

Payouts are pushed before profile metadata synchronizes. Separate permissionless
Daily, Weekly, and Season profile-sync instructions recompute the exact
already-pushed payout from finalized boards and ledgers, then use per-period
winner-position bitmasks for idempotence. A missing or failed profile sync can
never delay, cancel, repeat, or affect a SOL transfer.

### Runtime boundaries

| Boundary | Responsibility | Authority and funding |
| --- | --- | --- |
| Owner wallet | Durable identity and paid entry | Signs every 0.01 SOL entry |
| Device session | Approximately seven days of safe gameplay | Never signs entry payment |
| Player funding PDA | Narrow reusable rent float | Owner-funded; self-CPI wrappers only |
| Cadence funding PDA | Recyclable Daily/Weekly/Season rent float | Separately seeded; narrow self-CPI preparation only |
| Arcade archive PDA | Rolling finalized-result commitments | Program-derived append-only roots |
| MagicBlock ER | Active gameplay and per-row VRF | Router-resolved validator |
| Solana program | Campaign stars, competitive records, accounting, boards, settlement | Base-layer authority |
| Fly keeper | Period preparation, recovery, rollup, settlement, cleanup | Independent bounded signer |
| Static PWA/TWA | Wallet, Campaign, and Arcade UI | No server signer or paymaster |

The player funding PDA is System-owned with zero data and can fund only the rent
paths named by exact zKube self-CPI wrappers. It is not a wallet and cannot
forward arbitrary instructions. The cadence funding PDA follows the same pattern
but is usable only by the exact Daily, Weekly, and Season preparation wrappers.

Client-assembled owner transactions pin a deterministic 400,000-compute-unit
limit and 1,000-micro-lamport unit price before wallet approval, so the maximum
priority fee is 400 lamports. Fully specifying both fields prevents wallet-side
priority-fee message enhancement while retaining the exact signed-message check:
changed instructions, accounts, blockhashes, signer roles, or existing partial
signatures are rejected.

Solana Base, the MagicBlock Router, and the Router-resolved ER are separate
connections. Delegation placement resolves through `getDelegationStatus`;
regional ER endpoints are never hardcoded. PlayerState v3 has one durable
Campaign run slot and one durable Arcade run slot, so one run of each may coexist
while overlap within either mode is rejected across devices. Both slots allocate
from one monotonic run-ID sequence. A separate Arcade orphan reservation prevents
an unreachable delegated run from racing a replacement. The byte-compatible v2
migration moves a legacy shared pointer into the slot selected by its stored
immutable mode.

The program pins `ephemeral-rollups-sdk` 0.16.2 or newer. Its generated
undelegation callback must constrain the canonical `undelegate-buffer` PDA and
the System program; the committed IDL regression test rejects the unsafe older
`#[ephemeral]` expansion.

### Archival

Finalized cadence accounts close back to the cadence funding PDA only after
winner profile synchronization and every required rollup completes. Before the
on-chain account is committed and closed, the Devnet keeper atomically writes and
re-reads the complete canonical result JSON on its persistent Fly volume. The
small program-owned Arcade archive then advances one sequential rolling
commitment per Daily, Weekly, and Season. Devnet volume storage is a recovery
aid, not the Mainnet durability design; Mainnet requires replicated public
archive storage.

Archive contract v1 files remain append-only and are never rewritten. New files
use contract v2: `resultDataBase64` carries the exact immutable Borsh result
projection committed by `resultHash` and the rolling root, while full raw account
bytes remain point-in-time evidence. Closure reprojects both v1 and v2 evidence
through the checked-in IDL and verifies the stored account, cadence, program,
result hash, root, and immutable projection exactly. It does not require current
raw-byte equality after permitted metadata changes such as winner profile
synchronization. A missing or invalid committed file is never re-materialized;
that cadence archive plan is quarantined while independent keeper plans continue.

### Keeper safety

The keeper validates cluster genesis, program and ProgramData identity, account
owner, bounded length, discriminator, version, PDA, and stored account
relationships before decoding or planning a write. It reconciles:

- current and following Daily, Weekly, and Season preparation;
- terminal or deadline Arena, Practice, and Campaign runs;
- deterministic expiry and orphan recovery;
- Daily-to-Season rollup and sealing;
- Daily, Weekly, and Season push settlement and rollover;
- post-settlement Daily, Weekly, and Season profile synchronization;
- full canonical cadence snapshots, sequential on-chain archive commitments,
  and safe cadence-account closure back to the cadence funding PDA;
- resolved run and expired session cleanup;
- bounded post-rollup participant-account closure, with rent recycled only to
  the canonical player funding PDA.

The recurring signer cannot deploy, initialize, seed pots, change rules,
withdraw revenue, reimburse an entry, invoke a swap, or target mainnet. A
write-enabled release is pinned to Devnet genesis, deployed ProgramData hash,
program ID, keeper signer, image digest, rules/replay/schema/IDL hashes,
instruction allowlist, eight-write limit, two-session cleanup limit, 0.1 SOL
simulated spend ceiling, a separate two-participant-account closure limit, and
a 0.1 SOL keeper reserve floor.

Keeper release-policy schema v11 fingerprints supported archive contracts
`[1,2]` and the keeper's 10,240-byte fail-closed cadence-result encoding bound.
It requires the Daily archive checkpoint to cover a Weekly's final qualified day
before planning settlement. It quarantines a typed per-cadence
archive-integrity failure without blocking an independent Daily, Weekly, Season,
or Campaign plan. Global chain readiness, policy, materialization, storage
configuration, and release errors remain fatal. A preparation/integrity failure
or archive-transaction failure suppresses only the same cadence's profile sync,
cadence close, and participant cleanup writes for that pass. Quarantined and
suppressed plans consume neither the eight-write window nor its
session/participant closure quotas, so later eligible recovery and
unrelated-cadence work backfills the same pass. The enforced cadence ordering is
finalize, Daily-to-Season rollup, seal, archive, profile sync, then close.

## Operator procedures

Every procedure here is approval-gated by the transaction policy above. The
canonical deployed binding is committed at `client/deployment/devnet-v4.json`
(manifest schema v5); read it rather than restating live values here. Program
`Dz9RaTXpp4vadhBS6oT3RPLjqTT4M4RVwfpowjumSJyd` with ProgramData
`2RAkctsFpaHEJZcF5337G3uAkXUsj1djfnLtDrjBM3qS` is the only v4 target. The
retired v3 address `Apyuy9VZvg7DLcQhe6KGv3sw2MNzriMjtCx2q7zac1QR` is a legacy
artifact and its approvals never authorize v4.

Manifest schema v5 binds deployed ProgramData, allocation, content/rules
catalogs, exact launch day and seed plan, and keeper release. The dependency is
one-way: unique Fly keeper release tag, keeper fingerprint, launch-plan
fingerprint, then final manifest. The obsolete v3 manifest is intentionally not
a reusable release input. Fly exposes a unique `deployment-<ULID>` release tag
to the worker and that tag is part of the keeper fingerprint, so any later Fly
deploy invalidates write authority.

### Deployment

Preparation is two exact, independently approved bundles. From `client`,
`NO_DNA=1 pnpm chain:devnet:deploy` plans an explicit `initial` or `upgrade`
operation from an already frozen SBF. Its live read-only preflight binds Devnet
genesis, the canonical ProgramData address, artifact and padded ProgramData
hashes, allocation, rent, fees, signer public keys, spend, and reserve; a fresh
initial deployment reserves 10,240 bytes of headroom. The planner never rebuilds
the artifact or copies a program keypair.

After the program and independently fingerprinted keeper release exist,
`NO_DNA=1 pnpm chain:devnet:launch-plan` produces the unsigned fresh-bootstrap
bundle. It requires every protocol target to be absent, calculates the exact
deployer funding transaction, initializes paused, initializes the Arcade archive
with a 0.5 SOL recyclable cadence-rent float, publishes Campaign v2 and Arena
rules v1, prepares current and following Daily/Weekly/Season accounts, and ends
with one atomic transaction that seeds exactly 1/2/3 SOL, unpauses, and
activates the three current competitions. The launch day may be mid-Weekly and
mid-Season, but its approval expires at the specified pre-entry cutoff. The
planner has no signing or sending path.

`NO_DNA=1 pnpm chain:devnet:launch` is the separate approval-gated executor. Its
`stage` mode simulates, signs once, confirms, and re-reads only transactions
0–20, leaving the protocol paused and writing a public launch bundle under
`/tmp`. A signed receipt is atomically persisted before each submission, so
`resume` can verify the exact approved message, signer, signature status, and
blockhash before relaying or re-signing an interrupted pass. The deployed keeper
must then report `staged_launch_ready` for the approved release fingerprint.
Only `activate` mode can submit transaction 21; it re-verifies the bundle hash,
Devnet genesis, ProgramData, account contents, cutoff, signer, keeper evidence,
and exact instruction bytes before the atomic seed/unpause. No client or Fly
process contains an unconditional launch path.

Fresh initialization remains paused. The exact schema-v11 keeper release
completed Devnet recovery and is write-enabled under the approved recurring
authority, which does not authorize reinitialization, deployment, funding,
governance, or Mainnet actions.

### Manual prize top-up

Never transfer SOL directly to a Daily, Weekly, or Season PDA; that does not
update its seeded-funds ledger. From `client`, this read-only plan resolves the
confirmed current cadences, validates the approved deployment and live accounts,
combines instructions atomically, simulates without a signer, and writes a
public bundle under `/tmp`:

```bash
NO_DNA=1 pnpm chain:devnet:top-up -- plan \
  --top-up daily:current:1SOL \
  --top-up weekly:current:3SOL
```

Amounts require an explicit `SOL` or `lamports` suffix, and a cadence may be
`current`, `following`, or an exact numeric ID. The printed bundle pins Devnet
genesis, ProgramData hash and allocation, protocol authority, exact pool PDAs,
instruction bytes, seeded balances, maximum fee and spend, and the post-write
authority reserve. Execution is a separate command, valid only after the entire
printed bundle receives exact approval:

```bash
ZKUBE_PRIZE_TOP_UP_APPROVAL=<printed-64-hex-fingerprint> \
ZKUBE_PROTOCOL_AUTHORITY_KEYPAIR=<pinned-authority-path> \
NO_DNA=1 pnpm chain:devnet:top-up -- execute \
  --bundle <printed-bundle-path>
```

The executor loads no keypair until the fingerprint matches. It then rechecks
the deployment and live cadence window, refuses seeded-balance drift, enforces
the approved fee and reserve, simulates the signed atomic transaction, persists
its receipt before relay, confirms it, and verifies each seeded balance. The
command deliberately rejects Mainnet. Mainnet enablement requires a separately
reviewed release binding the approved Mainnet genesis, deployment manifest,
program, authority, economics, distribution decision, and operational policy;
Devnet approval or this command's existence grants none of those permissions.

### Gate G1 — physical-device wallet matrix

Run every row on a physical device for Seed Vault Wallet on Seeker, Phantom on
Android, and Solflare on Android. `README.md` documents the capability panel and
local HTTPS setup used for step 1.

| # | Step | Expected result |
| ---: | --- | --- |
| 1 | Passive capability inspection | Panel lists the wallet with `solana:signTransaction` and version `0` |
| 2 | Connection and authorization | Account authorized, address matches the wallet UI |
| 3 | Rejection | User decline surfaces as a typed rejection, no partial state |
| 4 | Reconnect after process death | Authorization re-establishes without a stale account |
| 5 | Background and resume | Returning to the app keeps or cleanly re-requests the connection |
| 6 | Account switch | Client observes the new address; no cross-account carryover |
| 7 | v0 sign-only behavior | Wallet returns a signed v0 transaction without submitting it |
| 8 | Unchanged message bytes | Returned message equals the approved message exactly |
| 9 | Device partial signatures | An existing device-session signature survives wallet signing |

Steps 7–9 verify properties the client already enforces: signing requires
`solana:signTransaction` with version `0`, a wallet that can only sign-and-send
is rejected, and a wallet that mutates the message or discards an existing
partial signature fails the check rather than producing a silently altered
transaction.

Step 1 is passive inspection and needs no signing approval. Every later step
drives a real wallet, produces authorization signatures or signed messages, and
is out of scope for routine work. Any such pass — including a transaction or
message signature test that is unsent, local-only, or zero-lamport — must first
be proposed as one exact enumerated approval bundle covering the instructions or
message, accounts, signers, Devnet genesis and cluster, expected send behaviour,
and maximum spend.

Stop/go: proceed with the sign-only architecture only after Seed Vault Wallet
confirms `SolanaSignTransaction` with transaction version `0`, preserved partial
signatures, and unchanged message bytes. If any of those fail, stop for an
explicit architecture and security decision. Never silently fall back to
`signAndSendTransaction`; that path forfeits the exact signed-message check and
the device partial signature.

Record per device, wallet, and step, with no secrets: UTC date; device model and
OS or firmware build; wallet name and version; browser and surface; exposed
feature keys and supported transaction versions; result or error class. Never
record signer bytes, seed phrases, private keys, `.env` contents, keeper
secrets, or Android credentials.

Passing Gate G1 is a client-surface compatibility result only. It does not imply
Mainnet readiness, does not open paid Arcade, and is not deployment or Solana
dApp Store publication approval; each remains separately approved.
