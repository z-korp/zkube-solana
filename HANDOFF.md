# zKube Solana — Global Agent Handoff

Updated: 2026-07-11 (Europe/Paris)

This handoff is the entry point for the next agent. Read it before acting, then
read `IMPLEMENTATION.md`, `MAGICBLOCK.md`, and `OPERATIONS.md`. The repository is
mid-migration with a large intentional dirty worktree; do not reset, restore,
or delete unrelated changes.

## User intent and non-negotiable decisions

- Fully port zKube from `/home/djizus/zkube` to Solana + MagicBlock.
- Always use `/home/djizus/cycling-sim` as the implementation and operational
  reference for MagicBlock, Devnet deployment, Router resolution, embedded
  identity, paymaster, settlement, recovery, and proof artifacts.
- Devnet is the rollout and acceptance target. Localhost is optional diagnostics
  only. Mainnet requires a new explicit approval.
- The client silently creates an embedded Solana identity. Phantom, injected
  wallets, wallet adapters, Cartridge, Dojo, and Starknet are not part of the
  executable flow. Users fund paid play by sending SOL/USDC to the zKube Vault
  address from an external wallet or exchange.
- Durable gameplay, progression, quests, sponsorship quotas, treasury, contests,
  claims, and forfeiture state are on-chain. There is no durable Redis/backend
  gameplay state. The fee-payer relay is stateless and shape-limited; entitlement
  is program-owned.
- Stars are non-transferable program points, not a speculative SPL token.
- Campaign maximum: 10 maps × 10 levels × 3 best Stars = 300 Stars.
- Repeatable quests: three Daily quests worth 1 Star each plus a 2-Star all-three
  finisher (5/day); two Weekly quests worth 5 Stars each (10/week); maximum fully
  farmed week = 45 Stars.
- The original 24 achievements issue 6,700 non-spendable XP and zero Stars.
- Unclaimed Daily prizes remain liabilities for 90 days, then can be explicitly
  forfeited only into the segregated reward/rollover reserve.
- Never sign or send a transaction without explicit approval for the exact scope
  and fingerprint. Use `NO_DNA=1` for every Solana/Anchor CLI invocation.
- Never print, copy, expose, or commit signer bytes, recovery codes, or seeds.

## Repository and runtime

- Workspace: `/home/djizus/zkube-solana`
- Client: `/home/djizus/zkube-solana/client-budokan`
- Original client reference: `/home/djizus/zkube/client-budokan`
- MagicBlock reference: `/home/djizus/cycling-sim`
- Base RPC: `https://rpc.magicblock.app/devnet`
- Router: `https://devnet-router.magicblock.app/`
- Local Vite client: `http://127.0.0.1:5175`
- Local paymaster route: `http://127.0.0.1:5175/api/paymaster`
- Expected paymaster identity:
  `CNhMPp5p3ViMEzBpeRRjXX1G672rwxHkyNG4gVRN7SgY`
- The client and paymaster were last probed HTTP 200.

## Live Devnet program

- Program: `5NfTo5ML4UTa6ep4x9d616fyWQYM3CTcpcE5V9P7YUbA`
- ProgramData: `ALpqN17vyyQr3vuqaHiCAdawtiMniVxK6PzEgPw7P9sB`
- Upgrade authority: `2so568MdBWj9FMdC1pLQEJtgMo3LpYXFHKZ39GvEgEox`
- Current deployment slot: `475577726`
- Current upgrade signature:
  `2wrqVqv9C8sqK1Hrb2xFE37f48YPfVW2EoxULjc1qaJvHH63bX38Yvvbo3Ca3MefF6W49Q1FeLpuchpUuzUXBR5t`
- Current SBF size: `1,592,248` bytes
- Current SBF SHA-256:
  `d075288f0c7776ed50dad38cb770ea4e2c6f277b2049b8a6336cd69b87336636`
- Approved/executed upgrade fingerprint: `21ef11168ed0fe45`
- Upgrade proof:
  `artifacts/devnet-program-upgrade.proof.json`
- Upgrade proof SHA-256:
  `fadd75eeaea00adaab6495e91eac5ed99bcac481e671a9447464b5ffffa43ede`

Independent post-upgrade verification proved:

- the first 1,592,248 ProgramData code bytes hash exactly to the current SBF;
- all remaining 1,544 allocation bytes are zero;
- the stable upgrade buffer is absent and both loader-authority scans are empty;
- the 11.08325016-SOL temporary upgrade buffer drained to zero;
- deployer finalization balance moved from 0.090279441 to 11.173519601 SOL;
- whole-upgrade net deployer spend was 0.01741 SOL;
- no token moved and the upgrade authority was preserved.

## Loader-rent investigation (do not repeat the confusion)

Dedicated evidence:
`artifacts/devnet-loader-rent-audit.proof.json`

SHA-256:
`f45f08a992fc50ffaba16c2fa826508589886c5714a25bf1de3f422703490a25`

The distinction is proven by transactions:

- zKube initial deployment `bkhBvw...wKj`: buffer `9B7U...d6bw` went from
  11.0939964 SOL to zero while the newly created ProgramData went from zero to
  11.0939964 SOL. Initial deployment buffer rent became permanent ProgramData
  rent.
- cycling-sim upgrade `2dXMVY...Ci9G`: temporary buffer `HnEd...rBGY` went from
  7.46427288 SOL to zero while deployer rose from 1.508778348 to 8.973046201
  SOL. Existing ProgramData remained funded.
- zKube first upgrade `2wrqVq...BR5t`: temporary buffer went from 11.08325016
  SOL to zero and was returned to the deployer.

Do not close the live loader-v3 program to reclaim ProgramData rent. Closing it
permanently retires the Program ID; it cannot be redeployed at the same address.
An unsafe dry-only `replace` planner was briefly prototyped, rejected before any
close, and fully removed. Focused deployment runner tests, TypeScript, and lint
passed after removal.

## Bootstrap state already live

- Custody fingerprint `08063b99625c0a82`: complete.
- Protocol fingerprint `1f6cd8031b2ec13a`: complete.
- Catalog fingerprint `d3d34aa2e7528cad`: complete.
- Progress v1 and all ten map catalogs are deployed and decoded.
- Canonical Devnet USDC:
  `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`
- Token program: legacy SPL Token
  `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`
- USDC decimals: 6.
- Five custody vaults are pairwise distinct and program-validated.
- Yield adapter is deliberately disabled; no external treasury capital is
  deployed.

Sanitized bootstrap proofs live under `artifacts/`.

## Settlement bug and fix

Original failure: campaign `CommitRunV1` failed on the live ER with
`InvalidWritableAccount`:

`Account 2: FoPu3cnuSmLMQTeWQVCvzMoME1djs7LLz9EVQWA54yy9 was illegally used as writable`

Root cause: base-only Magic Action targets were declared `#[account(mut)]` in
the outer ER commit instruction. Cycling-sim and the MagicBlock Magic Action
pattern keep those outer accounts read-only and mark them writable only inside
the base-layer `CallHandler`.

Fixed in:

- `solana/programs/solana/src/instructions/run_lifecycle.rs`
- `solana/programs/solana/src/instructions/daily_instructions.rs`

Campaign outer read-only targets now include RunShell, RunReceipt,
PlayerProfile, and CampaignProgress. Daily outer read-only targets include
RunShell, RunReceipt, PlayerProfile, DailyChallenge, DailyPlayer, and
Leaderboard. Payer, delegated ActiveRun, and Magic context remain writable.
The `CallHandler` target metas retain the writability required on base.

Regression coverage:
`client-budokan/src/solana/reboot/rebootClient.test.ts`

The corrected binary is live. The exact preserved campaign commit now simulates
successfully on the Router-resolved ER:

- ER: `https://devnet-eu.magicblock.app/`
- units: `55,849 CU`
- error: `null`
- outer writable accounts only:
  - embedded owner/payer `BQNu...KTB6`
  - delegated ActiveRun `8GWt...p6m`
  - `MagicContext1111111111111111111111111111111`

The unsigned simulation did not mutate state. Router still reported delegated,
the base account remained owned by the delegation program, and the preview
scheduled-commit signature did not exist.

Reusable diagnostic:
`client-budokan/tools/chain/simulate-devnet-settlement.ts`

Example:

```bash
cd client-budokan
NO_DNA=1 pnpm exec tsx tools/chain/simulate-devnet-settlement.ts \
  BQNuPSn2oHn9sU9rKA2hdZfDmiMpdwFYX9D9HqvFKTB6 1
```

This tool simulates only; it never signs or sends.

## Preserved live run — immediate next task

The next agent should finish this exact run through owner-signed settlement,
base copyback, durable receipt verification, and transient rent cleanup.

- Embedded owner:
  `BQNuPSn2oHn9sU9rKA2hdZfDmiMpdwFYX9D9HqvFKTB6`
- Run ID: `1`
- Mode: campaign, Map 1, Level 1
- Lifecycle: `levelComplete`
- Score: `10`
- Moves: `6`
- Pending VRF counter: `0`
- ActiveRun:
  `8GWtivixKnFnUyjhngFfSEFy23NBDfHbmHRjRAzTp6m`
- RunShell:
  `FoPu3cnuSmLMQTeWQVCvzMoME1djs7LLz9EVQWA54yy9`
- RunReceipt:
  `CN1ZEhMWTv6naVJUUaXcbmb2JKMQYMa36zMYcHspS1nx`
- PlayerProfile:
  `Gp9QqzFd88JGXJ5Q9YMMCdt2u7xE1Ja1H4oScacEgYiM`
- CampaignProgress:
  `4XK6UBn3tFumCNcJYphcyXcFUfsPcUwarfY4SfLKt5cR`
- Session signer:
  `GfTUqChviNEFt9YBpcnj3zJHWhhvrnMcWfbQJqZTrDV`
- Session token:
  `ENagvYuqVmiJ6qs3tL9odUVjzSSJcjcYB8KBHx5f8BTo`
- Magic Action escrow:
  `3STkTEqgHNFFEzGx4PP2N4wh7eEcNkThZzK3U4gsfnrM`
- Router validator:
  `MEUGGrYPxKk17hCr7wpT6s8dtNokZj5U2L57vjYMS8e`

The embedded identity lives in the browser. Do not extract or print its recovery
material. Ask the user to refresh `http://127.0.0.1:5175`, resume the run, and
click **Settle result**. That provides the required owner signature. After the
click:

1. Monitor Router status and the ER transaction signature.
2. Confirm commit/undelegate succeeds with no writable-account error.
3. Poll base until the ActiveRun copyback and Magic Action complete.
4. Verify RunReceipt owner, discriminator, owner pubkey, run ID, map/level,
   score, moves, completion flag, action hash, VRF hash, and consumed flag.
5. Verify campaign best Stars/Profile counters changed exactly once.
6. Refresh/resume the client and confirm it shows the settled receipt.
7. Ask the user to click the cleanup action if another owner signature is
   required; otherwise use the existing sponsored cleanup path only after its
   current approval rules are satisfied.
8. Verify ActiveRun is closed, rent returns to the configured recipient, while
   RunShell and RunReceipt remain durable.
9. Save a sanitized end-to-end lifecycle proof and update all four docs.

Do not infer settlement approval from the program-upgrade approval. The executed
fingerprint `21ef11168ed0fe45` covered only faucet funding and the loader upgrade.

## Frontend port status

The user correctly objected that the first reboot client was far too sparse.
The active original zKube route set has now been restored as Solana-native
screens:

- themed home/guardian carousel;
- ten-map and ten-level progression;
- boss reveal;
- gameplay grid, original-style guardian HUD, action bar, bonus controls, sound
  controls, authoritative targets/moves/constraints/combo, and completion panel;
- Daily Arena;
- profile/achievements;
- Daily and Weekly rewards/quests;
- best-only leaderboard;
- settings with audio, themes, embedded Vault, deposit address, SOL/USDC
  balances, recovery export/restore, and withdrawals.

Routing is in `client-budokan/src/App.tsx`. No Phantom, Starknet, Dojo,
Cartridge, or wallet-adapter references remain in executable client source.
`ActiveRunView` now decodes on-chain level rules, target score, maximum moves,
both constraints and progress, mutator IDs, bonus configuration, lines, combo,
and difficulty for authoritative rendering.

Important files:

- `client-budokan/src/ui/pages/RebootHomePage.tsx`
- `client-budokan/src/ui/pages/RebootMapPage.tsx`
- `client-budokan/src/ui/pages/RebootBossRevealPage.tsx`
- `client-budokan/src/ui/pages/RebootPlayScreen.tsx`
- `client-budokan/src/ui/pages/RebootDailyChallengePage.tsx`
- `client-budokan/src/ui/pages/RebootProfilePage.tsx`
- `client-budokan/src/ui/pages/RebootRewardsPage.tsx`
- `client-budokan/src/ui/pages/RebootLeaderboardPage.tsx`
- `client-budokan/src/ui/pages/RebootInfoPage.tsx`
- `client-budokan/src/ui/components/hud/RebootGameHud.tsx`
- `client-budokan/src/ui/components/actionbar/RebootGameActionBar.tsx`
- `client-budokan/src/solana/reboot/runPlan.ts`

The active route set is functionally ported, but continue visual testing on
mobile and desktop. The current production bundle is large; code splitting is
recorded debt, not a blocker for the current Devnet lifecycle proof.

## Validation status

Last full client gate after the frontend port:

- IDL check: pass
- strict project-reference TypeScript: pass
- lint: pass
- tests: 27 files, 97 tests, all pass
- production Vite build: pass

Last program gate:

- 68 Rust tests pass
- formatting and Clippy pass
- SBF/IDL generation passes
- current artifact SHA is the deployed SHA listed above

Focused post-upgrade/rejected-replace validation:

- deployment runner: 4 tests pass
- settlement meta regression: 4 tests pass
- TypeScript and lint pass
- `git diff --check` passes

Canonical validation commands:

```bash
NO_DNA=1 ./validate.sh program
cd client-budokan
pnpm idl:check
pnpm exec tsc -b --pretty false
pnpm lint
pnpm exec vitest run
pnpm build
```

## Documentation and evidence hierarchy

Read in this order:

1. `HANDOFF.md`
2. `IMPLEMENTATION.md`
3. `MAGICBLOCK.md`
4. `OPERATIONS.md`
5. `/home/djizus/cycling-sim/docs/magicblock-focg.md`
6. `/home/djizus/cycling-sim/docs/devnet-deploy-runbook.md`
7. cycling-sim Router/chain flow/embedded identity/paymaster/smoke code
8. installed `magicblock` and `solana-dev` skills

Relevant sanitized artifacts:

- `artifacts/devnet-program-deployment.proof.json`
- `artifacts/devnet-program-upgrade.proof.json`
- `artifacts/devnet-loader-rent-audit.proof.json`
- `artifacts/devnet-bootstrap.custody.proof.json`
- `artifacts/devnet-bootstrap.protocol.proof.json`
- `artifacts/devnet-bootstrap.catalogs.proof.json`

## Safety and worktree rules

- The worktree contains the user's migration and many intentional deletions/new
  files. Never use `git reset --hard`, `git checkout --`, or blanket cleanup.
- Use `apply_patch` for source/document edits.
- Read account owner, data length, discriminator, PDA relationships, and cluster
  genesis before trusting RPC data.
- Keep base-layer, Router, and ER connections separate. Resolve the ER through
  `getDelegationStatus`; never hardcode a region for live operations.
- Keep preflight enabled for base transactions. ER behavior should follow the
  cycling-sim/MagicBlock runbook.
- Preserve unsettled accounts until durable receipt evidence exists.
- Do not close or reclaim the ActiveRun merely because the ER transaction
  returned success.
- Do not deploy a yield adapter, move USDC, publish a Daily challenge, or alter
  governance without a separate explicit approval.

## Recommended immediate response to the user

Tell the user the handoff is loaded, then ask them to refresh the client and
click **Settle result**. Stay active and verify the entire copyback/receipt/
cleanup sequence rather than stopping at the ER signature.
