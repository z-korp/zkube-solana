# zKube on Solana

zKube is one wallet-native Solana game for the Solana dApp Store and Seeker.
Arcade is the default competitive mode; the complete on-chain Campaign remains
available in the same application as a visually separate, map-first mode.

The connected Solana address is the player identity. There are no embedded
wallets, recovery codes, deposits, soft currencies, shops, passes, token swaps,
or prize claims. v4 is Devnet-first and presently undeployed. Mainnet remains
blocked on counsel, economic, and distribution review.

## Product model

- Campaign and yesterday's unranked Practice are free.
- Campaign is optional and never gates Arcade.
- Every ranked Arcade run requires a separate owner-signed exact 0.02 SOL
  entry. A device session can never authorize that payment.
- Campaign stars are the only progression. Campaign never changes competitive
  records or grants SOL, entries, prize eligibility, or mint odds.
- Arcade is competition only. It has no XP, levels, quests, achievements,
  titles, ratings, crests, or other gameplay-progression counters.
- Practice writes no persistent progression and never affects a prize. Only a
  separately paid ranked result can enter a competition board.

The static PWA/TWA opens on Arcade and exposes four primary destinations:
Arcade, Campaign, Ranks, and Profile. Campaign uses the existing world
map and art direction, while Arcade owns the competitive navigation and
profile language.

## Campaign progression

Campaign is exactly ten zones of ten levels: 100 levels and 300 possible
stars. Its canonical state is one packed 25-byte, two-bits-per-level star
array; zone unlocked, cleared, perfected, total stars, and badges are derived
views rather than separately stored progression.

Only Zone 1 Level 1 is initially playable. Within a zone, each later level
requires at least one star on the preceding level. The first level of a later
zone requires at least one star on the preceding zone's guardian, Level 10.
Completed levels remain replayable, and a level's best one-to-three-star result
can only increase. A guardian emblem unlocks with its guardian; its rendered
variant becomes gold when that zone reaches 30/30 stars.

## SOL accounting

Each paid entry transfers exactly 20,000,000 lamports:

| Destination | Share | Lamports |
| --- | ---: | ---: |
| Following Daily | 60% | 12,000,000 |
| Following Weekly | 20% | 4,000,000 |
| Following 28-day Season | 10% | 2,000,000 |
| Operator revenue | 10% | 2,000,000 |

All competition pots are prepaid. Initialization may seed only the first
Daily, Weekly, and Season, with exact values supplied by a separately approved
release bundle. Every later pot is funded by entries from its predecessor
period plus predecessor rollover. Entries never increase their active Daily,
Weekly, or Season prize.

Devnet may launch partway through a calendar Weekly or Season. The first
seeded Daily starts on the launch day; the first Weekly and Season keep their
canonical closing timestamps but qualify only finalized Dailies from the
launch day onward. Their qualification start is immutable and settlement
validates every included Daily on-chain. Every successor Weekly and Season
starts at its normal Monday boundary and uses its full calendar period.

Settlement is atomic, push-only, may be late, and is never cancelled. A paid
entry has no refund or claim path: it becomes exactly one scored or expired
entry. Operator withdrawals remain governance actions and cannot spend
accounted prize balances.

Every calculated transfer rounds down to 1,000,000 lamports (0.001 SOL).
Division residue, rounding dust, and empty allocations roll into the following
competition of the same type. When fewer winners qualify, the occupied payout
weights are renormalized before rounding.

The accounting invariant is:

```text
entries_scored + entries_expired == entries_paid
```

## Competitions

Days use UTC. Entries close at 23:00 and existing runs close at 23:30. The
keeper prepares successor accounts before entries open, so the client can show
the active guaranteed pot and following-period funding separately.

At the run deadline, the resolved ER freezes the last fully accepted state and
adds a replay deadline event. A run with at least one accepted action is scored
from that partial state. An untouched run expires without a leaderboard row.
Pending or late VRF output is ignored. Expired or orphaned state can never
become scoreable later.

### Daily

Daily keeps one best score per wallet while retaining attempt counts. The top
five receive 45/25/15/10/5.

### Weekly skill bounties

Each Monday-aligned Weekly selects one deterministic metric from each category:

- combo: maximum combo, combo-scoring actions, or combo-derived score;
- single action: highest action score, most lines, or most blocks destroyed;
- full run: total lines, total blocks destroyed, or perfect clears.

The Weekly pot is divided equally between the three boards. Each board pays
60/25/15, and a wallet may win more than one board.

### Season

A Season is a Monday-aligned 28-day period. Each finalized Daily contributes
one band result per wallet, and its best 20 results count:

| Daily band | Season points |
| --- | ---: |
| Top 1%, capped at rank 3 | 100 |
| Top 5%, capped at rank 10 | 60 |
| Top 10%, capped at rank 20 | 30 |
| Top 25%, capped at rank 50 | 10 |
| Another scoreable result | 2 |

Season top five receive 45/25/15/10/5. Leaderboards order the primary score or
metric descending, then the earliest finalized achievement, then wallet bytes.

## Deterministic game and replay

`zkube-core` is the deterministic source for grid state, blocks, mutators,
scoring, pressure, metrics, period math, payout math, canonical encoding, and
the replay commitment schedule. Native Rust, WASM, and the Solana program must
pass the same committed golden vectors before an ABI is releasable.

Replay v2 binds the chain domain, challenge, rules hash, player, run ID, and
mode, then folds ordered VRF, action, bonus, abandon, and deadline events with
SHA-256. Permanent board rows retain the qualifying replay commitment. Move
lists can stay off-chain and be independently recomputed.

After a perfect clear, one domain-separated VRF output deterministically
derives both the one-row board reseed and the next visible preview. The
committed continuation vector prevents the run from being stranded between
two oracle requests or accepting a stale move without a preview.

Campaign uses the same engine and generated catalog but a separate progression
boundary. Completing Campaign content may only improve the packed star array.

## Competitive profile

Player state keeps lifetime paid entries and one compact Daily, Weekly, and
Season competition record. Each record stores best payout-bearing rank,
podiums, wins, and pushed rewards in lamports. A non-paying leaderboard place
remains visible on the period board but is not a profile best rank. Daily and
Season profile ranks therefore cover only the top five; each Weekly skill board
covers its own top three, and Weekly podiums and wins count the three boards
independently. Aggregate wins and rewards are display-time sums.

The featured emblem is owner- or device-session-selectable. ID 0 automatically
chooses the strongest unlocked emblem; IDs 1 through 10 are zone guardians,
11 is Realm Conqueror for all ten guardians, and 12 is World Perfect for
300/300 stars. Emblems are identity display only and have no monetary effect.

Payouts are pushed before profile metadata is synchronized. Separate
permissionless Daily, Weekly, and Season profile-sync instructions recompute
the exact already-pushed payout from finalized boards and ledgers, then use
per-period winner-position bitmasks to make each update idempotent. A missing
or failed profile sync can never delay, cancel, repeat, or otherwise affect a
SOL transfer.

## Runtime boundaries

| Boundary | Responsibility | Authority and funding |
| --- | --- | --- |
| Owner wallet | Durable identity and paid entry | Signs every 0.02 SOL entry |
| Device session | Approximately seven days of safe gameplay | Never signs entry payment |
| Player funding PDA | Narrow reusable rent float | Owner-funded; self-CPI wrappers only |
| MagicBlock ER | Active gameplay and per-row VRF | Router-resolved validator |
| Solana program | Campaign stars, competitive records, accounting, boards, settlement | Base-layer authority |
| Fly keeper | Period preparation, recovery, rollup, settlement, cleanup | Independent bounded signer |
| Static PWA/TWA | Wallet, Campaign, and Arcade UI | No server signer or paymaster |

The player funding PDA is System-owned and has zero data. It can fund only the
rent paths named by exact zKube self-CPI wrappers. It is not a wallet and cannot
forward arbitrary instructions.

Solana Base, the MagicBlock Router, and the Router-resolved ER are separate
connections. Delegation placement is resolved through `getDelegationStatus`;
regional ER endpoints are never hardcoded. One durable active run ID prevents
overlap across modes and devices. A separate orphan reservation prevents an
unreachable delegated run from racing a replacement run.

The program pins `ephemeral-rollups-sdk` 0.16.2 or newer. Its generated
undelegation callback must constrain the canonical `undelegate-buffer` PDA and
the System program; the committed IDL regression test rejects the unsafe older
`#[ephemeral]` expansion.

## Keeper safety

The keeper validates cluster genesis, program and ProgramData identity,
account owner, bounded length, discriminator, version, PDA, and stored account
relationships before decoding or planning a write. It reconciles:

- current and following Daily, Weekly, and Season preparation;
- terminal or deadline Arena, Practice, and Campaign runs;
- deterministic expiry and orphan recovery;
- Daily-to-Season rollup and sealing;
- Daily, Weekly, and Season push settlement and rollover;
- post-settlement Daily, Weekly, and Season profile synchronization;
- resolved run and expired session cleanup;
- bounded post-rollup participant-account closure, with rent recycled only to
  the canonical player funding PDA.

The recurring signer cannot deploy, initialize, seed pots, change rules,
withdraw revenue, reimburse an entry, invoke a swap, or target mainnet. A
write-enabled release is pinned to Devnet genesis, deployed ProgramData hash,
program ID, keeper signer, image digest, rules/replay/schema/IDL hashes,
instruction allowlist, eight-write limit, two-session cleanup limit, 0.05 SOL
simulated spend ceiling, a separate two-participant-account closure limit, and
a 0.1 SOL keeper reserve floor.

Fresh initialization remains paused. Paid Arcade cannot open until the exact
program and complete recovery/settlement keeper have passed read-only
verification and are included in an explicit approval bundle.

## Development and validation

```bash
NO_DNA=1 ./validate.sh program
cd services
NO_DNA=1 pnpm install --frozen-lockfile
NO_DNA=1 pnpm run build
NO_DNA=1 pnpm test
cd ../client
NO_DNA=1 pnpm idl:check
NO_DNA=1 pnpm core:wasm:sync
NO_DNA=1 pnpm core:wasm:check
NO_DNA=1 pnpm exec tsc -b --pretty false
NO_DNA=1 pnpm lint
NO_DNA=1 pnpm exec vitest run
NO_DNA=1 pnpm build
```

The generated IDL is the ABI handoff between program, keeper, and client.
Tests must cover exact lamport conservation, period rollover, deadline
freezing, replay parity, ER recovery, account validation, and Campaign's
inability to mutate competitive records.

### Frontend handoff

The protocol/client compatibility lane intentionally does not include the
visual redesign. The next Claude frontend pass must preserve the contract and:

- remove the Quests destination and all XP, title-ring, achievement, quest,
  rating, and crest copy or controls;
- keep exactly four primary destinations: Arcade, Campaign, Ranks, Profile;
- present Practice only as a free, unranked “would have ranked” comparison with
  no persistent reward or progression language;
- remove stale `+100 XP`, `+50 XP`, and similar result messaging;
- make Profile show the featured emblem, Campaign stars, lifetime paid entries,
  total wins/rewards, and collapsible Daily/Weekly/Season records;
- provide an eligible-emblem picker, including automatic selection and gold
  guardian variants derived from Campaign stars;
- batch-fetch player profile state for leaderboard emblem rendering instead of
  issuing one account read per row;
- use Season everywhere; `Monthly` is not a product or protocol label.

## Deployment status

The v4 program address reserved in source is
`Dz9RaTXpp4vadhBS6oT3RPLjqTT4M4RVwfpowjumSJyd`. A read-only Devnet check on
2026-07-19 found no account at that address. Source state is not deployment
evidence, and no v4 deployment, initialization, funding, or keeper enablement
has been authorized.

The previous v3 address
`Apyuy9VZvg7DLcQhe6KGv3sw2MNzriMjtCx2q7zac1QR` is a retired legacy artifact;
its approvals never authorize v4.

Deployment preparation is split into two exact, independently approved
bundles. From `client`, `NO_DNA=1 pnpm chain:devnet:deploy` plans an explicit
`initial` or `upgrade` operation from an already frozen SBF. Its live read-only
preflight binds Devnet genesis, the canonical ProgramData address, artifact and
padded ProgramData hashes, allocation, rent, fees, signer public keys, spend,
and reserve; a fresh initial deployment reserves 10,240 bytes of headroom. The
planner never rebuilds the artifact or copies a program keypair.

After the program and the independently fingerprinted keeper release exist,
`NO_DNA=1 pnpm chain:devnet:launch-plan` produces the unsigned fresh-bootstrap
bundle. It requires every protocol target to be absent, initializes paused,
publishes Campaign v2 and Arena rules v1, prepares the current and following
Daily/Weekly/Season accounts, and ends with one atomic transaction that seeds
exactly 1/2/3 SOL, unpauses, and activates the three current competitions. The
launch day may be mid-Weekly and mid-Season, but its approval expires at the
specified pre-entry cutoff. The planner has no signing or sending path.

Deployment manifest schema v5 binds the deployed ProgramData, allocation,
content/rules catalogs, exact launch day and seed plan, and keeper release. The
keeper image is first deployed and verified read-only by its immutable Fly
digest. That digest determines the keeper fingerprint, the keeper fingerprint
determines the launch plan, and the final manifest binds the launch-plan
fingerprint. This one-way dependency avoids self-referential release hashes.
The obsolete v3 manifest is intentionally not a reusable release input.

Production web publishing remains Git-driven from
`z-korp/zkube-solana:main` to Vercel project
`prj_5kqIxlxgXHXGhldje8unic9h3qYA` under `z-labs`. Feature and archive branches
do not publish production. The JCN exception applies only to Fly Devnet keeper
hosting and must never be copied to Vercel.
