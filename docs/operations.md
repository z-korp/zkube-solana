# Operations

This runbook is Devnet-only and does not authorize a transaction. Program
deploy/upgrade, bootstrap stages, Daily publication, gameplay proofs,
control changes, and every USDC movement require separate approval
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
bootstrap fingerprints. The lean Stars binary and fresh account generation are
live on Devnet. A later local build is still only a candidate until its exact
bytes are separately approved and verified after deployment.

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

The deployment payer and upgrade-authority keypair stay in the local operator
environment. Fly receives only the runtime paymaster signer in the relay app
and the runtime keeper signer in the keeper app; neither Fly app may contain a
deployer, program-buffer, protocol-authority, or upgrade-authority secret.

If the candidate is larger than the live ProgramData capacity, preview the
allocation change separately:

```bash
cd client
NO_DNA=1 pnpm chain:devnet:extend
```

The extension has its own payer, authority, byte delta, rent, and approval
fingerprint. The upgrade command always includes `--no-auto-extend` and refuses
to run while allocation is undersized, so an upgrade approval can never hide a
ProgramData extension. Execute and verify an approved extension first, then
generate a fresh, separately approved upgrade fingerprint.

Bootstrap preview:

```bash
cd client
NO_DNA=1 pnpm chain:devnet:bootstrap
```

The stages are deliberately separate so every state-changing batch has its own
simulation and approval fingerprint:

1. custody: create/verify team, treasury, and reward token accounts and fund the
   SOL paymaster;
2. protocol: initialize the lean `ProtocolConfig` with authority, pricing
   operator, paymaster, destinations, USDC identity, and content version;
3. economy: initialize `EconomyConfig` and `StarSalesLedger`;
4. daily-rules: publish the immutable Daily scoring catalog;
5. maps: publish the ten gameplay-only map catalogs;
6. activation: activate the contiguous map range only after all map accounts
   have been fetched and validated.

Select one with `ZKUBE_BOOTSTRAP_STAGE=<stage>`. Never combine approvals across
stages. The bootstrap is idempotent: an already complete stage verifies live
state and produces no transaction.

The one-time Devnet reset tool is separately dry-run-first:

```bash
cd client
NO_DNA=1 pnpm chain:devnet:reset
```

It snapshots every candidate account and data hash, accepts at most sixteen
program-owned accounts per batch, and is usable only while the exact legacy
433-byte `ProtocolConfig` exists under the expected authority/paymaster. Closing
that config disables the instruction permanently for the fresh generation.

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

## Web and Fly service deployment

Vercel project `zkube-solana` (team `z-labs`, root `client`) serves only the
static Vite/PWA build. `vercel.json` has no functions or cron. The production
browser calls
`https://zkube-solana-devnet-paymaster.fly.dev/api/paymaster` directly; its
service worker never caches relay or chain responses.

The services are isolated in two CDG apps:

- `zkube-solana-devnet-paymaster` — one always-warm HTTP Machine, with
  `/healthz`, chain-aware `/readyz`, a strict browser-origin allowlist, a 4 KiB
  raw-body ceiling, eight concurrent submissions, and no volume;
- `zkube-solana-devnet-keeper` — one non-public restart-always worker, no
  volume, no HTTP service, and one non-overlapping pass every five minutes.

Both build from `client/Dockerfile.fly`, using `fly.paymaster.toml` and
`fly.keeper.toml`. Validate and build before deployment:

```bash
cd client
NO_DNA=1 pnpm run server:build
docker build -f Dockerfile.fly -t zkube-fly-services:local .
fly config validate --strict -c fly.paymaster.toml
fly config validate --strict -c fly.keeper.toml
```

Required paymaster secret:

- `PAYMASTER_SECRET_KEY` — the existing fee-payer keypair, installed only
  through Fly's secret manager.

The public key, RPC, genesis, origins, and concurrency cap are non-secret
values pinned in `fly.paymaster.toml`; startup refuses a secret/public mismatch.
Never expose the secret through a `VITE_` variable or place it in a file,
command transcript, image layer, keeper app, or repository. The relay signs
only after the required owner or scoped-session signature, stateless allowlist
validation, live SessionTokenV2 owner/actor/target/expiry validation, cluster
check, and simulation. It rejects Compute Budget instructions, arbitrary
system/token transfers, substituted payers, cross-owner sessions, and
session-signed Star purchases.

The Seeker release wraps the production PWA in a Trusted Web Activity with
application ID `com.zkorp.zkube`. Seed Vault Wallet is the required Mobile
Wallet Adapter 2.0 acceptance wallet. Generate `/.well-known/assetlinks.json`
from the reviewed release certificate with `pnpm twa:configure-links`; keep the
keystore and store credentials external. Complete real-device and desktop
acceptance before producing the signed APK.

The keeper requires only `KEEPER_SECRET_KEY`; its public identity, paymaster
public identity/HTTPS endpoint, cluster, interval, eight-write bound, and 1.5
SOL reserve floor are pinned in `fly.keeper.toml`. `PAYMASTER_SECRET_KEY` must
not exist in the keeper app. The worker verifies the RPC genesis/program and
the relay's advertised public identity before each pass. It discovers work
from current chain state, uses on-chain one-way transitions and counters, and
awaits each pass before scheduling another. A restart or later pass safely
catches interrupted work.

`KEEPER_ENABLED=false` is committed in the Fly config. Deploy and observe the
disabled worker first. Changing it to true is a separate autonomous-write
approval and must happen only after the breaking program/IDL is live. Keep
exactly one worker Machine; do not scale it horizontally as an availability
substitute for restart recovery.

After a human transfers the two existing runtime signer secrets without
exposing them and the breaking program is live, deploy the paymaster first,
verify `/healthz`, `/readyz`, and GET `/api/paymaster`, then deploy the disabled
keeper. The static client is already public for the maintenance interval. Only
after Fly acceptance should the legacy paymaster/keeper secrets and cron
configuration be removed from the Vercel project.

Use `fly deploy --ha=false` for each initial deployment and verify one Machine
per app afterward. The paymaster drains HTTP for up to 30 seconds on SIGTERM;
the keeper receives a 240-second shutdown window so an in-flight bounded pass
can finish without starting another.

Normal operation needs no publication or operator transaction. The keeper
opens the current Daily/Weekly, finalizes elapsed challenges, completes all
Daily rollups, forfeits expired cash to the reward reserve, and reclaims rent.
Weekly winner claims and cancelled-Daily refunds are session-signed silently on
the next client visit; their accounts remain intact until claim/refund or
expiry. Publishing a new Daily rules catalog remains an explicitly approved
content/governance action and is not part of routine cadence.

## Readiness and monitoring

Run the signer-free probe. The default low-balance floor is 1.5 SOL and can be
overridden explicitly:

```bash
cd client
NO_DNA=1 pnpm chain:readiness -- \
  --rpc https://rpc.magicblock.app/devnet \
  --expected-genesis EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG \
  --lookback-days 120
```

The probe validates program identity, `ProtocolConfig`, `StarSalesLedger`, all
three token destinations, sale conservation, pause/pending-authority state,
paymaster SOL, Daily PDA/leaderboard relationships, time windows,
attempt/finalization counters, unique/eligible-player counters, and Weekly
rollup completion.

The report also projects reclaimable rent working capital for fresh cohorts of
1, 10, 25, and 100 active players. The model retains seven Dailies, one active
Weekly player set, thirteen Weekly aggregates/cash-winner sets, the observed
fresh-player durable cost, and 20% contingency:

| Fresh active players | Recommended minimum |
| ---: | ---: |
| 1 | 0.740649216 SOL |
| 10 | 0.994285920 SOL |
| 25 | 1.417013760 SOL |
| 100 | 3.530652960 SOL |

These are working-capital scenarios, not a promise of DAU or a permanent cost:
eligible contest rent returns to the paymaster. The 1.5 SOL floor is the first
operating target for the 25-player scenario; revisit it using measured account
mix and claim latency.

Generate an actual Devnet payer-cost sample without a signer:

```bash
cd client
NO_DNA=1 pnpm chain:devnet:cost-report -- --limit 100
```

The JSON groups transactions by current-IDL operation and reports base fees,
paymaster net delta, rent/escrow outflow, and rent refunds. Historical
instructions that do not match the current IDL are deliberately labeled
`magicblock_or_system`; do not invent a classification from account position.

Runtime logs are newline JSON with `schemaVersion: 1`:

- `run_metric`: one browser trace across Solana base, Router resolution,
  resolved ER, VRF request/callback, commit/undelegate, Magic Action copyback,
  and final base cleanup; includes durations, endpoints, and signatures;
- `paymaster_request`: policy/simulation/submission outcome, sponsored
  operation, units consumed, duration, and submitted signature;
- `keeper_readiness`, `keeper_operation`, and `keeper_pass`: reserve status,
  per-transition duration/signature, bounded writes, failures, and backlog.

Filter a complete flow by browser `traceId`, then correlate browser and server
events by transaction signature. Never put recovery material, signer bytes,
raw transaction payloads, RPC credentials, or environment values in logs.
Compare actual settlement cost with MagicBlock's current public-node pricing;
their published model charges at session close/commit rather than for each ER
move: <https://docs.magicblock.gg/pages/overview/additional-information/pricing>.

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
