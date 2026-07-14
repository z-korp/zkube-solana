# zKube Solana — status

Updated: 2026-07-14 (Europe/Paris). Devnet is the rollout and acceptance
target. Mainnet remains a separate disabled gate.

## Live Devnet

- Base RPC: `https://rpc.magicblock.app/devnet`
- Router: `https://devnet-router.magicblock.app/`
- Program: `5NfTo5ML4UTa6ep4x9d616fyWQYM3CTcpcE5V9P7YUbA`
- ProgramData: `ALpqN17vyyQr3vuqaHiCAdawtiMniVxK6PzEgPw7P9sB`
- Upgrade authority: `2so568MdBWj9FMdC1pLQEJtgMo3LpYXFHKZ39GvEgEox`
- Current deployed slot: `476217217`
- Current deployed SBF SHA-256:
  `dd187f69f8c0c3cfb3fcdb9366c5af88a948a27e41ac26e6db3a1d4fc6268be5`
- Deployed code is 1,716,784 bytes. The post-upgrade ProgramData dump matched
  the approved artifact byte-for-byte with no trailing payload, and the upgrade
  authority was preserved. Upgrade signature:
  `2RPsjCL8Pb7XvzKks4gMtTB2EHmGonM1Q1Gjvb7mD8yjdcvV7eecDwW7YKJQRSZsph1sWWbZf12Hfi4FZHgGSZdh`.

This binary fixes **swipe/bonus block-boundary parity for adjacent same-width
blocks**. `Grid::swipe` used to reject moving any but the first block of a
same-width run (`cells[start-1]==size` merged e.g. a trailing `1 1` into one
block), so sliding the second of two adjacent width-1 blocks — legal on the
client and in the Cairo engine — was rejected on-chain as `InvalidMove`/`6002`
(confirmed live: `gridsEqual:true`, client board matched the ER exactly, only
the geometry check diverged). `block_start` (Hammer/bonus targeting) had the
same flaw. Both now resolve blocks via `block_left_edge()` greedy packing
(width-N block = N consecutive N-cells), matching Cairo's `check_row_coherence`
+ block-by-column swipe and the client's `transformDataContractIntoBlock`.
Interior-of-a-wider-block and empty-cell selections are still rejected. No IDL
change. Approved fingerprint `ecd694f0177d8566`.

The prior binary **de-gated the per-player daily sponsored-transaction count**
in `SponsorAllowance::consume` (count still tracked saturating for telemetry,
no longer rejected) — removing the `SponsorshipLimitExceeded`/`6040` that
stranded runs at "finalizing settlement"; the paid Daily-attempt (USDC) limit
and daily rollover stay enforced. Fingerprint `885ced2a717ddc12`, slot
`475927355` / SBF `e758847…`.

Before that, one binary added the **seed-row gravity settle**
(`RunEngine::provide_vrf_row` settles after each initial row like Cairo's
`initialize_grid`) — fixing the floating-cubes starting board and the
first-move `InvalidMove`/`6002` divergence (verified live: a fresh run's raw ER
grid is gravity-stable, 0 floating blocks). Fingerprint `e0dac48bfc4feec1`,
slot `475833677` / SBF `8002696d…`. Before that: slot `475813201` / SBF
`89a24c…` (rent-economics close on top of `abandonRunV1`, corrected Magic
Action metas, paymaster hardening).

Contract soundness is an ongoing parity effort against the original Cairo engine
(`/home/djizus/zkube/contracts/src`). Fixed so far: seed-row gravity settle, and
swipe/bonus block-boundary detection for adjacent same-width blocks. Still
pending is the full parity sweep — Cairo row shuffle/align and verification of
scoring/combo/difficulty/catalog numbers — with extended
`fixtures/game-parity.json` coverage including initial multi-row seeding and
same-width-run move cases.

### Lean Stars baseline is live

The deployed program is the breaking, lean Stars baseline described in
`docs/stars-economy-v2.md`: non-transferable Star packs, 20-Star zones, 10-Star
unlimited Daily entries, 40,200 achievement XP, 20-Star/1,000-XP map perfection,
a deterministic three-of-nine Daily quest mix with 2-Star Finishers, two
500-XP/5-Star Weekly quests, a deterministic Block Breaker size/count variant,
level-100 weekly Mastery, cash-winner Stars, permissionless Daily and Weekly
automation, best-five Weekly scoring, claims, and 90-day reserve return. Daily
is now neutral 100-move endurance play with a public-seed procedural season:
seven scoring families, 15 weighted bonus variants, combined engine-plus-bonus
Daily scoring, independent pressure tiers, no absolute-time tie-break, 100 XP
for the first finish, and 50 XP for the first tier-7 finish that day. Star
purchases split USDC atomically 10% team, 10% rewards, and 80% plus dust
treasury. There is no compatibility migration path; Devnet state may be reset.

The program also contains four permissionless contest-cleanup
instructions. They preserve unsettled Daily attempts, rollups, refunds, and
every Weekly winner claim while returning eligible Daily/Weekly player,
leaderboard, challenge, and empty vault rent to the paymaster. The client source
adds a bounded five-minute Vercel keeper, silent all-history owner
claims/refunds, structured base/Router/ER/VRF/Magic-Action/paymaster logs, and a
signer-free Devnet cost report. The Vercel keeper secrets are installed, but
`KEEPER_ENABLED=false` until the new client deployment is live and a separate
approval enables autonomous writes.

The one-time reset closed 141 incompatible program-owned accounts and returned
316,993,200 lamports to the paymaster. The reset entrypoint is permanently
unreachable against the new `ProtocolConfig` size. Twelve legacy delegated run
accounts remain outside base-layer program ownership; fresh run IDs start at
`2 << 32`, so they cannot collide with the new generation.

## Bootstrap and client

Fresh custody, protocol, economy, Daily rules, and all ten campaign maps are
live under separately approved fingerprints:

- reset `899180fad26f2c41` — removed the incompatible Devnet generation;
- custody `036eb845d33ff109` — three segregated canonical-USDC destinations and
  a paymaster balance of exactly 1.5 SOL;
- protocol `d6f6dd2f2c8a59b6` — the lean `ProtocolConfig` with no treasury
  ledger, yield policy, or payment vault;
- economy `11a6dba882eca219` — `EconomyConfig` and `StarSalesLedger`;
- Daily rules `1b9c26c9015e91b8` — immutable scoring catalog v1;
- maps `882aead7984e19d0` — ten authored content-v1 map accounts;
- activation `af8a01d43bf6b64e` — contiguous active campaign range 1–10,
  signature `2HsoYvXgjBjzaM3eGKCVowBCgz4x71JiWcNG8jPFaWGheeiBjcbr6sERbsGoGtDDmsLcHercqeL8KjNJKk9AcVBG`.

The live three-way USDC destinations are team
`8nBx66VUXcn3Snm9ZbGhNChz3KDVYhE3EnSs9HuQFivG`, treasury
`9E69kpXv6qrkBgJvJGr2s7NWji6W9voSJibYn8vy8Fxu`, and reward reserve
`FpRj2mAWFg4DtCvXGAM1dHb3FLiQYKJ8HctndwKH1oTV`. Each is owned by the expected
external governance identity or protocol PDA, uses canonical Devnet USDC, and
currently holds 0 USDC.

The active product is `client/`. It silently creates a stable embedded
identity, sponsors base fees/rent, signs moves with a scoped ER session,
auto-settles, resumes/recover runs, supports on-chain quit/abandon, and exposes
the embedded Vault for deposits, balances, recovery, and simulation-first
withdrawals. There is no injected-wallet requirement or manual settle button.

The board is a **pure renderer of the chain**: the client never computes board
state. `reconcileBlocksToGrid` rebuilds the visible board from the authoritative
grid on every receipt, reusing block ids so persisting blocks tween to their new
positions and the inserted floor row rises in — so the visible board is always
cell-for-cell the chain board and a drag can never send coordinates the program
rejects. The prior client ran a local physics simulation (gravity/clears + a
client-side next-line insert) that could diverge from the Rust engine when the
VRF next row was still hydrating, splitting the board and causing repeated
`InvalidMove`/`6002`. Do not reintroduce client-side game simulation.

Moves are **animation-led**: the client plays the full local cascade (gravity →
line clears → the new row rising in) at a pleasing pace while the transaction
settles on-chain in the background; the held receipt reconciles as a visual
no-op once the animation finishes, and the level-complete overlay waits for that
cascade to end. VRF-row readiness (post-move) and the settlement copyback are
driven by **websocket account subscriptions** (`onAccountChange` via
`awaitAccountCondition`, reusing the `PersistedRunWatcher` pattern) instead of
polling, with a slow poll only as a dropped-socket fallback.

The prior client remains live until this deployment commit reaches `main` and
Vercel finishes its production build. Final release gates pass: 81 active Rust
tests (one offline Daily tuning harness ignored), formatting, warnings-denied
Clippy, optimized SBF/IDL generation, and diagnostics; the generated IDL has 51
instructions and 19 account types. Client IDL parity, typechecking, strict lint,
production build, and 57 test files / 232 tests all pass.

The Campaign is fully authored rather than generated: ten active
maps use one fixed mutator/bonus identity across each map, compact per-level
rows, exact approved difficulty tables, corrected theme IDs, and the revised
perfect-clear/Combo Meter mechanics. Accounts reserve 32-map capacity and
`ProtocolConfig.campaign_map_count` exposes a contiguous activated catalog
range. Map 1 remains free; maps 2–32 use the global 20-Star price in any order,
with no previous-boss or free-perfection unlock path. The active Devnet catalog
exposes all ten maps. Additional maps up to the reserved 32-map capacity need
content publication plus activation, but not a new program address.

### Web deployment (Vercel)

Live at `https://zkube-solana.vercel.app` — project `zkube-solana` (team
`z-labs`), root `client`, framework Vite, git-connected to `z-korp/zkube-solana`
and auto-deploying on push to `main`. Build is plain `pnpm run build` (the
former `deploy:build` approved-manifest gate is dropped for the web build);
production is public, preview is team-only. `PAYMASTER_SECRET_KEY` (+
`PAYMASTER_GENESIS_HASH`, `SOLANA_DEVNET_RPC_URL`, `ZKUBE_PAYMASTER_PUBLIC_KEY`)
are set in the project's secret store; `/api/paymaster` returns the paymaster
pubkey. No `VITE_PUBLIC_*` program vars are set, so the client uses its
hard-coded devnet config (a stale program-id override previously failed the
IDL/program-address check). See `docs/operations.md` → Web deployment.

The dedicated keeper identity `6JuZiVic8yUipamYyzWvVUcTdD8kbpdpv79CBGjm4XTg`,
cron secret, eight-write pass bound, and 1.5 SOL reserve floor are installed as
server-only production variables. `KEEPER_ENABLED=false` remains the final
safety gate until the new production deployment is verified and autonomous
writes receive their separate approval.

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
(`VITE_PUBLIC_PAYMASTER_MIN_LAMPORTS`, candidate default 1.5 SOL), and the quit
dialog describes on-chain abandon. Deploying the new readiness/keeper source
and verifying its production logs remain rollout tasks.

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

A signer-free confirmed probe after the reset/bootstrap on 2026-07-14 found
exactly **1.5 SOL** in the paymaster. The reclaimable-working-capital model
recommends 0.740649216,
0.994285920, 1.417013760, and 3.530652960 SOL for fresh cohorts of 1, 10, 25,
and 100 active players respectively (seven Daily generations, thirteen claim
weeks, winner retention, observed fresh-player durable cost, and 20%
contingency). The initial source default is therefore a **1.5 SOL warning
floor** for the 25-player scenario. The current balance meets that floor.

The post-reset read-only report sampled the latest 100 paymaster signatures:
84 successful and 16 failed historical attempts. Successful transactions used
0.0012258 SOL in base fees, sent 0.24584016 SOL to rent/escrow, and returned
1.1044368 SOL (including the reset and 0.5815256 SOL top-up), for a net
0.85817664 SOL inflow. Historical instructions outside the current IDL remain
conservatively labelled `magicblock_or_system`.

## Open work

1. **Live acceptance.** Repeat multi-move campaign play through durable receipt
   and cleanup from a fresh identity; complete the canonical-USDC Daily
   lifecycle; verify a Vault withdrawal and Recovery Code round-trip. Each
   signed scope is separately approved.
2. **Operations rollout.** Deploy the client candidate, then separately approve
   `KEEPER_ENABLED=true` and verify five-minute `keeper_*`, `paymaster_request`,
   and `run_metric` logs. Secrets, schedule, write bound, and the 1.5 SOL floor
   are installed; autonomous writes remain disabled.
3. **Security and launch debt.** Complete independent program/paymaster/
   treasury review, validator/RPC concurrency and failure-recovery evidence,
   production bundle splitting, jurisdiction/terms/age policy, operator and
   pilot-budget decisions.
4. **Yield remains external and off.** No adapter, valuation, withdrawal, or
   executable strategy CPI is implemented or authorized. Reward liabilities
   are never treasury capital.
5. **Reward reserve.** The canonical-USDC reward reserve is valid but empty.
   Funding it is a separately approved USDC movement; the treasury/yield adapter
   remains intentionally external and off.

## Validation

```bash
NO_DNA=1 ./validate.sh program
NO_DNA=1 ./validate.sh frontend
```
