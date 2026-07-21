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
- Campaign retains only map, level, and guardian completion. It does not grant
  Arcade XP, quests, achievements, titles, ratings, crests, or rank.
- Arcade and Practice may advance non-monetary Arcade progression. Only paid
  ranked results participate in rankings, ratings, crests, or payouts.
- Progression never grants SOL, entries, prize eligibility, or mint odds.

The static PWA/TWA opens on Arcade and exposes five primary destinations:
Arcade, Campaign, Quests, Ranks, and Profile. Campaign uses the existing world
map and art direction, while Arcade owns the competitive navigation and
profile language.

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
boundary. Completing Campaign content may only change level and guardian
completion.

## Runtime boundaries

| Boundary | Responsibility | Authority and funding |
| --- | --- | --- |
| Owner wallet | Durable identity and paid entry | Signs every 0.02 SOL entry |
| Device session | Approximately seven days of safe gameplay | Never signs entry payment |
| Player funding PDA | Narrow reusable rent float | Owner-funded; self-CPI wrappers only |
| MagicBlock ER | Active gameplay and per-row VRF | Router-resolved validator |
| Solana program | Progress, accounting, boards, settlement | Base-layer authority |
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

## Keeper safety

The keeper validates cluster genesis, program and ProgramData identity,
account owner, bounded length, discriminator, version, PDA, and stored account
relationships before decoding or planning a write. It reconciles:

- current and following Daily, Weekly, and Season preparation;
- terminal or deadline Arena, Practice, and Campaign runs;
- deterministic expiry and orphan recovery;
- Daily-to-Season rollup and sealing;
- Daily, Weekly, and Season push settlement and rollover;
- resolved run and expired session cleanup.

The recurring signer cannot deploy, initialize, seed pots, change rules,
withdraw revenue, reimburse an entry, invoke a swap, or target mainnet. A
write-enabled release is pinned to Devnet genesis, deployed ProgramData hash,
program ID, keeper signer, image digest, rules/replay/schema/IDL hashes,
instruction allowlist, eight-write limit, two-session cleanup limit, 0.05 SOL
simulated spend ceiling, and a 0.1 SOL keeper reserve floor.

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
inability to mutate Arcade progression.

## Deployment status

The v4 program address reserved in source is
`Dz9RaTXpp4vadhBS6oT3RPLjqTT4M4RVwfpowjumSJyd`. A read-only Devnet check on
2026-07-19 found no account at that address. Source state is not deployment
evidence, and no v4 deployment, initialization, funding, or keeper enablement
has been authorized.

The previous v3 address
`Apyuy9VZvg7DLcQhe6KGv3sw2MNzriMjtCx2q7zac1QR` is a retired legacy artifact;
its approvals never authorize v4.

Production web publishing remains Git-driven from
`z-korp/zkube-solana:main` to Vercel project
`prj_5kqIxlxgXHXGhldje8unic9h3qYA` under `z-labs`. Feature and archive branches
do not publish production. The JCN exception applies only to Fly Devnet keeper
hosting and must never be copied to Vercel.
