# zKube Solana — status

Updated: 2026-07-13 (Europe/Paris). Devnet is the rollout and acceptance
target. Mainnet remains a separate disabled gate.

## Live Devnet

- Base RPC: `https://rpc.magicblock.app/devnet`
- Router: `https://devnet-router.magicblock.app/`
- Program: `5NfTo5ML4UTa6ep4x9d616fyWQYM3CTcpcE5V9P7YUbA`
- ProgramData: `ALpqN17vyyQr3vuqaHiCAdawtiMniVxK6PzEgPw7P9sB`
- Upgrade authority: `2so568MdBWj9FMdC1pLQEJtgMo3LpYXFHKZ39GvEgEox`
- Current deployed slot: `475941320`
- Current deployed SBF SHA-256:
  `1cf8f3d17ce7ab109b1df4b8df1620d77e5014947cd7a366adcb0b1117790119`
- Deployed code is 1,599,912 bytes in the 1,604,032-byte allocation; the 4,120
  trailing bytes were independently verified as zero (post-upgrade ProgramData
  dump hashed byte-for-byte to the approved artifact) and the upgrade authority
  was preserved.

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

### Source is newer than the live binary

The repository source may include post-deployment hardening not byte-identical
to the binary above. Any new `target/deploy/solana.so` is a new candidate, not
evidence of what is live. Shipping it requires a fresh dry-run, SBF hash, exact
fingerprint, explicit approval, signature-verified simulation, and
post-deployment byte verification.

The current source candidate is a breaking, lean Stars baseline described in
`docs/stars-economy-v2.md`: non-transferable Star packs, 20-Star zones, 10-Star
unlimited Daily entries, 40,200 achievement XP, Daily-quest XP, two 5-Star
Weekly quests, level-100 weekly Mastery, cash-winner Stars, permissionless Daily
and Weekly automation, best-five Weekly scoring, claims, and 90-day reserve
return. Daily is now neutral endless play with a public-seed procedural season:
seven scoring families, 14 variants, independent pressure tiers, featured-score
ranking, and engine/moves/time tie-breaks. Star purchases split USDC atomically
10% team, 10% rewards, and 80% plus dust treasury. There is no compatibility
migration path; Devnet state may be reset. It is **not deployed or initialized**.

The validated local SBF is 1,583,736 bytes (SHA-256
`623cbcb22da4d2141cb70af28a7b3a3e2c28d9c86cc8f4c3ed7988e9f0e451e2`),
20,296 bytes below the live 1,604,032-byte ProgramData allocation. A separately
approved upgrade, fresh three-destination bootstrap, and acceptance run are
still required.

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

The previously deployed/client work is merged to `main`. The lean Stars source
is a new local candidate. Program gates pass: 74 active Rust tests, formatting,
warnings-denied Clippy, optimized SBF/IDL generation, and diagnostic scan. One
additional ignored 896-run Daily tuning harness found no stuck nonterminal
boards. The generated IDL contains 46 instructions and 19 account types. Client
gate counts are 56 test files and 223 tests, with IDL parity, typecheck, lint,
and production build all passing.

The candidate Campaign is now fully authored rather than generated: ten active
maps use one fixed mutator/bonus identity across each map, compact per-level
rows, exact approved difficulty tables, corrected theme IDs, and the revised
perfect-clear/Combo Meter mechanics. Accounts reserve 32-map capacity and
`ProtocolConfig.campaign_map_count` exposes a contiguous activated catalog
range. Map 1 remains free; maps 2–32 use the global 20-Star price in any order,
with no previous-boss or free-perfection unlock path. This schema intentionally
requires the planned Devnet reset; it has not been deployed or bootstrapped.

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

1. **Live acceptance.** Repeat multi-move campaign play through durable receipt
   and cleanup from a fresh identity; complete the canonical-USDC Daily
   lifecycle; verify a Vault withdrawal and Recovery Code round-trip. Each
   signed scope is separately approved.
2. **Operations.** Schedule `pnpm chain:readiness` with a meaningful paymaster
   threshold and deploy alert aggregation. (Web project root is now `client` on
   the live Vercel `zkube-solana` project.)
3. **Security and launch debt.** Complete independent program/paymaster/
   treasury review, validator/RPC concurrency and failure-recovery evidence,
   production bundle splitting, jurisdiction/terms/age policy, operator and
   pilot-budget decisions.
4. **Yield remains external and off.** No adapter, valuation, withdrawal, or
   executable strategy CPI is implemented or authorized. Reward liabilities
   are never treasury capital.
5. **Lean Stars rollout.** Complete review and instruction-level integration
   tests, then separately approve the upgrade, fresh account bootstrap, and
   Devnet acceptance. No lean economy account is currently live.

## Validation

```bash
NO_DNA=1 ./validate.sh program
NO_DNA=1 ./validate.sh frontend
```
