# zKube on Solana

zKube is one wallet-native Solana game for the Solana dApp Store and Seeker.
Arcade is the default competitive mode; the complete on-chain Campaign remains
available in the same application as a visually separate, map-first mode.

The connected Solana address is the player identity. There are no embedded
wallets, recovery codes, deposits, soft currencies, shops, passes, token swaps,
or prize claims. v4 is live on Devnet; Mainnet remains blocked on counsel,
economic, and distribution review.

## Product model

- Campaign is free. Practice is retired; already-created legacy Practice runs
  remain recoverable through their terminal or deterministic-expiry paths.
- Campaign is optional and never gates Arcade.
- Every ranked Arcade run requires a separate owner-signed exact 0.01 SOL
  entry. A device session can never authorize that payment.
- Campaign stars are the only progression. Campaign never changes competitive
  records or grants SOL, entries, prize eligibility, or mint odds.
- Arcade is competition only. It has no XP, levels, quests, achievements,
  titles, ratings, crests, or other gameplay-progression counters.
- Legacy Practice writes no persistent progression and never affects a prize.
  Only a separately paid ranked result can enter a competition board.

The static PWA/TWA opens on Arcade and exposes four primary destinations:
Arcade, Campaign, Ranks, and Profile. Campaign uses the existing world
map and art direction, while Arcade owns the competitive navigation and
profile language. If today's Daily is delayed or only a stale previous Daily is
visible, Arcade shows a `Play Campaign while you wait` CTA; Campaign remains
free and does not substitute for or gate a paid entry.

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

Each paid entry transfers exactly 10,000,000 lamports:

| Destination | Share | Lamports |
| --- | ---: | ---: |
| Following Daily | 60% | 6,000,000 |
| Following Weekly | 20% | 2,000,000 |
| Following 28-day Season | 10% | 1,000,000 |
| Operator revenue | 10% | 1,000,000 |

All competition pots are prepaid. Initialization may seed only the first
Daily, Weekly, and Season, with exact values supplied by a separately approved
release bundle. Automatic funding for every later pot comes from entries in
its predecessor period plus predecessor rollover. Entries never increase their
active Daily, Weekly, or Season prize.

The protocol authority may also make a separately approved manual top-up of
any positive lamport amount to the canonical current or following Daily,
Weekly, or Season while that pool remains live. The pool kind and cadence ID
select an exact PDA-specific instruction; the transfer increments the same
on-chain seeded-funds ledger used by settlement. Direct wallet transfers are
not prize funding, and the keeper has no authority to invoke this path.

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

Days use UTC. Entries close at 23:45 and existing runs freeze at 23:59. The
next preactivated Daily opens at 00:00 even if the preceding payout pass is
still finishing, so settlement does not create a playable-day gap. The keeper
prepares successor accounts before entries open, so the client can show the
active guaranteed pot and following-period funding separately.

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
| Owner wallet | Durable identity and paid entry | Signs every 0.01 SOL entry |
| Device session | Approximately seven days of safe gameplay | Never signs entry payment |
| Player funding PDA | Narrow reusable rent float | Owner-funded; self-CPI wrappers only |
| Cadence funding PDA | Recyclable Daily/Weekly/Season rent float | Separately seeded; narrow self-CPI preparation only |
| Arcade archive PDA | Rolling finalized-result commitments | Program-derived append-only roots |
| MagicBlock ER | Active gameplay and per-row VRF | Router-resolved validator |
| Solana program | Campaign stars, competitive records, accounting, boards, settlement | Base-layer authority |
| Fly keeper | Period preparation, recovery, rollup, settlement, cleanup | Independent bounded signer |
| Static PWA/TWA | Wallet, Campaign, and Arcade UI | No server signer or paymaster |

The player funding PDA is System-owned and has zero data. It can fund only the
rent paths named by exact zKube self-CPI wrappers. It is not a wallet and cannot
forward arbitrary instructions.

The cadence funding PDA follows the same zero-data System-owned pattern but is
usable only by the exact Daily, Weekly, and Season preparation wrappers.
Finalized cadence accounts close back to that PDA only after winner profile
synchronization and every required rollup is complete. Before the on-chain
account is committed and closed, the Devnet keeper atomically writes and
re-reads the complete canonical result JSON on its persistent Fly volume. The
small program-owned Arcade archive then advances one sequential rolling
commitment per Daily, Weekly, and Season. Devnet volume storage is a recovery
aid, not the Mainnet durability design; Mainnet requires replicated public
archive storage.

Archive contract v1 files remain append-only and are never rewritten. New
files use contract v2: `resultDataBase64` carries the exact immutable Borsh
result projection committed by `resultHash` and the rolling root, while the
full raw account bytes remain point-in-time evidence. Closure reprojects both
v1 and v2 evidence through the checked-in IDL and verifies the stored account,
cadence, program, result hash, root, and immutable projection exactly. It does
not require current raw-byte equality after permitted metadata changes such as
winner profile synchronization. A missing or invalid committed file is never
re-materialized; that cadence archive plan is quarantined while independent
keeper plans continue.

Client-assembled owner transactions pin a deterministic 400,000-compute-unit
limit and 1,000-micro-lamport unit price before wallet approval. The maximum
priority fee is therefore 400 lamports. Fully specifying both fields prevents
wallet-side priority-fee message enhancement while retaining the exact
signed-message check: changed instructions, accounts, blockhashes, signer
roles, or existing partial signatures are rejected.

Solana Base, the MagicBlock Router, and the Router-resolved ER are separate
connections. Delegation placement is resolved through `getDelegationStatus`;
regional ER endpoints are never hardcoded. PlayerState v3 has one durable
Campaign run slot and one durable Arcade run slot, so one run of each may
coexist while overlap within either mode is rejected across devices. Both
slots allocate from one monotonic run-ID sequence. A separate Arcade orphan
reservation prevents an unreachable delegated run from racing a replacement.
The byte-compatible v2 migration moves a legacy shared pointer into the slot
selected by its stored immutable mode.

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

Keeper release-policy schema v10 fingerprints supported archive contracts
`[1,2]` and requires the Daily archive checkpoint to cover a Weekly's final
qualified day before planning settlement. It quarantines a typed per-cadence
archive-integrity failure without blocking an independent Daily, Weekly,
Season, or Campaign plan. Global chain readiness, policy, materialization,
storage configuration, and release errors remain fatal. A
preparation/integrity failure or archive-transaction failure suppresses only
the same cadence's profile sync, cadence close, and participant cleanup writes
for that pass. Quarantined and suppressed plans consume neither the eight-write
window nor its session/participant closure quotas, so later eligible recovery
and unrelated-cadence work backfills the same pass. The enforced cadence
ordering is finalize, Daily-to-Season rollup, seal, archive, profile sync, then
close.

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
GitHub static validation runs only through `workflow_dispatch`; it is not a
push or pull-request gate. The local `validate.sh` and `AGENTS.md` gates are
authoritative for steady-state validation.

### Frontend handoff

The protocol/client compatibility lane intentionally does not include the
visual redesign. The next Claude frontend pass must preserve the contract and:

- remove the Quests destination and all XP, title-ring, achievement, quest,
  rating, and crest copy or controls;
- keep exactly four primary destinations: Arcade, Campaign, Ranks, Profile;
- expose no new Practice launch affordance, while allowing an already-created
  legacy Practice run to resume, settle, or expire safely;
- remove stale `+100 XP`, `+50 XP`, and similar result messaging;
- make Profile show the featured emblem, Campaign stars, lifetime paid entries,
  total wins/rewards, and collapsible Daily/Weekly/Season records;
- provide an eligible-emblem picker, including automatic selection and gold
  guardian variants derived from Campaign stars;
- batch-fetch player profile state for leaderboard emblem rendering instead of
  issuing one account read per row;
- use Season everywhere; `Monthly` is not a product or protocol label.

## Mobile Wallet Adapter and Seeker validation

### Target surfaces

| Surface | Status | Wallet path |
| --- | --- | --- |
| Desktop browser | Supported | Wallet Standard extension |
| Android Chrome | Supported | Mobile Wallet Adapter |
| Chrome-installed PWA | Supported | Mobile Wallet Adapter |
| TWA (dApp Store / Seeker) | Eventual target | Mobile Wallet Adapter |
| iOS | Not claimed supported | — |
| Other Android browsers | Not claimed supported | — |

Seed Vault Wallet is Seeker's built-in wallet and is the reference MWA target.
Phantom and Solflare on Android are optional MWA-compatible wallets, not
requirements. Nothing on iOS or on a non-Chrome Android browser is claimed
supported yet; those surfaces are untested, not deliberately blocked.

`client/src/platform/capabilities.ts` classifies only observable browser
signals and MWA registration follows that classification, so a desktop or iOS
browser never registers the mobile connector. TWA detection is deliberately
conservative: Android, standalone display mode, and an `android-app://`
referrer must all hold, so a plain Android browser or an installed PWA is never
promoted on user agent alone.

### Capability-only diagnostics

The existing dev-preview surface exposes a read-only capability panel:

```bash
cd client
NO_DNA=1 pnpm dev
```

Open `http://<lan-ip>:5175/?dev=1` on the device and expand
`Capability diagnostics` in the lower-right corner. `?dev=0` clears the
persisted opt-in. The panel reports the classified platform kind, standalone
display mode, conservative TWA signal, whether MWA is supported, and for each
discovered Wallet Standard wallet its name, chains, feature keys, and the
presence and supported transaction versions of `solana:signTransaction` and
`solana:signAndSendTransaction`.

It reads public registry metadata only. It never connects, authorizes, reads
accounts, signs, simulates, or sends, and the whole `src/dev/` harness is
gated on `import.meta.env.DEV`, so a production build eliminates it.

### Gate G1 physical-device matrix

Run every row on a physical device for Seed Vault Wallet on Seeker, Phantom on
Android, and Solflare on Android. Step 1 is passive; steps 2 onward require a
real wallet and are gated as described below.

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

Steps 7 through 9 verify the properties the client already enforces:
signing requires `solana:signTransaction` with version `0`, a wallet that can
only sign-and-send is rejected, and a wallet that mutates the message or
discards an existing partial signature fails the check rather than producing a
silently altered transaction.

### Transaction-policy boundary

Step 1 is passive inspection and needs no signing approval. Every later step
drives a real wallet, produces authorization signatures or signed messages, and
is out of scope for routine work. Any such pass — including a transaction or
message signature test that is unsent, local-only, or zero-lamport — must first
be proposed as one exact enumerated approval bundle covering the instructions
or message, accounts, signers, Devnet genesis and cluster, expected send
behavior, and maximum spend. No step in this matrix is executed by the
documentation change that introduced it.

### Stop/go rule

Proceed with the sign-only architecture only after Seed Vault Wallet confirms
`SolanaSignTransaction` with transaction version `0`, preserved partial
signatures, and unchanged message bytes. If any of those fail, stop for an
explicit architecture and security decision. Do not silently fall back to
`signAndSendTransaction`; that path forfeits the exact signed-message check and
the device partial signature.

### Evidence to record

Record per device, wallet, and step, with no secrets:

- UTC date;
- device model and OS or firmware build;
- wallet name and version;
- browser and surface (Android Chrome, installed PWA, or TWA);
- exposed feature keys and supported transaction versions;
- result or error class.

Never record signer bytes, seed phrases, private keys, `.env` contents, keeper
secrets, or Android credentials.

Passing Gate G1 is a client-surface compatibility result only. It does not
imply Mainnet readiness, does not open paid Arcade, and is not deployment or
Solana dApp Store publication approval; each of those remains separately
approved.

## Deployment status

The v4 Devnet program is
`Dz9RaTXpp4vadhBS6oT3RPLjqTT4M4RVwfpowjumSJyd`, with ProgramData
`2RAkctsFpaHEJZcF5337G3uAkXUsj1djfnLtDrjBM3qS`, allocation `1,420,056`, and
padded ProgramData SHA-256
`9fcc24a56c5e1fae8fb92f4df7b11ce9267a187a7fee7413e2f2682fdddc553e`.
The approved launch completed on 2026-07-22 at protocol PDA
`G6AsmU4mmifT5RB25SbMEwJ8m6oT3PFky9hGwRKSbAPJ`. Daily `20656`, Weekly `2950`,
and Season `737` opened atomically with 1/2/3 SOL. The activation signature is
`A1iaCAkcQDbEdhtQDZjsvH8hWuLQ3N9waycid52rB6UkrS2zDv6tHmhZSkEn6GADawuBkpxR6pEGFUsJCEKjdXS`.

Fly machine `82d371f7d43e38` runs the approved keeper release
tag `deployment-01KYFMES913DMHBWBN0043DFAR`, image digest
`sha256:b34643e73f5802bf48c2a092c39dbe777de0711f5f51d2bc8c3ad53cc675c0f0`,
and fingerprint
`7ea04864e4469b03e6be880083974cf0828adfc3058e0fdd21f3e4cdc7fb2cf4`.
It mounts the encrypted one-GB `zkube_archives` volume, runs every 60 seconds,
permits at most eight writes and 0.1 SOL simulated spend per pass, and preserves
a 0.1 SOL signer reserve. Writes are enabled under the approved recurring
authority.

The cadence-archive, PlayerState v3 run-slot, retired-Practice preparation, and
exact 0.01 SOL entry-split program upgrade confirmed on 2026-07-23 with
signature
`41u1gJxYMAvXcJBU8HHedikFoFbmd8rq8Qb8823Hoe1DEi3huCYiQiUUzPe1Ri71ZRi79VM3KmFpRd5AfcBYVDmJ`.
The separately approved migration initialized the archive and 0.5 SOL
recyclable cadence-rent float, activated the exact 0.01 SOL 60/20/10/10
economy, and added an accounted 1 SOL seed to Daily `20657`. The keeper passed
read-only verification before writes were enabled, archived and closed Daily
`20656`, prepared the following cadence, and completed a clean zero-write pass
after catch-up. The protocol was then unpaused with signature
`4YzKY39Fn2ZrnDJ812CQR4KacWAg2Awr2cDoNt6AZg2Lvz6G2uTP3ucKWJs9DpvWxvGhnsCZ2Ywmc5XRiRF2jcFJ`.
Already-created v2 runs migrate in place and legacy Practice retains only its
recovery and settlement paths.

The following is a time-sensitive Devnet observation after the approved
recovery on 2026-07-26, not a Mainnet-readiness claim: Daily `20660` is open,
Daily `20661` is prepared and preactivated, and Dailies `20657` through `20659`
are finalized with their Season rollups sealed. Daily `20657` remains
fail-closed because its archive reread expected
`7266793f61621c57ed7c76630223e64e80270d8bd2553a0862f437c0e559712b`
but found stored hash
`19573534f07de5e120a8d5b1dc04b7affe5f8f5a809ff4676ecca26ee01e5455`.
A read-only public Devnet derivation on 2026-07-27 reproduced both hashes
exactly. The stored v1 evidence had zero Season rollups, an unsealed rollup,
and profile-sync mask zero; the current account has two rollups, a sealed
rollup, and profile-sync mask three. Its immutable result hash
`133fc0222f3e0d2499782109fc55b50beb0ab654df23f8d16809f88d4d85f0b4`
and committed root
`8494089aa05929470eac2340bf2403568d77097c1ef785386d06c5a8d2676552`
are unchanged. The deployed release still blocks closure and rent recycling;
this source-level fix is not deployed.

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
bundle. It requires every protocol target to be absent, calculates the exact
deployer funding transaction, initializes paused,
initializes the Arcade archive with a 0.5 SOL recyclable cadence-rent float,
publishes Campaign v2 and Arena rules v1, prepares the current and following
Daily/Weekly/Season accounts, and ends with one atomic transaction that seeds
exactly 1/2/3 SOL, unpauses, and activates the three current competitions.
The launch day may be mid-Weekly and mid-Season, but its approval expires at
the specified pre-entry cutoff. The planner has no signing or sending path.

`NO_DNA=1 pnpm chain:devnet:launch` is the separate approval-gated executor.
Its `stage` mode simulates, signs once, confirms, and re-reads only transactions
0–20, leaving the protocol paused and writing a public launch bundle under
`/tmp`. A signed receipt is atomically persisted before each submission, so
`resume` can verify the exact approved message, signer, signature status, and
blockhash before relaying or re-signing an interrupted pass. The deployed
keeper must then report `staged_launch_ready` for the approved release
fingerprint. Only `activate` mode can submit transaction 21; it re-verifies the
bundle hash, Devnet genesis, ProgramData, account contents, cutoff, signer,
keeper evidence, and exact instruction bytes before the atomic seed/unpause.
No client or Fly process contains an unconditional launch path.

Deployment manifest schema v5 binds the deployed ProgramData, allocation,
content/rules catalogs, exact launch day and seed plan, and keeper release. The
dependency is one-way: unique Fly keeper release tag, keeper fingerprint,
launch-plan fingerprint, then final manifest. The obsolete v3 manifest is
intentionally not a reusable release input. The sanitized, approved v4 Devnet
binding consumed by the production web build is committed at
`client/deployment/devnet-v4.json`.

Fly exposes a unique `deployment-<ULID>` release tag to the worker; that tag is
part of the keeper fingerprint. The approval bundle also records the immutable
digest observed through the Machines API. Any later deploy changes the runtime
tag and therefore invalidates write authority.

Production web publishing remains Git-driven from
`z-korp/zkube-solana:main` to Vercel project
`prj_5kqIxlxgXHXGhldje8unic9h3qYA` under `z-labs`. Feature and archive branches
do not publish production. The JCN exception applies only to Fly Devnet keeper
hosting and must never be copied to Vercel.
