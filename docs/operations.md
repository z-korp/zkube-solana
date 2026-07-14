# Operations

This runbook is Devnet-only and does not authorize a transaction. Program
deploy/upgrade, bootstrap stages, Daily publication, gameplay proofs,
withdrawals, control changes, and every USDC movement require separate approval
for the exact instructions, accounts, signers, cluster, and maximum spend.

## Pinned live Devnet identity

| Item | Value |
| --- | --- |
| Base RPC | `https://rpc.magicblock.app/devnet` |
| Genesis | `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG` |
| Router | `https://devnet-router.magicblock.app/` |
| Program | `5NfTo5ML4UTa6ep4x9d616fyWQYM3CTcpcE5V9P7YUbA` |
| ProgramData | `ALpqN17vyyQr3vuqaHiCAdawtiMniVxK6PzEgPw7P9sB` |
| Upgrade authority | `2so568MdBWj9FMdC1pLQEJtgMo3LpYXFHKZ39GvEgEox` |
| Paymaster | `CNhMPp5p3ViMEzBpeRRjXX1G672rwxHkyNG4gVRN7SgY` |
| Canonical USDC | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |
| Token program | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` |

`STATUS.md` is authoritative for the live slot, deployed hash, allocation, and
the difference between live Devnet and repository source. The current live
binary uses the older account model. The lean Stars source is a breaking
candidate and must never be described as deployed until byte verification is
complete.

## Target custody model

The fresh Stars baseline has exactly three canonical-USDC destinations:

- team destination: external token account, receives 10% of Star sales;
- treasury destination: external token account, receives 80% plus dust;
- reward reserve: program-controlled token account, receives 10% and funds
  bounded Weekly contest vaults.

All are six-decimal legacy SPL Token accounts for the same mint, nonzero, and
pairwise distinct. The paymaster holds SOL for fees and rent; it has no USDC
vault or program allowance. There is no protocol payment vault, treasury
ledger, yield policy, or program-owned treasury principal.

A Star purchase conserves every base unit:

```text
gross = team + rewards + treasury
team = floor(gross × 10%)
rewards = floor(gross × 10%)
treasury = gross - team - rewards
```

Never reconcile custody using floating-point UI values. Read and validate token
account owner, mint, token program, address, and raw amount.

## Offline release gates

```bash
NO_DNA=1 ./validate.sh program
cd client
NO_DNA=1 pnpm idl:check
NO_DNA=1 pnpm exec tsc -b --pretty false
NO_DNA=1 pnpm lint
NO_DNA=1 pnpm exec vitest run
NO_DNA=1 pnpm build
```

These are evidence, not transaction authorization.

Unsigned deployment/upgrade preview:

```bash
cd client
NO_DNA=1 pnpm chain:devnet:deploy
```

Execution still requires an explicit send flag, the exact new approval
fingerprint, sufficient funding, preflight, signature-verified simulation, and
post-deployment byte verification.

Bootstrap preview:

```bash
cd client
NO_DNA=1 pnpm chain:devnet:bootstrap
```

The target stages are:

1. custody: create/verify team, treasury, and reward token accounts and fund the
   SOL paymaster;
2. protocol: initialize the lean `ProtocolConfig` with authority, pricing
   operator, paymaster, destinations, USDC identity, and content version;
3. catalogs: initialize `EconomyConfig`/`StarSalesLedger`, publish Daily rules,
   publish ten gameplay-only map catalogs, then activate the contiguous map
   range. On a reset, publication and activation intentionally appear as two
   dry-run fingerprints: rerun the catalogs preview after publication so the
   compact activation batch can be simulated against accounts that now exist.

Repository source intentionally has no migration-delta or compatibility path.
Existing Devnet accounts may be abandoned/reset, but an upgrade and each
bootstrap stage still need exact separate approval. Verify every account before
proceeding to the next stage.

## Protocol controls

- Pause/unpause is explicit and authority-signed.
- Authority replacement is two-step: propose, then accept by the new authority.
- Pricing operator replacement is authority-signed.
- External team/treasury destinations can change only while paused; the reward
  reserve remains pinned.
- The pricing operator can update the five regular pack prices/enabled flags,
  schedule one bounded sale window, or cancel it.

There is no generic proposal engine or timelock state. Operational process,
multisig policy, and transaction review provide the human control boundary.
Changing a control is always a new exact approval scope.

## Web deployment

The client deploys to Vercel project `zkube-solana` (team `z-labs`), root
`client`, framework Vite, connected to `z-korp/zkube-solana`. Production is
public and preview deployments are team-only.

`api/paymaster.ts` is the serverless relay. Required production secrets are:

- `PAYMASTER_SECRET_KEY` — server-only fee-payer keypair;
- `PAYMASTER_GENESIS_HASH` and `SOLANA_DEVNET_RPC_URL` — cluster pin;
- `ZKUBE_PAYMASTER_PUBLIC_KEY` — secret/public identity self-check.

Never expose the secret through a `VITE_` variable. The relay signs only after
the client/player signature, stateless allowlist validation, cluster check, and
simulation. It rejects Compute Budget instructions and arbitrary system/token
transfers.

## Readiness and monitoring

Run the signer-free probe with a meaningful paymaster threshold:

```bash
cd client
NO_DNA=1 pnpm chain:readiness -- \
  --rpc https://rpc.magicblock.app/devnet \
  --expected-genesis EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG \
  --lookback-days 120 \
  --min-paymaster-lamports <threshold>
```

The probe validates program identity, `ProtocolConfig`, `StarSalesLedger`, all
three token destinations, sale conservation, pause/pending-authority state,
paymaster SOL, Daily PDA/leaderboard relationships, time windows,
attempt/finalization counters, unique/eligible-player counters, and Weekly
rollup completion.

Production monitoring should additionally index Weekly challenges and alert on:

- missing Daily/Weekly opens or finalizers after cadence deadlines;
- unresolved runs after settlement grace;
- Daily eligible results not rolled into Weekly;
- reward-reserve/Weekly-vault mint, authority, and balance drift;
- Star-sale split conservation or any share above 10% team/rewards;
- claimable cash nearing 90-day expiry and unreturned expired funds;
- more than one Mastery award per player/week;
- cash winners missing their independent 30-Star claim;
- players ending at 0–9 Stars and unusual Stars spent per active player-day;
- Router/ER availability, VRF timeout, copyback latency, stale delegation;
- program hash, ProgramData owner/allocation, and upgrade-authority changes.

Browser maintenance is only a fallback. A keeper/indexer must cover every
cadence because no browser is guaranteed online.

## Treasury and yield boundary

The program performs the sale split and then has no authority over the external
team or treasury accounts. It does not calculate, recognize, or distribute
yield. The reward reserve and active Weekly vaults are never treasury capital.

Any future treasury strategy is a separate project and requires an explicit
USDC transfer approval plus reviewed custody, valuation, liquidity, loss,
withdrawal, and emergency controls. Report only realized USDC returned by the
external strategy; never classify balance growth or reward liabilities as
yield. Developer withdrawals from treasury are likewise separate approved USDC
movements, not a program instruction hidden in gameplay.

## Incidents

### Paymaster low balance or compromise

Disable the relay on compromise. For low balance, pause new sponsored prepares
and refill only under an exact approved transfer. A replacement paymaster needs
an explicit protocol control transaction and matching server secret. Verify
browser, relay fee payer, and `ProtocolConfig.paymaster` agree before reopening.

### Program or accounting anomaly

Stop frontend writes and paymaster POST handling. Preserve program hashes,
slots, signatures, raw account bytes, decoded sales/challenge state, and token
balances. Pause only with explicit authority. Do not move or reclassify funds.

### Delegation, VRF, or copyback stall

Stop new runs if failures exceed the threshold. Re-resolve Router status,
validate delegation-record/base/ER owners, inspect session/VRF/action counters,
and retry only bounded transient failures. Never consume or close without
matching owner, run, discriminator, action hash, VRF hash, and durable receipt.

### Daily or Weekly interruption

Do not finalize before the snapshotted cutoff and required rollups. Cancelled
Daily entries refund Stars exactly once. Weekly cash remains in its contest
vault until claimed or returned to the reward reserve after expiry. Treasury
and team destinations are never refund or prize sources.
