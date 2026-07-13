# zKube Solana — status

Updated: 2026-07-13 (Europe/Paris). Devnet is the rollout and acceptance
target. Mainnet remains a separate disabled gate.

## Live Devnet

- Base RPC: `https://rpc.magicblock.app/devnet`
- Router: `https://devnet-router.magicblock.app/`
- Program: `5NfTo5ML4UTa6ep4x9d616fyWQYM3CTcpcE5V9P7YUbA`
- ProgramData: `ALpqN17vyyQr3vuqaHiCAdawtiMniVxK6PzEgPw7P9sB`
- Upgrade authority: `2so568MdBWj9FMdC1pLQEJtgMo3LpYXFHKZ39GvEgEox`
- Current deployed slot: `475927355`
- Current deployed SBF SHA-256:
  `e758847493897dccd30fb3bb40adeabdf960d154159d527ad0271766b28382a7`
- Deployed code is 1,600,056 bytes in the 1,604,032-byte allocation; the 3,976
  trailing bytes were independently verified as zero (post-upgrade ProgramData
  dump hashed byte-for-byte to the approved artifact) and the upgrade authority
  was preserved.

This binary **de-gates the per-player daily sponsored-transaction count** in
`SponsorAllowance::consume`: the count is still tracked (saturating) for
telemetry but no longer rejected, so free gameplay/settlement transactions are
no longer capped. This removes the `SponsorshipLimitExceeded`/`6040` that was
stranding runs at "finalizing settlement" once a player crossed the daily free
quota; the paid Daily-attempt (USDC) economic limit and daily rollover are
still enforced. Rent from settled/abandoned runs already returns to the
paymaster (self-sustaining) and the stateless relay bounds abuse by instruction
shape + IP rate limit. Approved fingerprint `885ced2a717ddc12`.

The prior binary added the **seed-row gravity settle**
(`RunEngine::provide_vrf_row` settles after each initial row like Cairo's
`initialize_grid`) — fixing the floating-cubes starting board and the
first-move `InvalidMove`/`6002` divergence (verified live: a fresh run's raw ER
grid is gravity-stable, 0 floating blocks). Fingerprint `e0dac48bfc4feec1`,
slot `475833677` / SBF `8002696d…`. Before that: slot `475813201` / SBF
`89a24c…` (rent-economics close on top of `abandonRunV1`, corrected Magic
Action metas, paymaster hardening).

Contract soundness is a two-pass effort against the original Cairo engine
(`/home/djizus/zkube/contracts/src`): this seed-settle fix is pass 1. Pass 2
(pending) is the full parity sweep — Cairo row shuffle/align and verification
of scoring/combo/difficulty/catalog numbers — with extended
`fixtures/game-parity.json` coverage including initial multi-row seeding.

### Source is newer than the live binary

The repository source may include post-deployment hardening not byte-identical
to the binary above. Any new `target/deploy/solana.so` is a new candidate, not
evidence of what is live. Shipping it requires a fresh dry-run, SBF hash, exact
fingerprint, explicit approval, signature-verified simulation, and
post-deployment byte verification.

## Bootstrap and client

Custody, protocol, and catalogs are live under approved fingerprints:

- custody `08063b99625c0a82` — five segregated canonical-USDC vaults and the
  paymaster;
- protocol `1f6cd8031b2ec13a` — `ProtocolConfig`, `TreasuryLedger`, and a
  disabled yield policy;
- catalogs `d3d34aa2e7528cad` — progress v1 and ten content-v1 maps.

The active product is `client/`. It silently creates a stable embedded
identity, sponsors base fees/rent, signs moves with a scoped ER session,
auto-settles, resumes/recover runs, supports on-chain quit/abandon, and exposes
the embedded Vault for deposits, balances, recovery, and simulation-first
withdrawals. There is no injected-wallet requirement or manual settle button.

The current merge candidate passes 199 client tests across 53 files plus IDL,
strict/chain typechecks, zero-warning lint, and the production build. The
program gate passes 71 Rust tests plus formatting, Clippy, SBF, and IDL.

## Paymaster reserve incident

On 2026-07-12 the paymaster fell to about 0.011 SOL from its original 0.1 SOL.
New-player preparation failed with a raw `Simulation failed … Custom:1`
message. The deployer refilled it to approximately 1 SOL. A fresh identity's
first run costs roughly 0.014 SOL, so the refill is mitigation, not durable
capacity planning.

The relay source now explicitly rejects all Compute Budget program
instructions, including unit-limit and unit-price requests. Client-side
follow-up landed on 2026-07-12: dry-sponsor prepare failures render honest
"sponsored play temporarily unavailable" copy (raw error demoted to a
diagnostic line), the Home banner warns below a configurable reserve
(`VITE_PUBLIC_PAYMASTER_MIN_LAMPORTS`, default 0.05 SOL), and the quit dialog
describes on-chain abandon. Scheduled readiness alerting and web-deployment
verification remain operator tasks.

### Rent economics — live, measured

The rent-economics upgrade is live (slot `475813201`). Cleanup closes all
three run accounts with rent returning to `ProtocolConfig.paymaster`, and one
session token is reused across runs for its whole validity (`zkube:session:v1`,
one-hour reuse margin). Two-run headless measurement on a fresh identity
(2026-07-12):

- Run 1 net paymaster cost: **0.0085 SOL** — includes the one-time
  PlayerProfile, CampaignProgress, and session token that persist.
- Run 2 (recurring) net paymaster cost: **0.00034 SOL** — a ~32× drop from the
  pre-upgrade ~0.011 SOL/run, now essentially fees + the 10k-lamport Magic
  Action top-up.
- Session reuse confirmed (identical keypair across both runs; run 2 prepared
  with no `createSessionV2`). Zero console/page errors.

Board entry ~3–5.4 s, quit→abandon-settled 4.4–12.3 s, all unregressed.
Spectating an already-cleaned run shows the "settled and archived" state.

## Open work

1. **Legacy first-run cleanup.** Owner
   `BQNuPSn2oHn9sU9rKA2hdZfDmiMpdwFYX9D9HqvFKTB6`, run 1, Map 1 Level 1 is
   copied back and `levelComplete`, but its receipt is unconsumed. The explicit
   `/?recover=1` flow builds `consumeSponsorshipV1` +
   `consumeRunReceiptV1` + `closeSettledActiveRunV1`; it simulated at 48,993
   CU. Signing still requires approval for that exact transaction.
2. **Live acceptance.** Repeat multi-move campaign play through durable receipt
   and cleanup from a fresh identity; complete the canonical-USDC Daily
   lifecycle; verify a Vault withdrawal and Recovery Code round-trip. Each
   signed scope is separately approved.
3. **Operations.** Schedule `pnpm chain:readiness` with a meaningful paymaster
   threshold, deploy alert aggregation, and configure the web project root as
   `client`.
4. **Security and launch debt.** Complete independent program/paymaster/
   treasury review, validator/RPC concurrency and failure-recovery evidence,
   production bundle splitting, jurisdiction/terms/age policy, operator and
   pilot-budget decisions.
5. **Yield remains off.** No external adapter, valuation, withdrawal, or
   executable emergency-exit CPI is implemented or authorized.

## Validation

```bash
NO_DNA=1 ./validate.sh program
NO_DNA=1 ./validate.sh frontend
```
