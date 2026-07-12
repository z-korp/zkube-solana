# zKube Solana — status

Updated: 2026-07-12 (Europe/Paris). Devnet is the rollout and acceptance
target. Mainnet remains a separate disabled gate.

## Live Devnet

- Base RPC: `https://rpc.magicblock.app/devnet`
- Router: `https://devnet-router.magicblock.app/`
- Program: `5NfTo5ML4UTa6ep4x9d616fyWQYM3CTcpcE5V9P7YUbA`
- ProgramData: `ALpqN17vyyQr3vuqaHiCAdawtiMniVxK6PzEgPw7P9sB`
- Upgrade authority: `2so568MdBWj9FMdC1pLQEJtgMo3LpYXFHKZ39GvEgEox`
- Current deployed slot: `475787281`
- Current signature:
  `3k5JLn49munysN8ripfSUeJK4bB9crTBbSKjRcX1FBekZ92G8gQztmuRpYUG1vvRiRdadTWNPi9LR4kDWrc2xjuF`
- Current deployed SBF SHA-256:
  `65e45420574910611285f25bbaa95eb5a69a04f9ea4b8fe1a4880ffba218646e`
- Deployed code is 1,596,600 bytes in a 1,604,032-byte allocation; the 7,432
  trailing bytes were independently verified as zero. The stable upload buffer
  closed and the upgrade authority was preserved.

This binary includes `abandonRunV1` and the corrected campaign/Daily Magic
Action account metas. The approved extend/upgrade fingerprint was
`55a4efd868180f9c` and the public sanitized-proof hash is
`fadd75eeaea00adaab6495e91eac5ed99bcac481e671a9447464b5ffffa43ede`.

### Source is newer than the live binary

The repository source includes post-deployment hardening and is no longer
byte-identical to the binary above. Any new `target/deploy/solana.so` is a new
candidate, not evidence of what is live. Shipping it requires a fresh dry-run,
SBF hash, exact fingerprint, explicit approval, signature-verified simulation,
and post-deployment byte verification. **No program upgrade is authorized by
the source changes or this documentation cleanup.**

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
program gate passes 70 Rust tests plus formatting, Clippy, SBF, and IDL.

## Paymaster reserve incident

On 2026-07-12 the paymaster fell to about 0.011 SOL from its original 0.1 SOL.
New-player preparation failed with a raw `Simulation failed … Custom:1`
message. The deployer refilled it to approximately 1 SOL. A fresh identity's
first run costs roughly 0.014 SOL, so the refill is mitigation, not durable
capacity planning.

The relay source now explicitly rejects all Compute Budget program
instructions, including unit-limit and unit-price requests. Remaining incident
follow-up is scheduled readiness alerting, a friendly sponsorship-unavailable
client state, verification of the updated web deployment, and correction of
stale quit-dialog copy.

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
