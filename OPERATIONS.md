# zKube Solana Operations

This runbook covers the versioned zKube reboot program, MagicBlock lifecycle, segregated USDC custody, and stateless fee-payer relay. Devnet is the rollout target and follows cycling-sim's base-RPC -> Router-selected validator -> Router-resolved ER flow. This document does not authorize a transaction or deployment. Mainnet is a separate disabled approval gate.

## Deployment identity

Every environment must pin:

- the base RPC and expected genesis hash;
- the exact zKube program ID and built SBF SHA-256;
- MagicBlock delegation, Magic program/context, Router, and VRF identities;
- the paymaster endpoint and the paymaster public key stored in `ProtocolConfig`;
- payment mint, token program, and all configured vault addresses;
- governance authority/multisig, delay, and execution window.

The browser checks the base genesis, executable program account, protocol account version/discriminator/PDA, and advertised paymaster identity before building a sponsored transaction. The relay independently checks its RPC genesis before signing. A mismatch is a hard failure, not a warning.

Use [client/.env.example](client/.env.example) as the public configuration inventory. `PAYMASTER_SECRET_KEY` is server-only secret-manager material. Never place a real key in an env file, repository, proof artifact, browser bundle, issue, or chat.

The web deployment root is `client`. Its sole `vercel.json` uses the
locked install, builds the Vite application, and exposes `api/paymaster.ts` as
the stateless server function. A repository-root deployment is invalid because
the nested API route would not be discovered. Validate the deployed `/api/paymaster`
identity response against `ProtocolConfig.paymaster` before enabling writes.

Production web builds run `pnpm deploy:build` and require an approved sanitized
deployment manifest. The manifest binds the base RPC/genesis, Router policy,
SDK Magic/VRF identities, exact program/SBF hash, six-decimal SPL payment mint,
five distinct vaults, paymaster public identity/endpoint, governance timing,
and content/progress/strategy versions. The build compares all provided browser,
server, and operations environment values and fails on any mismatch. It never
reads or records the paymaster secret; runtime initialization independently
derives its public key and rejects a secret that does not match
`ZKUBE_PAYMASTER_PUBLIC_KEY`.

```bash
cd client
NO_DNA=1 pnpm chain:manifest -- \
  --manifest deployment/approved.devnet.json \
  --artifact ../solana/target/deploy/solana.so \
  --require-approved
```

The program deployment proof is not a complete runtime manifest. No approved
runtime manifest exists until the Devnet protocol, canonical-USDC vaults,
catalogs, governance, and paymaster identities have been initialized and their
separate approval gate has completed. Candidate manifests cannot authorize a
transaction. Mainnet is excluded from schema version 1 and requires a new
reviewed schema plus explicit approval.

## Validation gates

Read-only/static gate:

```bash
NO_DNA=1 ./validate.sh program
cd client
NO_DNA=1 pnpm idl:sync
NO_DNA=1 pnpm idl:check
NO_DNA=1 pnpm exec tsc -b --pretty false
NO_DNA=1 pnpm lint
NO_DNA=1 pnpm exec vitest run
NO_DNA=1 pnpm build
```

`.github/workflows/static-validation.yml` reproduces the locked Rust host and frontend/IDL gates without secrets. It deliberately has no deploy, signer, RPC, or transaction step. The SBF/Anchor stack-diagnostic gate still runs through `NO_DNA=1 ./validate.sh program` in a pinned release environment until the Agave/Anchor installation image is itself reproducibly pinned and reviewed.

Unsigned Devnet deployment/upgrade preview:

```bash
cd client
NO_DNA=1 pnpm chain:devnet:deploy
```

The preview hashes `solana.so`, binds the exact Devnet RPC, declared program ID,
deployment operation, signer public identities, and planned commands, and sends
nothing. The current default is `upgrade` because `5NfTo5...YUbA` is live;
`initial` must be selected explicitly for a new identity migration.
`ZKUBE_DEPLOY=1` is insufficient by itself: the runner also requires
`ZKUBE_DEPLOY_APPROVAL` to equal the current fingerprint, verifies Devnet
genesis, deployer funding, and deployed upgrade authority, keeps preflight
enabled, and verifies the executable program account afterward. Never reuse
approval after the SBF, signer public identities, RPC, operation, or command
plan changes.

Deployed initial-program custody:

- Program identity: `5NfTo5ML4UTa6ep4x9d616fyWQYM3CTcpcE5V9P7YUbA`.
- One-time Devnet fee payer: cycling-sim deployer
  `7WFy4QkiUx9GZHkVz3wdWJbdMgMf6gtK8JnbWDYqZDRA`.
- Resumable program buffer: `9B7UqsDYTG9m2cVSDDTf4N79bGQmWMC6ZcKccknNd6bw`.
- Dedicated zKube upgrade authority:
  `2so568MdBWj9FMdC1pLQEJtgMo3LpYXFHKZ39GvEgEox`.

The cycling-sim signer is reused only as the Devnet loader fee payer; it
does not receive zKube upgrade authority. The zKube program and authority
signers live only in the ignored `.devnet/` operator directory with `0600`
permissions. The stable buffer signer makes a failed upload recoverable rather
than stranding a random CLI buffer. The initial 1,593,792-byte artifact required
11,093,996,400 lamports of permanent ProgramData rent. The current 1,592,248-byte
artifact requires an 11,083,250,160-lamport temporary upgrade buffer; the runner
additionally requires 50,000,000 lamports of fee headroom before entering the
deploy path.

The initial deployment finalized at slot `475536003` with signature
`bkhBvwRimF6xQHLbMDt5ULcQfb4sghbraK7Jdw4a3gS3t6sT3WNobDsyL5httCWBFxNVEzfHmj6k4aSb7uRCwKj`.
On-chain ProgramData `ALpqN17vyyQr3vuqaHiCAdawtiMniVxK6PzEgPw7P9sB`
matches release SHA-256
`1a6f1dd87811eabf7213433e3d49e104212e19b76df67cb6a3828d8a8c15161a`
byte-for-byte. The sanitized proof SHA-256 is
`620b14cad362ebbf5fd0ad23075d2da3f673b11f19454e14a1e0a835688c7b3d`.

### Loader rent: initial deployment versus upgrade

Do not treat permanent ProgramData rent as a failed-buffer leak. On an initial
loader-v3 deployment, the funded buffer is drained into the newly created
ProgramData account. While the program remains live, those lamports remain its
rent-exempt balance. On an upgrade, ProgramData already exists, so the temporary
upload buffer is drained to the spill/deployer account after the new code is
copied and the buffer closes.

The transaction evidence is explicit:

- zKube initial deployment `bkhBvw...wKj`: buffer `9B7U...d6bw` moved from
  11.0939964 SOL to zero while new ProgramData `ALpq...P9sB` moved from zero to
  11.0939964 SOL.
- cycling-sim upgrade `2dXMVY...Ci9G`: buffer `HnEd...rBGY` moved from
  7.46427288 SOL to zero while deployer `7WFy...ZDRA` rose from 1.508778348 to
  8.973046201 SOL; its existing ProgramData remained funded.
- zKube upgrade `2wrqVq...BR5t`: buffer `9B7U...d6bw` moved from 11.08325016
  SOL to zero while the deployer rose from 0.090279441 to 11.173519601 SOL in
  the finalization transaction. Across upload plus finalization, net spend was
  only 0.01741 SOL.

Before declaring rent stuck, query `solana program show --buffers` for both the
deployer and upgrade authority, inspect the stable buffer address directly, and
trace the ProgramData and buffer transaction histories. Never close a live
loader-v3 program to recycle ProgramData rent: its Program ID cannot be reused.
The complete sanitized comparison is
`artifacts/devnet-loader-rent-audit.proof.json`.

Bootstrap identities originated in
`artifacts/devnet-bootstrap-identities.candidate.json`: dedicated zKube
governance `HmCG...HQ5b`, paymaster `CNhM...7SgY`, proof player
`8M3o...qxv5`, and five pairwise-distinct canonical-USDC vault identities. The
cycling-sim deployer funded the approved custody stage only. The five vaults and
paymaster funding are now live; protocol, catalogs, and the proof player remain
separate stages. Local signer files are ignored, mode `0600`, and never appear
in public artifacts.

The Devnet bootstrap runner follows cycling-sim's dry-run-first custody model:

```bash
cd client
NO_DNA=1 pnpm chain:devnet:bootstrap
```

The `custody` stage was approved under fingerprint `08063b99625c0a82` and
completed on Devnet. It created five empty, segregated canonical-USDC token
accounts and funded the stateless paymaster with 100,000,000 lamports. Total
account/paymaster funding was 110,196,400 lamports across six confirmed
transactions; no USDC moved. All vaults were independently verified as
165-byte legacy SPL Token accounts for canonical Devnet USDC. The sanitized
execution proof is `artifacts/devnet-bootstrap.custody.proof.json` with SHA-256
`9c1d997f5b2802438db7427024b0589196bd5e7664af76cf98464e4807b6ce82`.

After custody is live, run the separate `protocol` stage; after protocol is
live, run `catalogs`. Each stage produces a new fingerprint, performs unsigned
Devnet simulations, and requires separate approval. A partial stage is
re-probed and only missing accounts are planned; mismatched existing custody
fails closed.

The protocol stage completed under fingerprint `1f6cd8031b2ec13a` at slot
`475566455`, signature `3QSTSmi8...K8ME`. Protocol `EsJD...AvER`, treasury
ledger `91T5...bmWV`, and disabled yield policy `5P1b...s6qB` are all owned by
the zKube program with their expected 433/202/194-byte layouts. The exact spend
was 8,452,480 lamports and no token moved. Sanitized proof SHA-256 is
`6f406e909beb2dd826892aef2c7423ab692496ba72e2ac67473b022148957f41`.

The `catalogs` stage completed under fingerprint `d3d34aa2e7528cad` in eleven
confirmed transactions. Progress v1 decodes to 24 achievements, 6,700 XP, zero
achievement Stars, and the exact 1/1/1/+2 Daily plus 5/5 Weekly quest rewards.
All ten content-v1 maps are enabled with ten levels and canonical 0/40/100/200
Star plus 0/2/5/10 USDC tiers. Every catalog is owned by zKube with its expected
748-byte progress or 453-byte map layout. Exact spend was 46,644,560 lamports;
no token moved. Sanitized proof SHA-256 is
`52b1570ec370194522e906bd19b8f372c04f253c4620719c6911101b9ffc0c9d`.

The first browser run uses embedded owner `BQNu...KTB6`, Router-resolved EU ER
`https://devnet-eu.magicblock.app/`, and ActiveRun `8GWt...p6m`. It reached
`levelComplete` at score 10 after six moves with no pending VRF callback. Seal
simulates successfully on that ER. Commit reproduced `InvalidWritableAccount`
for base `RunShell` `FoPu...54yy9`; the same outer-writable mismatch existed in
both campaign and Daily commit contexts. The corrected contexts keep all
base-only Magic Action targets read-only until `CallHandler`, matching
cycling-sim. The rebuilt 1,592,248-byte SBF has SHA-256
`d075288f0c7776ed50dad38cb770ea4e2c6f277b2049b8a6336cd69b87336636`.

The fix was deployed under approved fingerprint `21ef11168ed0fe45` at slot
`475577726`, signature `2wrqVqv9...BR5t`. Program `5NfTo5...YUbA`, authority
`2so5...gEox`, deployer `7WFy...ZDRA`, stable buffer `9B7U...d6bw`, preflight,
and corrected SBF were revalidated immediately before send. The temporary
buffer held 11,083,250,160 lamports before loader finalization and zero after;
it is closed and the deployer finished with 11,173,519,601 lamports. The final
transaction consumed 2,370 CU, transferred no token, and preserved the upgrade
authority. Independent ProgramData decoding hashes the first 1,592,248 code
bytes to `d075288f...6636`; all remaining 1,544 allocation bytes are zero.
Sanitized evidence is `artifacts/devnet-program-upgrade.proof.json`.

The preserved run's exact commit now simulates on the Router-resolved EU ER at
55,849 CU with no error. The only outer writable accounts are payer, delegated
ActiveRun, and Magic context. Router/base checks after simulation prove the run
remained delegated and the simulation scheduled no real commit. Actual
owner-signed commit/undelegate, base copyback, receipt, and cleanup remain the
last lifecycle proof steps.

For local browser testing against Devnet, Vite serves the same stateless
`/api/paymaster` handler used by the deployed function:

```bash
cd client
PAYMASTER_KEYPAIR_PATH=../.devnet/zkube-paymaster.json \
ZKUBE_PAYMASTER_PUBLIC_KEY=CNhMPp5p3ViMEzBpeRRjXX1G672rwxHkyNG4gVRN7SgY \
NO_DNA=1 pnpm dev --host 127.0.0.1
```

The path-based signer option is development-only and is rejected in production;
production continues to require secret-manager `PAYMASTER_SECRET_KEY`.

The browser uses a cycling-sim-style embedded identity, not Phantom. On first
launch it creates a stable device-local zKube Vault identity. Settings exposes
the deposit address, canonical-USDC/SOL balances, Recovery Code export/restore,
and explicit simulation-first SOL/USDC withdrawal. Users fund paid play by
sending assets to that address from any external wallet or exchange; zKube never
connects to the external wallet. The
complete lifecycle and recovery invariants are in `MAGICBLOCK.md`.

Read-only treasury/readiness probe (RPC must be explicit; non-local RPCs also require an expected genesis):

```bash
cd client
NO_DNA=1 pnpm chain:readiness -- \
  --rpc https://rpc.magicblock.app/devnet \
  --expected-genesis EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG \
  --lookback-days 120 \
  --min-paymaster-lamports <environment-threshold> \
  --claim-warning-hours 72
```

The command has no signer, persistence, or transaction path. It validates treasury/yield identities plus recent derived Daily challenge, leaderboard, and token-vault accounts; reconciles actual vault balances to recorded liabilities; reports stale runs, refunds, claims/forfeitures, and paymaster SOL; emits JSON to stdout; and exits `0` when clear, `1` for warnings, and `2` for a critical condition or invalid deployment identity. Vault deficits are critical while unsolicited surplus tokens are warnings. It may be run read-only against Devnet now; until protocol initialization, missing protocol/vault identities are expected to prevent a clear readiness result.

Schedule this command from the deployment platform and alert on nonzero exits. The paymaster function separately emits one payload-free JSON event per request with an outcome category (`policy_rejected`, `cluster_mismatch`, `simulation_failed`, `submission_failed`, or `submitted`). Alert aggregation may retain those logs, but it is never sponsorship entitlement or gameplay state.

Devnet program deployment is complete. Devnet protocol bootstrap and each
gameplay proof remain separate exact-fingerprint approvals. Gameplay
transactions must simulate with signature verification before submission and
produce a sanitized proof artifact. A local developer run neither grants nor
substitutes for Devnet approval. Mainnet requires an additional written launch
approval and is currently rejected by the tooling.

## Custody invariants

Before and after any financial operation, verify from program-owned accounts and mint-matched token accounts:

- Daily deposits equal prizes, rake, refunds, and remaining liabilities.
- The payment mint has six decimals and uses the canonical SPL Token program; protocol v1 rejects Token-2022 extensions. Team, paymaster, treasury, reward, and payment vault addresses are pairwise distinct.
- Active or unexpired prize liabilities remain in the contest vault.
- Rake distributions equal team plus paymaster plus treasury distributions.
- Map revenue swept never exceeds lifetime map sales.
- Strategy deposits equal outstanding principal plus repaid principal plus realized losses.
- Processed yield equals reward allocation plus treasury-retained yield and never exceeds realized yield.
- Forfeited prizes enter only the reward reserve after the 90-day claim deadline.

Amounts are integer token base units. Do not reconcile with floating-point UI values.

## Incident actions

### Program or accounting anomaly

1. Stop frontend write actions and paymaster POST handling.
2. Submit the immediate authority/multisig protocol-pause instruction if signing is authorized.
3. Preserve RPC responses, signatures, slots, program hash, account bytes, and decoded ledger snapshots.
4. Do not transfer custody manually or mark liabilities as revenue.
5. Reproduce against the pinned binary and a fork/local environment.
6. Remediation and unpause require review plus the governance timelock.

### Paymaster compromise or mismatch

1. Disable the relay endpoint. On-chain allowances prevent a replacement key from consuming sponsorship until governance updates `ProtocolConfig.paymaster`.
2. Prepare and fund a replacement fee payer without exposing its key.
3. Propose `SetPaymasterPolicy` with the new public key and bounded limits/cap.
4. After the timelock, execute the proposal and cut the endpoint over to the matching key.
5. Confirm browser, relay, and protocol identities agree before reopening sponsored writes.

The relay keeps no durable or process-local gameplay quota. Edge throttling may protect infrastructure, but cannot grant or consume sponsorship entitlement.

### MagicBlock delegation, VRF, or copyback stall

1. Stop starting new runs if failures exceed the alert threshold.
2. Read the Router delegation record and resolve the ER endpoint again; never trust a cached endpoint after reconnect.
3. Inspect `ActiveRun` lifecycle, pending VRF counter, request/callback commitments, session expiry, and base `RunShell`.
4. Use bounded retry only for documented cloner/propagation lag. Do not replay an action with a different expected counter.
5. Do not consume a receipt until owner, run ID, action hash, VRF hash, discriminator, and program ownership match.
6. Preserve unsettled run accounts until an audited recovery/cancellation transition is available.

### Daily contest interruption

1. Prevent new entries through the authority cancellation or protocol pause path as appropriate.
2. Never finalize early while an on-time attempt can still settle unless the snapshotted grace cutoff has elapsed.
3. A cancelled contest refunds paid principal, reverses the Stars spend, and returns sponsor funding through program instructions only.
4. Distribute rake only after finalization and only from accrued rake.
5. Unclaimed finalized prizes remain liabilities for exactly 90 days; forfeiture is permissionless only after the deadline and routes to the reward reserve.

### Yield strategy incident

1. Invoke the immediate yield pause: new deposits become disabled and `emergency_exit` is raised.
2. Do not clear the emergency flag, change adapter identity, or classify a token balance increase as yield while principal is outstanding.
3. Verify the strategy accounting identity and preserve receipt-token/market/reserve state.
4. The current program intentionally has no external adapter or executable exit CPI. No capital may be deployed until the selected adapter, valuation, withdrawal, loss handling, and emergency exit are implemented and reviewed.

## Required production monitoring

Production launch remains blocked until alerts exist for:

- protocol/yield pause changes and governance proposal creation/execution/cancellation;
- paymaster balance, identity mismatch, rejected shapes, simulation failures, and allowance exhaustion;
- contest vault versus liability divergence, refund backlog, claim deadline, and forfeiture;
- Router/ER unavailability, VRF timeout rate, copyback latency, and stale delegated runs;
- treasury vault/ledger divergence, strategy exposure/liquidity limits, realized loss, and unallocated yield;
- deployed program hash or upgrade-authority changes.

Alerting and indexing are non-authoritative views. Incident decisions must re-read and validate the canonical accounts.
