# Operations

This runbook is Devnet-only and does not authorize a transaction. Program
deploy/upgrade, bootstrap stages, Daily publication, gameplay proofs,
withdrawals, governance changes, and USDC movement require separate approval for
the exact instructions, accounts, signers, cluster, and maximum spend.

## Pinned Devnet identity

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

The live binary is slot `475787281`, SBF SHA-256
`65e45420574910611285f25bbaa95eb5a69a04f9ea4b8fe1a4880ffba218646e`,
under signature
`3k5JLn49munysN8ripfSUeJK4bB9crTBbSKjRcX1FBekZ92G8gQztmuRpYUG1vvRiRdadTWNPi9LR4kDWrc2xjuF`.
It is 1,596,600 bytes within a 1,604,032-byte allocation.

Repository source contains later hardening and must not be represented as the
live binary. A local SBF is a new candidate. No source change, build, simulation,
old fingerprint, or prior approval authorizes an upgrade.

## Custody identities

- team vault: `8nBxUByKv1PiC7GNzxZYkCBXeLJhg2rVqpobvQeLFivG`
- paymaster reserve: `5HsAQ4ZZ3kExamfCiap6mT88DAmkVW8J7v7s5rBpga8Y`
- treasury: `34gQiFnfFnfav5VmzFg15EqoEBtW2oi25wVNv36TsNAH`
- reward reserve: `FpRj7daRRbcZmGLMHRHpP6qnXuGu8XKABuiNtuBs1oTV`
- map-payment vault: `6x2Qmn4zkCkQa5ZvDhRpHMXPUnRrNoN5k8MdcJKbXgyD`

All five are pairwise-distinct, 165-byte legacy SPL accounts for canonical
Devnet USDC. Amounts are integer base units. Never reconcile custody from
floating-point UI values.

## Evidence summary

Proof JSON and signer material are operator-held ignored files; they are not
shipped in a GitHub clone. The public evidence summary retained in this
repository is the following set of hashes/fingerprints:

| Scope | Approved fingerprint | Sanitized proof SHA-256 |
| --- | --- | --- |
| Initial program deployment | `35b837ec99cde6bb` | `620b14cad362ebbf5fd0ad23075d2da3f673b11f19454e14a1e0a835688c7b3d` |
| Current extend/upgrade | `55a4efd868180f9c` | `fadd75eeaea00adaab6495e91eac5ed99bcac481e671a9447464b5ffffa43ede` |
| Custody bootstrap | `08063b99625c0a82` | `9c1d997f5b2802438db7427024b0589196bd5e7664af76cf98464e4807b6ce82` |
| Protocol bootstrap | `1f6cd8031b2ec13a` | `6f406e909beb2dd826892aef2c7423ab692496ba72e2ac67473b022148957f41` |
| Catalog bootstrap | `d3d34aa2e7528cad` | `52b1570ec370194522e906bd19b8f372c04f253c4620719c6911101b9ffc0c9d` |
| Loader-rent audit | n/a | `f45f08a992fc50ffaba16c2fa826508589886c5714a25bf1de3f422703490a25` |

The initial loader's buffer funded permanent ProgramData rent; that is not a
leaked upload buffer. Upgrade buffers are temporary and must drain/close to the
spill account. Never close a live loader-v3 program to recover ProgramData rent:
its program ID cannot be reused.

## Dry-run and release gates

Static validation:

```bash
NO_DNA=1 ./validate.sh program
NO_DNA=1 ./validate.sh frontend
```

Unsigned deployment/upgrade preview:

```bash
cd client
NO_DNA=1 pnpm chain:devnet:deploy
```

The planner defaults to `upgrade`, hashes `../target/deploy/solana.so`, binds
RPC/genesis, operation, program, signer public identities and command plan, and
sends nothing. Execution additionally requires an explicit send flag, the exact
new approval fingerprint, sufficient funding, preflight, signature-verified
simulation, and postcondition/byte checks.

Bootstrap preview is staged because later accounts depend on earlier ones:

```bash
cd client
NO_DNA=1 pnpm chain:devnet:bootstrap
```

Custody, protocol, and catalogs are already live. Re-running, publishing a new
Daily, or changing governance is a new approval scope.

Production web builds require an approved sanitized manifest:

```bash
cd client
NO_DNA=1 pnpm chain:manifest -- \
  --manifest deployment/approved.devnet.json \
  --artifact ../target/deploy/solana.so \
  --require-approved
```

The manifest is public metadata and must contain no secret, seed, keypair path,
recovery material, or RPC credential. `PAYMASTER_SECRET_KEY` belongs only in the
deployment platform's secret manager. Configure `client` as the web project
root so `api/paymaster.ts` is deployed.

## Readiness and monitoring

Run the signer-free probe with an environment-appropriate paymaster threshold:

```bash
cd client
NO_DNA=1 pnpm chain:readiness -- \
  --rpc https://rpc.magicblock.app/devnet \
  --expected-genesis EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG \
  --lookback-days 120 \
  --min-paymaster-lamports <threshold> \
  --claim-warning-hours 72
```

Schedule it and alert on nonzero exits. Required alerts cover paymaster balance
and identity, policy/simulation/submission failures, protocol/yield pause and
governance events, vault/liability divergence, refunds and claim deadlines,
Router/ER availability, VRF timeouts, copyback latency, stale delegated runs,
treasury/ledger divergence, and program hash/upgrade-authority changes.

### 2026-07-12 paymaster incident

The fee payer fell to about 0.011 SOL and blocked new identities with a raw
simulation error. It was refilled to about 1 SOL; a first run consumes roughly
0.014 SOL. Keep the refill in the incident record, deploy threshold alerting,
surface a friendly unavailable state, and verify the current relay hardening
that rejects all Compute Budget instructions.

## Recovery and incidents

### Paymaster compromise or identity mismatch

Disable the relay endpoint immediately. Prepare and fund a replacement fee
payer without exposing its key, then propose a timelocked
`SetPaymasterPolicy` update with the replacement public key and bounded policy
limits. After the proposal is authorized and executed, cut the endpoint over to
the matching secret. Verify that the browser configuration, relay fee payer and
`ProtocolConfig.paymaster` identity all agree before reopening sponsored
writes. A replacement key has no on-chain sponsorship entitlement until that
policy update completes.

### Legacy run cleanup

The old run for owner `BQNuPSn2oHn9sU9rKA2hdZfDmiMpdwFYX9D9HqvFKTB6`
is copied back but unconsumed. Only the browser holding that embedded identity
can approve the `/?recover=1` envelope. Re-simulate and verify owner/PDA/mode/
lifecycle before requesting approval; after confirmation verify receipt,
progress, close state, and reclaimed rent. Preserve the account if any check
fails.

### Program/accounting anomaly

Stop frontend writes and paymaster POST handling; preserve program hash, slots,
signatures, raw account bytes and decoded ledgers; pause only with explicit
authority; never reclassify or manually move liabilities; reproduce against the
pinned binary; remediation/unpause requires review and timelock.

### Delegation, VRF, or copyback stall

Stop new runs if failures exceed threshold. Re-resolve Router status, verify
delegation-record and ER owners, inspect session/VRF/action counters, retry only
bounded propagation failures, and never consume or close without matching owner,
run, discriminator, action hash and VRF hash.

### Daily interruption

Pause/cancel through program instructions. Do not finalize before all on-time
runs settle or the snapshotted grace cutoff passes. Refund paid principal and
Stars and return sponsor funding through program transitions only. Unclaimed
prizes remain liabilities for 90 days and then route only to reward reserve.

### Yield incident

The policy is disabled and there is no external adapter or executable exit CPI.
If policy state changes unexpectedly, pause immediately, preserve market/
receipt/ledger state, and do not deploy capital until adapter, valuation,
liquidity, loss handling and emergency exit are independently reviewed.
