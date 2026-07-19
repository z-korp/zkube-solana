# zKube Arcade on Solana

zKube is a wallet-native skill arcade for the Solana dApp Store and Seeker.
The v4 loop is intentionally small:

> Practice free. Pay SOL to enter. Win today's pot. Stay consistent to take
> the weekly jackpot.

The connected Solana address is the player identity. There are no embedded
wallets, recovery codes, deposits, soft currencies, passes, prize claims, or
server-held player funds. v4 is Devnet-only until legal, economic, and
distribution review approves a mainnet release.

## Product model

- Campaign is free, unlocks Arena after Map 1, and retains XP, achievements,
  titles, ratings, and perfect-map emblems.
- Yesterday's Arena rules are replayable free as unranked Practice.
- Every ranked Arena run is owner-approved and costs exactly 0.02 SOL.
- Each entry routes 75% to that Daily pot, 15% to operator revenue, and 10% to
  the current Weekly jackpot.
- Daily settlement pushes SOL to the top five at 45/25/15/10/5.
- Weekly settlement pushes SOL to the top three at 60/25/15.
- XP, quests, achievements, and profile status never grant SOL, entries,
  prize eligibility, or mint odds.

Campaign ratings are status, not currency. The words Cube and Star refer only
to gameplay pieces and Campaign ratings respectively; neither is a spendable
balance.

## Runtime boundaries

| Boundary | Responsibility | Authority and funding |
| --- | --- | --- |
| Owner wallet | Durable identity, enablement, paid Arena entry | Owner signs the exact entry payment |
| Device session | Approximately seven days of safe play | Never authorizes native-SOL entry spending |
| Player funding PDA | Reusable account-rent float | Owner-funded; signs only narrow self-CPI wrappers |
| MagicBlock ER | Active gameplay and per-row VRF | Gasless play on a Router-resolved validator |
| Solana program | Progression, entry accounting, boards, pots, settlement | Base-layer authority |
| Fly keeper | Cadence opening, recovery, settlement, rollup, cleanup | Independent bounded signer |
| Static PWA/TWA | Wallet and gameplay UI | No server signer or paymaster |

The player funding PDA is System-owned and has zero data. It may pay only the
rent required by exact zKube wrappers for Campaign, Arena, Practice, delegation,
and per-player rollup accounts. It is not a wallet and cannot forward arbitrary
instructions. The owner still signs and transfers every 0.02 SOL Arena entry.

Solana base, the MagicBlock Router, and the resolved ER are separate
connections. ER placement is discovered with `getDelegationStatus`; regional
endpoints are never hardcoded.

## Runs and replay verification

`PlayerState.active_run_id` permits one active run per owner across devices. A
run is prepared on base, delegated, played on the ER, committed after reaching a
terminal state, copied back, and consumed atomically. Consumption updates
progression, clears the durable pointer, and recycles ActiveRun rent.

Arena uses the existing 15-rule, seven-family rotation. Opening rows and future
rows use fresh verified VRF values. Practice reuses yesterday's challenge and
rules, but not an identical row sequence; “would have ranked” comparisons are
distributional against yesterday's finalized board.

Every run folds canonical actions into a rolling replay hash bound to the
challenge, rule revision, player, and run. A best Arena commitment remains on
the permanent Daily board. Move lists stay off-chain and may be independently
recomputed; losing a move list does not invalidate authoritative settlement.

## Cadence and settlement

Days are fixed UTC windows. Weeks contain seven Daily cadences and start on
Monday UTC. Entry and run-close boundaries are deterministic timestamps, so a
keeper outage cannot extend play or change an outcome.

Settlement is push-only and always completes, even when late:

- A Daily waits until every paid entry has resolved as finalized, refunded, or
  expired, then pays its winners.
- Fewer than five Daily winners renormalize the active weights; division dust
  goes to the last paid rank.
- An empty Daily rolls its complete pot into the same Weekly jackpot.
- Weekly finalization waits for all seven Dailies and their player rollups.
- Fewer than three Weekly winners renormalize similarly.
- An empty Weekly rolls its complete jackpot into the next open week.
- Profile finish synchronization is a separate idempotent operation and can
  never block a payout.

Daily ranking is score descending, bonus triggers descending, engine score
descending, moves ascending, terminal timestamp ascending, then wallet bytes.
Weekly score sums the seven Daily band awards from each player's best run:

| Daily band | Weekly points |
| --- | ---: |
| Top 1%, capped at rank 3 | 100 |
| Top 5%, capped at rank 10 | 60 |
| Top 10%, capped at rank 20 | 30 |
| Top 25%, capped at rank 50 | 10 |
| Remaining scoreable result | 2 |

The denominator is the number of players with a scoreable result. Weekly ties
use total bonus triggers descending, then the earliest timestamp at which the
player completed their final tied score.

## Refund solvency and incidents

An entry creates a full 0.02 SOL unresolved-run liability in the operator
revenue vault. The vault must collateralize all liabilities before another
entry is accepted, and withdrawals preserve both those liabilities and the
fixed 1 SOL reserve. Finalization, refund, or expiry releases the liability
exactly once. Prize pots are never used for refunds.

Ordinary abandoned runs expire after the recovery window. When an operator
failure provably prevented scoring, protocol authority may declare that Daily
an incident once, after recovery attempts and before the six-hour declaration
window closes. The declaration fixes its cap to every unresolved entry at that
moment; those entries receive exactly 0.02 SOL from operator funds. Incident
declaration is governance, never part of the keeper's recurring write grant.

The accounting invariant is:

```text
runs_finalized + entries_refunded + entries_expired == entries_paid
```

## Progression

Daily quests are deterministically selected, eligibility-filtered, and always
free-completable through Campaign or Practice. Weekly quests always contain
five-day attendance plus two distinct eligible candidates from the gameplay
pool. Claims are the only quest XP faucet. Weekly completion grants XP and a
crest; consecutive crests are status only.

No progression state participates in SOL settlement. Permanent cadence boards
remain the source for permissionless best-finish synchronization and compact
public profiles.

## Keeper safety model

The rewritten keeper is deliberately staged. Its executable discovery currently
covers only current Weekly and Daily opening, one instruction per transaction.
It already enforces the v4 program/account boundary, simulation-derived spend
checks, pass limits, and reserve floor. The remaining release work is to add
bounded discovery and exact account layouts, in this order: terminal run
recovery, unresolved-entry refund/expiry, Daily settlement, Daily-to-Weekly
rollup, Weekly settlement, profile synchronization, accumulator cleanup, and
expired session cleanup. None of those operations is admitted by the current
policy allowlist yet.

A write-enabled release is pinned to Devnet genesis, the exact deployed
ProgramData hash, keeper signer, current/recent cadence PDAs, instruction
allowlist, account layouts, and release fingerprint. Each pass permits at most
eight writes, at most two expired-session closures, 0.05 SOL simulated spend,
and preserves a 0.1 SOL keeper balance. Governance, funding, withdrawals,
incident declaration, deployment, and mainnet are outside the recurring grant.

v4 is not currently deployed. Keeper writes therefore remain fail-closed until
a deployment and separately fingerprinted keeper release are explicitly
approved.

### Devnet release order

A fresh protocol initializes paused. The release must then deploy and verify
the exact SBF, publish the initial rules and Campaign maps, initialize Arcade
and its 1 SOL operator reserve, verify every PDA and relationship read-only,
deploy the fully reconciliating keeper in read-only mode, and only then bundle
protocol unpause with initial keeper write enablement. Opening paid Arena play
before terminal recovery, refund/expiry, settlement, and rollup discovery are
present in the keeper is prohibited.

## Development and validation

```bash
NO_DNA=1 ./validate.sh program
cd services
NO_DNA=1 pnpm install --frozen-lockfile
NO_DNA=1 pnpm run build
NO_DNA=1 pnpm test
```

The client has its own IDL, typecheck, lint, test, and production-build gates.
The checked-in generated IDL is the ABI handoff between the program and client.

## Deployment status and legacy v3

The v4 program address is
`Dz9RaTXpp4vadhBS6oT3RPLjqTT4M4RVwfpowjumSJyd`. A read-only Devnet query on
2026-07-19 returned no account at that address; source state is not a deployment
record and no v4 bootstrap or funding has been authorized.

The previous v3 deployment remains a retired, separate legacy artifact at
`Apyuy9VZvg7DLcQhe6KGv3sw2MNzriMjtCx2q7zac1QR`. Its last approved Devnet keeper
bundle recorded image
`sha256:bbea0f6ed6104c12ef8138e0723c7a9a1447c459f7244e27c5011aa573d8bb2e`,
release fingerprint `af24e318cb41cf69`, and catch-up fingerprint
`29f46b444b8af47528185841fac98eae700245d2dcd72da920fbbf9542e6f01d`.
Those identifiers document v3 only; they never authorize v4 writes or provide
a reusable approval.

Production web deployment remains Git-driven from `z-korp/zkube-solana:main`
to the z-korp Vercel project. The temporary JCN Fly exception applies only to
the Devnet keeper and must not be copied to Vercel.
