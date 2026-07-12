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
- Client: `/home/djizus/zkube-solana/client`
- Archived reboot client: `/home/djizus/zkube-solana/client-archive` — frozen,
  read-only reference pending manual parity sign-off; keep it outside runtime
  imports and validation gates, and do not delete it without a separate decision.
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
`client/src/solana/reboot/rebootClient.test.ts`

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
`client/tools/chain/simulate-devnet-settlement.ts`

Example:

```bash
cd client
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
material. First obtain explicit user approval for the exact
seal/commit/copyback/receipt-consumption/rent-cleanup scope. After approval, ask
the user to refresh `http://127.0.0.1:5175` and resume the run. The current
Play controller starts the recovery pipeline automatically; there is no
**Settle result** button. If the run is already shown as settled, the explicit
UI action is **Collect rent & continue**. During that approved flow:

1. Monitor Router status and the ER transaction signature.
2. Confirm commit/undelegate succeeds with no writable-account error.
3. Poll base until the ActiveRun copyback and Magic Action complete.
4. Verify RunReceipt owner, discriminator, owner pubkey, run ID, map/level,
   score, moves, completion flag, action hash, VRF hash, and consumed flag.
5. Verify campaign best Stars/Profile counters changed exactly once.
6. Refresh/resume the client and confirm it shows the settled receipt.
7. If **Collect rent & continue** is shown, ask the user to click it within the
   same explicitly approved cleanup scope; otherwise let the existing sponsored
   finalize plan finish only under that approval.
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

Routing is in `client/src/App.tsx`. No Phantom, Starknet, Dojo,
Cartridge, or wallet-adapter references remain in executable client source.
`ActiveRunView` now decodes on-chain level rules, target score, maximum moves,
both constraints and progress, mutator IDs, bonus configuration, lines, combo,
and difficulty for authoritative rendering.

Important files:

- `client/src/ui/pages/HomePage.tsx`
- `client/src/ui/pages/MapPage.tsx`
- `client/src/ui/pages/BossRevealPage.tsx`
- `client/src/ui/pages/PlayScreen.tsx`
- `client/src/ui/pages/DailyChallengePage.tsx`
- `client/src/ui/pages/ProfilePage.tsx`
- `client/src/ui/pages/RewardsPage.tsx`
- `client/src/ui/pages/LeaderboardPage.tsx`
- `client/src/ui/pages/SettingsPage.tsx`
- `client/src/ui/pages/SpectatorScreen.tsx`
- `client/src/play/usePlayController.ts`
- `client/src/ui/components/hud/GameHud.tsx`
- `client/src/ui/components/actionbar/GameActionBar.tsx`
- `client/src/solana/reboot/runPlan.ts`

The active route set is functionally ported, but continue visual testing on
mobile and desktop. The current production bundle is large; code splitting is
recorded debt, not a blocker for the current Devnet lifecycle proof.

### 2026-07-12 frontend review pass (parity audit + fixes)

The working tree was committed as the Reboot baseline on `feat/solana-reboot`
and a full page-by-page parity audit against `/home/djizus/zkube` was run.
Everything below is committed and gate-green:

- Gameplay-feel fixes for the optimistic Grid under the VRF move flow: the
  move-queue failure path now actually rolls back (the previous effect-scoped
  cancellation made rollback dead code), the Grid no longer remounts per
  action (authoritative state lands through `applyReceipt` with divergence
  reconciliation via `blocksMatchGrid`), watcher snapshots are suppressed
  while a move/bonus is in flight (no mid-cascade `awaitingVrf` clobber),
  and the ADD_LINE machine can no longer park on an empty next line.
- Audio restored everywhere (boss intro/defeat, level-up, victory, game-over,
  star/coin, click, main/level/boss music contexts) — the infra existed but
  was never called after the port.
- Play screen: earned-star rating on level complete, bonus tooltips with
  charge triggers, HUD score count-up + combo pulse, resize-reactive board.
- The original SVG node-graph campaign map is restored on on-chain data
  (`MapPage` + `LevelPreview` + `GuardianGreeting`), with
  per-level rules exposed on `CampaignView` via `mapLevelRuleSnapshot`.
- Profile: XP-within-level progress (previous bar was level/100 — a bug),
  achievement names/icons, lifetime stat tiles (`LifetimeStatsView`); quest
  names/finisher label on Rewards; profile tab re-enabled in the bottom nav;
  Resume-run CTA and daily countdown on Home; leaderboard rank pinning,
  entrance/own-row animation, and Daily guardian art + live countdown.
- New read-only spectator: `/?player=<pubkey>` (optional `&run=<id>`) or
  `/?pda=<activeRun>` opens `SpectatorScreen`; leaderboard rows have
  Watch buttons. `resolveSpectatedRun` routes delegation-status-first (ER
  authoritative while delegated), falls back to consumed receipts, and uses a
  throwaway decode-only wallet — no identity/paymaster/session code on the
  spectate path. The preserved live run is a safe manual test target.
- Cleanup: stale Starknet manifests (`contracts/`), dead
  `solana/scripts/initialize-treasury.ts` + `solana/migrations/deploy.ts`,
  and vestigial client state (deep-link flag, tournament alias/state, dead
  move-store fields) are deleted with user approval.

### 2026-07-12 second pass — element parity + live headless verification

User feedback: pages must reuse the ORIGINAL client's elements, not
re-interpretations. Applied and verified live against Devnet with headless
Chromium (cycling-sim's Playwright):

- Home rebuilt as an element-for-element port of the original: bobbing theme
  logo, identity bar (level badge/title/Connected pill), Story divider with
  arrow pagination, snap-scroll zone-card rail (theme icons, star progress,
  lock/cost), Daily Arena divider, Daily Challenge art card with countdown
  pill, bottom accent ArcadeButton (Play Story / Resume Story / Go to Daily).
- Campaign flow: tapping a map node auto-starts the run (original behavior);
  the manual map/level form only remains for direct visits.
- Uninitialized careers: the node map now renders Map 1 as playable before
  CampaignProgress exists (previously a dead end saying "Start Map 1…" with
  nothing clickable). Map header uses the canonical ZONE_NAMES (Tiki, …).
- Node-map SVG had zero height under `min-h-full`; fixed to `h-full`.
- `client/.env` was MISSING in this worktree — `/api/paymaster`
  returned 503, which breaks session renewal and all sponsored actions
  (the probable "resume does nothing" report). Recreated with the documented
  dev defaults (`PAYMASTER_KEYPAIR_PATH=../.devnet/zkube-paymaster.json`);
  route again returns the expected `CNhM…7SgY`.
- Live headless E2E passed with a fresh identity: home → map → level 1 →
  sponsored prepare → delegate → VRF → board; one drag-move round-tripped
  (16→15 moves, score 2/10, new VRF row); reload → "Resume Story" → back on
  the live board; zero console errors.
- The preserved run (owner `BQNu…KTB6`, run 1) now resolves as
  **base-layer, receipt unconsumed** (Router no longer reports delegation) —
  spectator renders it "LIVE · BASE · Level complete — awaiting settlement".
  The play screen previously showed a forever "Resolving MagicBlock run…"
  spinner for base-phase runs; it now renders the authoritative board with an
  honest "settlement finalizing on-chain" panel. Completing that settlement
  (receipt consumption + rent cleanup) remains the chain-side task above.

## Validation status

Last full client gate after the 2026-07-12 original-client port:

- IDL check: pass
- strict project-reference TypeScript: pass
- focused reboot TypeScript: pass
- lint: pass
- tests: 50 files, 164 tests, all pass
- production Vite build: pass

Signer-free browser acceptance after the port:

- fresh non-persistent Chromium profiles: pass on 1440×900 desktop and
  390×844 mobile viewports;
- Home campaign data, Home → Map, Daily, Boss, Play empty state, Rewards,
  Leaderboard, Profile, Settings/Vault, and read-only Spectator all render;
- Settings exposes deposit address, SOL/USDC balances, recovery controls, and
  withdrawal controls without revealing recovery material;
- `/api/paymaster` returns the expected `CNhM…7SgY` identity;
- zero console errors, page errors, failed requests, paymaster POSTs,
  `sendTransaction`, `simulateTransaction`, or `requestAirdrop` calls were
  observed.

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
cd client
NO_DNA=1 pnpm idl:check
NO_DNA=1 pnpm exec tsc -b --pretty false
NO_DNA=1 pnpm lint
NO_DNA=1 pnpm exec vitest run
NO_DNA=1 pnpm build
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

Tell the user the handoff is loaded, summarize the exact transaction scope,
and request explicit approval for seal/commit/copyback/receipt-consumption/
cleanup. Only after approval, ask them to refresh and resume the preserved run;
the controller starts recovery automatically, or shows **Collect rent &
continue** if only cleanup remains. Stay active through durable receipt and
rent-cleanup verification rather than stopping at the ER signature.
