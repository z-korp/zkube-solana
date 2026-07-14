# Architecture

## Product contract

zKube has two authoritative game loops:

- Campaign: ten currently active themed maps of ten levels, with authored
  objectives, fixed map-wide bonus/mutator rules, scores, zero-to-three-Star
  results, and bosses. Protocol state and progress bitmaps reserve capacity for
  32 maps; authority publication plus contiguous activation can add maps in a
  program upgrade without replacing player accounts.
- Daily Arena: an asynchronous 100-move endurance contest with one
  procedurally selected challenge-bonus rule per day. Every move retains its
  normal pressure-adjusted engine score, every generated row uses a fresh
  MagicBlock VRF result, and only a player's best finalized attempt ranks. The
  full scoring pool and pressure profile are in
  [daily-challenge-design.md](daily-challenge-design.md).

Stars are the sole gameplay currency. They are checked `u64` points held in a
`PlayerProfile`, not an SPL token, and cannot be transferred, redeemed, or
traded. Map 1 begins unlocked. Any other active map costs the global 20-Star
zone price and may be bought in any order; Campaign clears and perfection never
unlock another map for free. Every Daily attempt costs 10 Stars, with no free
entry, direct USDC entry, or attempt cap.

USDC is used only to buy Star packs and to pay Weekly cash rewards. Star sales
have no daily purchase cap. A purchase transfers USDC atomically before Stars
are credited: 10% to the team destination, 10% to the program reward reserve,
and the remaining 80% plus integer-rounding dust to treasury. Regular pack
prices, enabled flags, and one scheduled half-open sale window live in
`EconomyConfig` so pricing can change without a program upgrade.

Daily standings produce Weekly points rather than direct cash. Weekly counts a
player's best five of seven days. It snapshots 0–100 USDC from the segregated
reward reserve, with a 10-USDC minimum pool. Cash winners also receive 30 Stars;
the following placement band receives 30/25/20/15/10 Stars. Cash claims expire
after 90 days and unclaimed USDC returns only to the reward reserve.

Progression uses 40,200 finite achievement XP, 1,000 XP plus 20 Stars for each
perfected map, 100 finite level-milestone Stars, a deterministic three-of-nine
Daily quest mix (including a day-specific block-size/count objective) with a
2-Star Finisher, two 500-XP/5-Star Weekly quests, and a level-100 weekly Mastery
faucet of 30 Stars after 2,500 qualifying recurring XP. Full constants and
per-player projections are in [stars-economy-v2.md](stars-economy-v2.md).

## Authority boundaries

| Boundary | Authoritative responsibility |
| --- | --- |
| Solana base | Identity, progression, Stars, content, Daily/Weekly accounting, USDC custody, receipts, leaderboards, and claims |
| MagicBlock ER | One delegated `ActiveRun`: grid, moves, bonuses, score/combo, VRF state, and commitment chains |
| Browser | Decode/render state and orchestrate automatic transactions; never invent game or reward results |
| Paymaster | Validate an allowlisted complete message off-chain, co-sign as fee payer, simulate, and submit |
| Keeper | Reconcile permissionless cadence, rollups, expiry, and rent recovery on a bounded schedule |
| Index/monitoring | Non-authoritative history, alerts, pagination, and analytics |

The paymaster has no on-chain allowance PDA or quota state. Its server policy
pins every sponsored instruction discriminator, account position, signer,
program, session lifetime, and Magic Action top-up bound. The embedded player
identity still signs player-authorized instructions.

## Durable accounts

The lean base-layer state is:

- `ProtocolConfig`: authority and pending authority, pricing operator,
  paymaster, three revenue destinations, payment asset, content version,
  active Campaign map count, and pause.
- `EconomyConfig`: Star sinks, pack quantities/prices/enabled flags, scheduled
  sale, Daily rules version, and Weekly pool bounds.
- `StarSalesLedger`: gross USDC, exact destination shares, Stars sold, and
  purchase count.
- `PlayerProfile`, `CampaignProgress`, `LevelMilestones`, `QuestClaims`, and
  `WeeklyStipend`: identity-bound progression and Star accounting.
- `MapCatalog` and `DailyRulesCatalog`: immutable gameplay snapshots. Each map
  catalog stores one map-wide rule snapshot plus ten compact level-specific
  rows; a Daily catalog contains the
  public season seed, scoring variants, and pressure profile. Zone pricing
  comes from the economy.
- Daily and Weekly challenge/player/leaderboard accounts, plus the segregated
  Weekly USDC vault.
- `RunShell`, `ActiveRun`, and `RunReceipt` for each in-flight or durably
  settled run.

There is no generic governance proposal engine, timelock account, sponsorship
allowance, progress catalog, treasury ledger, protocol payment vault, yield
policy, or yield adapter in the program. Changes use explicit instructions:
pause/unpause, propose/accept authority, set pricing operator, and update the
external team/treasury destinations while paused. Any external treasury investment or yield strategy
is outside this program and cannot touch active reward liabilities.

Completed contest accounts are explicitly recyclable. A Daily player record
can close only after all attempts durably settle and its Weekly rollup (or its
cancelled-entry refund), and the
Daily challenge/leaderboard close only after every player record closes. A
Weekly non-winner can close at finalization; a winner remains until every
applicable Star/USDC claim is complete or the 90-day window closes. The Weekly
vault and aggregate accounts close only after the vault is empty, all player
records and all seven Daily aggregates are gone, and rent always returns to
`ProtocolConfig.paymaster`.

The active Campaign map count advances only one map at a time and only after
that enabled catalog is published. This prevents holes in the client-visible
map range while retaining a 32-map account layout. Catalog content itself is
hardcoded in the publication client; the removed procedural Campaign generator
is not an authority source.

### Campaign map identities

| Map | Bonus trigger | Bonus | Start | Scoring/passive identity |
| ---: | --- | --- | ---: | --- |
| 1 | Clear 3+ lines in one move | Wave | 1 | Stars 10% easier; 4 rows |
| 2 | Clear exactly 2 lines in one move | Hammer | 1 | ×1.25 score, +10 perfect; Stars 5% easier; 5 rows |
| 3 | Clear 3+ lines in one move | Totem | 1 | ×1.5 combo, +1/line; 4 rows |
| 4 | Perfect clear after move/bonus, max one charge between moves | Hammer | 1 | ×1.25 score, +15 perfect; 5 rows |
| 5 | Every 15 cumulative lines cleared by player moves | Wave | 1 | +1/line; 6 rows |
| 6 | Destroy at least one block of every size in one move | Totem | 1 | ×1.5 combo, +10 perfect; 5 rows |
| 7 | Clear exactly 3 lines in one move | Hammer | 1 | ×1.75 score; 5 rows |
| 8 | Perfect clear after move/bonus, max one charge between moves | Wave | 2 | ×2 combo; 6 rows |
| 9 | Cross each 8-point Combo Meter boundary, max one charge/action | Totem | 1 | ×2 combo, +1/line; 6 rows |
| 10 | Clear exactly 4 lines in one move | Hammer | 1 | ×1.5 score, ×2 combo, +20 perfect; Stars 5% harder; 7 rows |

The score order is `(base × score multiplier + line bonus) × combo multiplier
+ perfect-clear bonus`. A bonus-created perfect clear scores and can earn its
map reward, consumes the buffered preview row, clears the preview, and returns
to VRF hydration without spending a move.

All identities are canonical PDAs. Versions and amounts are fixed-width
integers. Token math uses six-decimal USDC base units, checked arithmetic, and
conservation equations.

## Base → Router → ER → base

1. On base, validate protocol/content/player/mode prerequisites and create the
   `RunShell`, `ActiveRun`, and `RunReceipt`. Daily entry burns 10 Stars first.
2. The off-chain paymaster validates and sponsors the exact setup message. The
   owner grants a scoped, expiring session authority for the run.
3. Ask the MagicBlock Router for the closest validator and delegate
   `ActiveRun` on base.
4. Resolve `getDelegationStatus` and use its returned `fqdn`; never hardcode a
   regional ER endpoint.
5. On the ER, request fresh scoped VRF for each row. Owner or bound session-key
   actions validate counters, phase, coordinates, rules, and grid legality.
   Daily records engine, challenge-bonus, combined Daily, and pressure scores.
6. Seal a terminal projection, then commit and undelegate. Base-only Magic
   Action targets stay read-only in the outer ER instruction.
7. Verify copyback owner, discriminator, run identity, lifecycle, action hash,
   and VRF hash. Consume the durable receipt idempotently and update Campaign
   or Daily state. The first finalized Daily attempt records 100 recurring XP;
   the first tier-7 finish that day records another 50 recurring XP.
8. Close transient run accounts only after durable receipt/postcondition
   evidence. ER success alone is never permission to delete evidence.

Quit marks a nonterminal run abandoned with zero rewards, then follows the same
automatic commit, receipt, and cleanup path. Gameplay is not approval-gated in
the shipped client.

## Autonomous cadence and owner claims

The source includes a Vercel cron route scheduled every five minutes. Each pass
scans authoritative PDAs and reconciles missing current Daily/Weekly opens,
due Daily finalizers, outstanding Daily-to-Weekly rollups, due Weekly
finalizers, expired cash, and every eligible cleanup. It is bounded to eight
writes and 210 seconds by default. Every transition is permissionless,
state-checked, and idempotent, so the next pass catches missed delivery and
duplicate delivery cannot double-award or double-close. Browser maintenance
remains a fallback, not the cadence authority.

Weekly cash/Star claims and cancelled-Daily refunds still require the embedded
owner identity. The client scans all outstanding owner records and signs up to
four silent claims/refunds on each visit; there is no claim button or operator
step. Claim-bearing accounts remain open until that succeeds or the applicable
claim window expires.

## Routing, decoding, and randomness invariants

- Keep base, Router, and resolved-ER connections separate.
- Treat RPC data as untrusted: validate cluster genesis, address/PDA, owner,
  length, discriminator, embedded relationships, and version before decoding.
- Derive delegation identities through the pinned MagicBlock SDK.
- Retry only bounded transient propagation, cloner, and blockhash failures.
- Accept VRF callbacks only for the expected queue, run, rules, and request
  counter. Browser randomness is never valid for rewards-bearing play.
- Preserve unsettled run state until copyback and durable receipt evidence.

## Identity and custody

The client silently creates a device-local embedded Solana identity. Recovery
Code export/restore is the cross-device recovery path; recovery material never
leaves the browser through logs, analytics, proofs, or server requests.
External wallets may fund the displayed Vault address without connecting.

The payment asset is six-decimal canonical Devnet USDC using the legacy SPL
Token program. Team and treasury destinations are external token accounts. The
reward reserve is program-controlled because Weekly opens must transfer a
bounded pool into a contest vault. All three are mint-matched and pairwise
distinct. Star purchases perform all three transfers before crediting Stars;
any transfer failure aborts the whole purchase.
