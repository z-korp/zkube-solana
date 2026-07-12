# Architecture

## Product contract

zKube has two authoritative game loops:

- Campaign: ten themed maps of ten levels, each with authored objectives,
  bonuses, mutators, combos, scores, zero-to-three Stars, and a boss.
- Daily Arena: an asynchronous endless contest where every generated row comes
  from a fresh MagicBlock VRF result. Only a player's best finalized attempt is
  ranked.

Map 1 begins unlocked. Clearing it enables Daily Arena. Perfecting a map unlocks
the next map; otherwise the player may spend Stars or canonical USDC. Stars are
non-transferable program-account points, not an SPL token. The 24 achievements
award 6,700 non-spendable XP and no Stars. Rotating Daily quests issue at most 5
Stars/day and Weekly quests 10/week. Canonical paid unlock tiers are 2/5/10 USDC
and 40/100/200 Stars; a paid Daily attempt is initially 1 USDC.

Daily entry funding splits 90% prize liability and 10% rake. Rake routes 25% to
team, up to 25% to the paymaster reserve, and the remainder to treasury.
Finalized prizes remain claimable for exactly 90 days; only the explicit
post-deadline transition may move unresolved liability to the segregated reward
reserve.

## Authority boundaries

| Boundary | Authoritative responsibility |
| --- | --- |
| Solana base | Identity, progression, Stars, catalogs, Daily entries/accounting, USDC custody, receipts, leaderboards, claims, governance, treasury |
| MagicBlock ER | One delegated `ActiveRun`: grid, visible row, moves, bonuses, score/combo, VRF state and commitment chains |
| Browser | Decode/render state and orchestrate transactions; never invent authoritative game or reward results |
| Paymaster | Statelessly validate a complete allowlisted message, co-sign as fee payer, simulate and submit |
| Index/monitoring | Non-authoritative history, alerts, pagination and analytics |

Sponsorship quotas live in the per-player `SponsorAllowance` PDA. The relay has
no quota database, gameplay authority, custody authority, or player key.

## Durable accounts

The principal base-layer accounts are `ProtocolConfig`, `GovernanceProposal`,
`TreasuryLedger`, disabled-by-default `YieldStrategyPolicy`, `PlayerProfile`,
`ProgressCatalog`, `QuestClaims`, `CampaignProgress`, versioned map catalogs,
`RunShell`, `RunReceipt`, `DailyChallenge`, `DailyPlayer`, and the bounded Daily
leaderboard. Identities are canonical PDAs; versions and amounts are fixed-width
integers; token math uses base units and checked conservation equations.

`ActiveRun` contains only the state needed to execute and prove one campaign or
Daily attempt: owner/run/mode/rules identity, 10x8 grid, next row, score and
objectives, bonuses/mutators, VRF counters, rolling action/VRF hashes, and final
projection. There is no reusable global game account or hidden future-row
sequence. A run settles at most once.

## Base → Router → ER → base

1. On base, validate protocol/catalog/player/mode prerequisites and prepare
   `RunShell`, `ActiveRun`, `RunReceipt`, and any Daily authorization.
2. The paymaster validates and sponsors the exact setup shape. The owner grants
   a scoped, expiring session authority for the bound run.
3. Ask the MagicBlock Router for a validator and delegate `ActiveRun` on base.
4. Poll Router `getDelegationStatus`; use its returned `fqdn`, never a hardcoded
   regional endpoint. A valid delegation is owned by the delegation program on
   base and by zKube on the resolved ER.
5. On the ER, request fresh scoped VRF for each row. Owner or bound session key
   actions validate counters, phase, coordinates, rules, and grid legality.
6. Seal a terminal projection. Commit and undelegate from the ER. Base-only
   Magic Action targets remain read-only in the outer ER instruction and become
   writable only inside the base `CallHandler`.
7. Verify copyback owner, discriminator, run identity, lifecycle, action hash,
   and VRF hash. Consume the durable receipt idempotently and update campaign or
   Daily state.
8. Close transient state only after durable receipt/postcondition evidence.
   Interrupted cleanup resumes from persisted markers; ER success alone is not
   permission to delete evidence.

Quit uses `abandonRunV1`: a nonterminal run becomes terminal with zero campaign
Stars, then follows the same consume/cleanup pipeline. Settlement and recovery
are automatic product behavior, not manual operator steps.

## Routing, decoding, and randomness invariants

- Keep base, Router, and resolved-ER connections distinct.
- Treat every RPC account as untrusted: validate cluster genesis, address/PDA,
  owner, length, discriminator, embedded relationships, and version before
  decoding.
- Derive delegation PDAs through the pinned MagicBlock SDK, not copied seeds.
- Retry only bounded transient propagation/cloner/blockhash failures. Do not
  retry deterministic program, signer, owner, layout, or counter errors.
- Accept VRF callbacks only from the expected queue/identity for the pending
  request counter. Domain-separate randomness by program/run/request/rules.
- Never use browser fallback randomness for rewards-bearing play.

## Identity, custody, and governance

The client silently creates a device-local embedded Solana identity. Recovery
Code export/restore is the cross-device recovery path; recovery material never
leaves the browser through logs, analytics, proofs, or server requests. External
wallets fund the displayed Vault address without connecting to zKube.

Protocol v1 pins canonical Devnet USDC
`4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`, six decimals, and legacy SPL
Token program `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`. Team, paymaster,
treasury, reward, payment, and per-contest custody are segregated. Active prize
liabilities never enter treasury or yield.

Sensitive policy changes are timelocked; emergency pause is immediate and
unpause is delayed. Yield policy starts unconfigured and deposits disabled.
There is no adapter CPI or authority to classify arbitrary balance growth as
yield.
