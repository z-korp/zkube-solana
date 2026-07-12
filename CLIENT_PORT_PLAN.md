# CLIENT_PORT_PLAN — Archive `client-budokan`, port the original zKube client onto the Solana/MagicBlock layer at `client/`

Written: 2026-07-12. Executor: Codex (or any coding agent), phase by phase, with a
validation gate after every phase. This document is self-contained; the executor
is not assumed to have seen any prior conversation. Read `HANDOFF.md` before
starting for repo-wide safety context.

## Mission

The current client (`client-budokan/`) has a bespoke "Reboot*" UI that
re-interprets the original zKube client instead of porting it. The user wants
element-for-element fidelity with the original. Therefore:

1. Archive the current client: `git mv client-budokan client-archive` (kept as a
   read-only in-repo reference until parity sign-off, then deleted in a separate
   decision).
2. Port the ORIGINAL client wholesale into a new `client/` folder, ripping out
   every Starknet/Dojo/Cartridge touchpoint.
3. Wire the ported UI onto the EXISTING, Devnet-proven Solana/MagicBlock chain
   layer that already lives in the current client (`src/solana/`, paymaster,
   tools). Do not reinvent chain code; `/home/djizus/cycling-sim` is the
   upstream MagicBlock reference but its patterns are already embodied here.

Confirmed product decisions:
- Starknet-only features with no Solana equivalent are **removed entirely, not
  stubbed**: Denshokan NFT balances/minting, Ekubo token USD pricing, metagame
  tournaments / weekly endless, Cartridge usernames, the global player (XP)
  leaderboard.
- The embedded Solana identity replaces wallet connect (always connected,
  silent creation). Usernames render as truncated pubkeys (`{4}…{4}`).
- SettingsPage gains the Vault UI (deposit address, SOL/USDC balances,
  withdrawals, recovery export/restore).

## Naming used throughout

- **ORIG** = `/home/djizus/zkube/client-budokan` — original Starknet client.
  Read-only copy source. Never modified, never imported at runtime.
- **ARCHIVE** = `/home/djizus/zkube-solana/client-archive` — the current client
  after the Phase 0 rename. Read-only copy source. Never modified, never
  imported at runtime, never included in gates.
- **NEW** = `/home/djizus/zkube-solana/client` — the port target.

## Ground rules (every phase)

- **Never touch `solana/`** (the Rust/Anchor program). The live devnet program
  `5NfTo5ML4UTa6ep4x9d616fyWQYM3CTcpcE5V9P7YUbA` stays exactly as deployed.
- **Never sign or send a transaction without explicit user approval** for the
  exact scope. All automated gates below are offline. Prefix every
  pnpm/cargo/solana command with `NO_DNA=1`.
- Never print/copy/commit signer material, recovery codes, or `.env`.
- No `git reset --hard`, no `git checkout --`, no blanket cleanup.
- Standard gate, run from `NEW` (`/home/djizus/zkube-solana/client`), referred
  to below as **GATE**:

  ```bash
  NO_DNA=1 pnpm idl:check
  NO_DNA=1 pnpm exec tsc -b --pretty false
  NO_DNA=1 pnpm lint
  NO_DNA=1 pnpm exec vitest run
  NO_DNA=1 pnpm build
  ```

- Commit at the end of each phase (Phases 0+1 are ONE commit — see Phase 0).
- Each client folder is standalone pnpm (there is no root package.json or
  workspace). Always run pnpm inside `client/`.

---

## Phase 0 — Archive the current client and scaffold `client/`

**Do not commit at the end of this phase.** Phase 0 and Phase 1 land as a
single commit, because `validate.sh` (line 30) and
`.github/workflows/static-validation.yml` (lines 43 and 53) hard-code
`client-budokan`; any intermediate push breaks CI.

### 0.1 Archive

```bash
cd /home/djizus/zkube-solana
git mv client-budokan client-archive
```

`git mv` renames the directory on disk, so **untracked** content travels too:
`client-archive/node_modules/`, `client-archive/dist/`, and critically
`client-archive/.env` and the **uncommitted port seed** —
`client-archive/src/compat/dojo/`, `client-archive/src/ui/screens/Loading.tsx`,
`client-archive/src/ui/components/CubeIcon.tsx`, and the modified-but-
uncommitted `vite.config.ts` / `tsconfig.app.json`. All of those are copy
sources in later phases; do not lose them.

### 0.2 Scaffold `client/` — copy configs from ARCHIVE

ARCHIVE's configs are already Solana-adapted, and its `package.json` already
contains every UI dependency the original client needs (react 19, motion,
howler, radix, zustand, tailwind v4, sonner, lucide-react, cva/clsx/
tailwind-merge, `@types/howler`) and **zero** Starknet/Dojo/Cartridge deps. So
the "merged" package.json is simply ARCHIVE's, unchanged, and `pnpm-lock.yaml`
copies verbatim so `--frozen-lockfile` (and the CI cache key) keep working.

```bash
mkdir client
cp client-archive/{package.json,pnpm-lock.yaml,tsconfig.json,tsconfig.app.json,tsconfig.node.json,tsconfig.tools.json,tsconfig.reboot.json,vite.config.ts,vitest.config.ts,eslint.config.js,.prettierrc,components.json,index.html,env.d.ts,.env.example,.gitignore,tailwind.config.cjs,vercel.json} client/
mkdir client/deployment && cp client-archive/deployment/README.md client/deployment/
```

Notes:
- `index.html` is byte-identical to ORIG's — no changes.
- `vite.config.ts` (the uncommitted ARCHIVE version) already has everything
  load-bearing: `paymasterDevPlugin()`, `nodePolyfills(["buffer","process",
  "stream","util"])`, `wasm()` + `topLevelAwait()`, `build.target ES2022`,
  `vendor-solana` manualChunks, dev port **5175**, and the two-entry alias
  array with the `@/dojo/*` → `src/compat/dojo/*` **regex alias listed before**
  the plain `@` alias. Keep as-is.
- `tsconfig.app.json` (uncommitted ARCHIVE version) already has
  `paths: { "@/dojo/*": ["src/compat/dojo/*"], "@/*": ["src/*"] }`. Keep.
- `vercel.json` has no internal paths; carries over unchanged.

### 0.3 Assets — move, don't copy

`client-archive/public/` (235 MB, all git-tracked, identical content to ORIG's
`public/`: ~175 PNG, ~50 MP3, fonts, favicon) belongs to the new client:

```bash
git mv client-archive/public client/public
```

Pure rename in git — no new blobs, no working-tree doubling.

### 0.4 `.env` — manual, flagged step

`.env` is **gitignored** and after 0.1 lives at `client-archive/.env`:

```bash
cp client-archive/.env client/.env   # verify `git status` shows nothing for it
```

Relative paths inside it (`PAYMASTER_KEYPAIR_PATH=../.devnet/zkube-paymaster.json`,
etc.) resolve identically because `client/` sits at the same depth
`client-budokan` did. If `.env` is missing (HANDOFF.md records it going missing
in a worktree before — symptom: `/api/paymaster` returns 503, session renewal
and all sponsored actions break), recreate from `client/.env.example` and ask
the user for operator values. **Flag this step to the user explicitly.**

### 0.5 One config fix: vitest alias

`vitest.config.ts` today only aliases `@` — add the `@/dojo` regex alias,
mirroring `vite.config.ts` (array form, regex entry first):

```ts
resolve: { alias: [
  { find: /^@\/dojo\//, replacement: path.resolve(__dirname, "./src/compat/dojo") + "/" },
  { find: "@", replacement: path.resolve(__dirname, "./src") },
]}
```

### 0.6 Install

```bash
cd /home/djizus/zkube-solana/client && NO_DNA=1 pnpm install --frozen-lockfile
```

Full GATE is deferred to Phase 1 (no `src/` yet).

---

## Phase 1 — Chain layer, paymaster, tools (first commit; ~25 test files green)

### 1.1 Copy verbatim ARCHIVE → NEW

The Solana layer is fully self-contained (no `@/…` imports pointing outside
itself; internal imports are relative):

| Source (client-archive/) | Dest (client/) | Contents |
|---|---|---|
| `src/solana/**` | `src/solana/**` | constants.ts, idl.ts, provider.tsx, SolanaConnectionProvider.tsx, connectionContext.ts, `generated/` (solana.json + solana.ts), `reboot/` (~55 files incl. 24 `*.test.ts`: embeddedIdentity+Provider, sessionWallet/sessionV2/runSessionStore, paymasterClient/sponsorshipClient, runPlan, runWatcher, resumeRun/spectateRun, router, erRetry, magicAction, pdas, rebootGrid, bonusTypes, campaign/daily/progress/treasury clients, admin/governance/monitoring/readiness/deployment*, hooks useRebootRun/Campaign/Daily/Progress/Treasury/useSpectatedRun/useDevnetRuntimeStatus) |
| `src/server/**` | `src/server/**` | paymaster.ts (strict sponsored-policy core), paymasterVitePlugin.ts (dev `/api/paymaster`), paymaster.test.ts |
| `api/paymaster.ts` | `api/paymaster.ts` | Vercel prod route (imports `../src/server/paymaster`) |
| `tools/**` | `tools/**` | sync-anchor-idl.mjs, deployment-build.mjs, lint-active.mjs, `chain/` (bootstrap-devnet, check-deployment-manifest, check-readiness, deploy-devnet, run-local-smoke, simulate-devnet-settlement) |
| `src/vite-env.d.ts` | `src/vite-env.d.ts` | required by tsconfig include |
| `src/test/setup.ts` | `src/test/setup.ts` | vitest setup |
| `src/index.css`, `src/grid.css` | same | identical to ORIG's; index.css carries `@config "../tailwind.config.cjs"` (tailwind v4) |

### 1.2 Edit `client/tools/sync-anchor-idl.mjs`

Its `pairs` array (lines 7–8) hard-codes destinations. Change:
- `"client-budokan/src/solana/generated/solana.json"` → `"client/src/solana/generated/solana.json"`
- `"client-budokan/src/solana/generated/solana.ts"` → `"client/src/solana/generated/solana.ts"`

Without this, `pnpm idl:check` checks the wrong path and lies.

### 1.3 Minimal app stub

`tsconfig.app.json` lists `src/main.tsx`/`src/App.tsx` as entry points and
`pnpm build` runs `tsc -b && vite build`, so create:
- `client/src/App.tsx` — stub: `export default function App() { return <div>zKube port in progress</div>; }`
- `client/src/main.tsx` — stub importing `./index.css` and rendering `<App />` (no providers yet).

### 1.4 Repoint workspace gates (same commit)

- `validate.sh` line 30: `cd "$root/client-budokan"` → `cd "$root/client"`.
- `.github/workflows/static-validation.yml`: `working-directory: client-budokan`
  → `client` (line 43) and `cache-dependency-path: client-budokan/pnpm-lock.yaml`
  → `client/pnpm-lock.yaml` (line 53).

From here on, ARCHIVE is permanently outside every gate.

### 1.5 Gate

Full **GATE** (expect ~25 test files green: 24 chain + paymaster) plus
`./validate.sh frontend` from the repo root. Then **commit Phases 0+1
together**; `.env` must not appear in the diff.

---

## Phase 2 — Domain substrate + compat `@/dojo` shim

Everything here is chain-free or already Solana-adapted.

### 2.1 Copy ARCHIVE-first (already ported/adapted during the Reboot work)

From `client-archive/src/` → `client/src/`: `enums/` (comboEnum, gameEnums),
`types/` (types.ts, questFamily/), `utils/` (gridPhysics.ts, gridUtils.ts,
gridUtils.test.ts, noop.ts), `config/` (themes.ts, bossCharacters.ts,
bossIdentities.ts, achievementDefs.ts, questDefs.ts, profileData.ts,
mutatorConfig.ts), `audio/AudioManager.ts`, `contexts/music.tsx` +
`contexts/hooks.ts`, `stores/navigationStore.ts` (a superset of ORIG's:
`spectate` page + `spectateTarget`, no `pendingDeepLinkStart` — keep this
version), `stores/moveTxStore.ts` (the ARCHIVE Grid depends on it),
`ui/elements/**` (radix primitives + theme-provider), `ui/theme/`
(ImageAssets.tsx, ImageBlock.tsx), `ui/utils.ts`, `ui/navigation/`
(PageNavigator, BottomNav, PageTopBar), `test/gameParityFixture.test.ts` (its
`../../../fixtures/game-parity.json` path resolves unchanged).

### 2.2 Copy the compat seed and close its verified gaps

Copy `client-archive/src/compat/dojo/**` → `client/src/compat/dojo/` (Game
adapter over ActiveRunView, `game/constants.ts`,
`game/helpers/runDataPacking.ts` (isBossLevel), `game/types/bonusTypes.ts`,
`game/types/constraint.ts`).

Net-new compat work (gaps verified against ORIG imports):
- **`compat/dojo/game/types/level.ts`** — export ONLY
  `applyStarThresholdModifier` (pure function, copy from ORIG
  `src/dojo/game/types/level.ts`) plus whatever types `useMapData`/
  `navigationStore` need. `generateLevelConfig` / `getLevelRanges` /
  `parseGameSettings` must NOT be ported (they depend on starknet Poseidon
  `hash`); their consumers are rewired to on-chain rules (Phase 4).
- **`compat/dojo/game/types/difficulty.ts`** — pure string enum, copy verbatim
  from ORIG.
- **Add to the compat `Game` class**
  (`compat/dojo/game/models/game.ts`):
  `get totalCubes() { return this.view.totalLinesCleared; }` —
  ORIG `VictoryDialog.tsx` reads it.
- Do NOT port the Starknet felt packers (`packer.ts`, `levelStarsPacking.ts`,
  `metaDataPacking.ts`) — the hook layer reads decoded Solana data.
- Do NOT shim `@/dojo/useDojo` — the 7 surviving ORIG UI files that call it
  (PlayScreen, MapPage, DailyChallengePage, QuestsTab, UnlockModal, DailyTab,
  QuestsRewardsTab) get rewired to the new hooks in Phases 4–5. A stub would
  still break on `setup.client/*` shapes.
- **Semantics note:** the seed's constants deliberately change ORIG values —
  `LEVEL_CAP` 50→10, `BOSS_LEVELS` [10..50]→[10] (10 maps × 10 levels, level
  10 = guardian). Audit any ported MapPage/HUD math that assumed 50.

### 2.3 Port small ORIG utils with Starknet stripped

- `utils/toast.ts` — replace the Starknet explorer URL with
  `https://explorer.solana.com/tx/<sig>?cluster=devnet`; keep
  `getToastPlacement`.
- `utils/logger.ts`, `utils/predictedDailyZone.ts` — port only if chain-free
  (verify imports first).
- Skip: `entityId.ts`, `erc20.tsx`, `erc721.tsx`, `price.tsx`, `payment.ts`,
  `metagame.ts`, `tokenImages.tsx` (Starknet-only, removed features).
- `enums/moveEnum.ts` — copy from ORIG only if a ported component imports it.

### 2.4 Gate

**GATE** (new tests picked up: gridUtils, gameParityFixture). Note: files
copied but not yet imported from `main.tsx`/`App.tsx` are invisible to
`tsc -b`/lint (lint-active only lints the compiled graph) but vitest globs all
`*.test.*` — tests validate immediately even for unwired modules. Commit.

---

## Phase 3 — App shell, Loading screen, board stack

### 3.1 Copy ARCHIVE board stack verbatim (never ORIG's)

ORIG `Grid.tsx`/`GameBoard.tsx` call `useDojo`, take a starknet `Account`, and
parse Starknet receipts (`rpcReader`). The ARCHIVE versions are the already-
re-plumbed Solana equivalents (clean `onMove`/`onBonus` → receipt-projection
prop interface with optimistic reconciliation via `blocksMatchGrid`). Copy from
`client-archive/src/`:
- `ui/components/{Grid,Block,NextLine,SpectatorGrid,CubeIcon}.tsx` + `Grid.drag.test.tsx`
- `ui/screens/Loading.tsx` (already the ported ORIG loading screen)
- `hooks/{useGridAnimations.ts,useTransitionBlocks.ts,useLerpNumber.tsx,useMapLayout.ts}`
  (useMapLayout already replaced starknet Poseidon with a local `hashToUnit`)

Port from ORIG (pure): `hooks/useDeepMemo.tsx`, `hooks/useMapData.ts`
(signature changes in Phase 4; its `@/dojo/game/types/level` import resolves
via the compat alias).

### 3.2 Real `main.tsx` and `App.tsx`

- `main.tsx`:

  ```
  StrictMode → ThemeProvider → SolanaProvider (SolanaConnectionProvider +
  EmbeddedIdentityProvider, from src/solana/provider.tsx) → MusicPlayerProvider
  → RunProvider → App
  ```

  **No AppGate.** ORIG's gate waited on async Dojo setup + Cartridge reconnect
  + username; none exist here — the embedded identity is created synchronously
  in a `useState` initializer (`loadOrCreateEmbeddedIdentity`), there is no
  reconnect and no username. Render `<App />` directly. Devnet health is NOT a
  gate: `useDevnetRuntimeStatus()` renders as a non-blocking amber banner in
  Home (pattern: ARCHIVE `RebootHomePage.tsx`, `runtime.phase !== "ready"`).
  Keep the spectate URL hydration (`?player=` / `?pda=` / `&run=`) from
  ARCHIVE `App.tsx`. Drop ORIG's `/play/{tokenId}` Budokan deep link
  (`hydrateNavigationFromUrl`, `pendingDeepLinkStart`) — Starknet token launch
  path, removed feature.
- **New `contexts/run.tsx` (`RunProvider`)** — calls `useRebootRun()` exactly
  once and exposes it via context. Rationale: `useRebootRun` spins up a
  `PersistedRunWatcher` (websocket) per instance, and ORIG mounts game state
  from 4 places simultaneously (PlayScreen, MapPage, BossRevealPage, useGrid);
  without the provider that is 4 watchers. All reimplemented gameplay hooks
  (Phase 4) read from this context.
- `App.tsx`: ORIG's `pageComponents` switch over `PageId` (tabs: home,
  rewards, profile, ranks, settings; overlays: play, daily, boss, map; plus
  `spectate`), with every page a local placeholder for now.

### 3.3 Gate

**GATE**, plus first runtime probe: `NO_DNA=1 pnpm dev` in background →
`curl -sf http://localhost:5175/` returns the index page and
`curl -sf http://localhost:5175/api/paymaster` returns the paymaster identity
JSON (if it 503s, the `.env` step from Phase 0.4 was missed). Stop the server.
Commit.

---

## Phase 4 — Solana-backed hook layer (`client/src/hooks/`, original names/signatures)

Goal: pages ported in Phase 5 keep their original imports
(`@/hooks/useGame`, …) verbatim. Back every hook exclusively with
`src/solana/reboot/*` and the compat `Game` model. **Before writing each hook,
read the ARCHIVE Reboot page that displays the same data — the mapping already
exists there.**

Strategy legend: **(a)** reimplement body, same file name + call-site
signature; **(b)** delete hook, rewire the few consumers; **(c)** drop feature
and clean call-site UI.

| ORIG hook | Strategy | Solana replacement |
|---|---|---|
| `useAccountCustom` | (a) | `useEmbeddedIdentity()` → `{ account: { address: publicKey.toBase58() } }`. Always non-null → every `if (!account) <Connect/>` branch is dead; strip those blocks (ProfilePage, RewardsPage, PlayScreen connect dialog, DailyChallengePage, LeaderboardPage, MapPage). |
| `useGame` | (a) | RunProvider → `run.activeRun ? new Game(view, levelStars) : null` (compat class). `seed` → `0n` (its only use fed the removed `generateLevelConfig` fallbacks), `gameKey` → null, `gameId` param ignored (exactly one persisted run per identity). |
| `useGrid` | (a) | `useDeepMemo(() => run.activeRun ? toDisplayGrid(run.activeRun.grid) : [], …)` (`src/solana/reboot/rebootGrid.ts`). Keep the "skip update while terminal" guard; `levelTransitionPending` is constant false (a level boundary is a run boundary on Solana). |
| `useGameLevel` | (a) | Map `run.activeRun.rules` (`ActiveRunRulesView` in `runPlan.ts`) → `GameLevelData`: pointsRequired/maxMoves/difficulty direct; constraint fields ← `rules.primary/secondary.{kind,value,requiredCount}`; mutatorId ← `rules.passiveMutatorId`; star thresholds via `applyStarThresholdModifier(rules.starThresholdModifier)`. Keep exporting the `GameLevelData` type (navigationStore imports it). Also export pure `rulesToGameLevelData(rules, level)` so MapPage/LevelPreview build previews from `CampaignMapView.levels[i]`. |
| `useSettings` | (b) | Delete — GameSettings only seeded client-side level generation; rules come from chain (`rules` in play, `CampaignMapView.levels` on map). Rewire: PlayScreen's `zoneSettings.activeMutatorId` → `run.activeRun.rules.activeMutatorId`; MapPage passes `CampaignMapView` down. |
| `useMutatorDef` | (b) | Delete — bonus data is inline on the run: `activeRun.bonusType`, `bonusCharges`, `rules.bonusTriggerType`, `rules.bonusThreshold`, `rules.startingCharges`. PlayScreen's ~70-line `bonusSlots` memo collapses to one slot from those five fields. Mutator names/descriptions from static `@/config/mutatorConfig`. |
| `useZoneProgress` | (a) | Highest-fanout hook. Over `useRebootCampaign().campaign.maps` (`CampaignMapView`): zoneId←mapId, stars←sum(levelStars), maxStars=30, unlocked←unlocked, bossCleared/cleared←cleared, perfectionClaimed←perfected, starCost←Number(starCost), price←usdcCost, levelStars←levelStars, highestCleared← highest index with stars (or 10 if cleared), isFree←mapId===1. Keep signature `(playerAddress, zStarBalance)`; address ignored. |
| `usePlayerMeta` | (a) | `useRebootProgress()`: lifetimeXp←Number(achievementXp), totalRuns←Number(lifetime.runsStarted), dailyStars←Number(lifetime.dailyChallenges), bestLevel← derived from campaign (10×clearedMaps + highestCleared of first uncleared map), lastActive←0 (hide). |
| `usePlayerStats` | (a) | `progress.lifetime` (`LifetimeStatsView`): totalLines←linesCleared, totalBosses←bossesCleared; combo4Count has no equivalent → relabel to maxCombo or 0. |
| `useActiveStoryAttempt` / `useActiveDailyAttempt` | (a) | `loadRunSession(publicKey)` (`runSessionStore.ts`) filtered by `mode !== "daily"` / `=== "daily"` → `{ gameId: marker.runId, zoneId, level }`, joining RunProvider.activeRun for zone/level when available (pattern: ARCHIVE RebootHomePage "resume" chip). |
| `useCurrentChallenge` | (a-adapted) | Shared `useRebootDaily()`: `challenge = daily && { challenge_id: daily.dayId, start_time: daily.opensAt, end_time: daily.runsCloseAt, settled: daily.status === "settled", zone_id: daily.mapId }`. The Poseidon `computeDailyZoneId` in ORIG DailyChallengePage is replaced by `daily.mapId` directly. |
| `usePlayerEntry` | (a-adapted) | `DailyView.player` (`DailyPlayerView`): `isRegistered = daily?.player != null`; map bestScore/rank/prizeAmount/claimed/freeAttemptUsed/paidAttempts per page. ORIG's daily per-level `level_stars`/`highest_cleared` packing has **no equivalent** → daily map-progress view degrades to score display. |
| `useDailyLeaderboard` | (a-adapted) | `DailyView.leaderboard` (`{player, runId, score, submittedAt}`): rank by array order, player←base58. **Semantic change: dailies rank by score, not stars — relabel the column** in LeaderboardPage/DailyTab/DailyChallengePage. |
| `usePreviousChallenge` | (a-adapted, optional) | `fetchDailyView({connection, wallet, dayId: current−1})` (`dailyClient.ts`) to power the claim/refund panel via `buildClaimDailyPrizePlan`/`buildRefundDailyEntryPlan`. If DailyTab is simplified, drop and use `useRebootDaily().claim/refund` on the current view. |
| `useAchievements` | (a) | `progress.achievements` (`AchievementProgressView`) joined to `@/config/achievementDefs` by index; `completed ← claimable || claimed`; claim wired to `claimAchievement(index)`. |
| `useQuests` | (a) | `progress.quests` joined to `@/config/questDefs` by index; claim via `claimQuest(index)`. |
| `useClaimableCount` | (a) | claimable achievements + claimable quests (exact formula in ARCHIVE `BottomNav.tsx`); unsettled daily/weekly components → 0 (settlement is automatic). |
| `useZStarBalance` | (a) | `progress.starsBalance` (PlayerProfile field, also on CampaignView). Ignore the address param (other-profile viewing drops). |
| `useTokenBalance` | (b) | Delete; ProfilePage reads `usdcBaseUnits`/`balanceLamports` from `useEmbeddedIdentity()`. STRK/LORDS rows removed. |
| `useMapData` | (a-modified) | Keep output type (`MapData { nodes: MapNodeData[], … }`); input becomes `CampaignMapView` instead of `(seed, settings)` — build per-node `levelConfig` from `map.levels[i]` or let LevelPreview read rules directly (pattern: ARCHIVE `RebootLevelPreview.tsx`). Node `state` from levelStars/highestCleared as in the new `useZoneProgress`. |
| `usePlayerLeaderboard` | (c) | Drop — no global player index on Solana (would need program-account scans). LeaderboardPage keeps only the Daily tab; remove the "Players" tab UI. |
| `useLeaderboardSlot`, `useUnsettledRewards` | (c) | Drop with WeeklyTab (weekly endless removed). |
| `useTokenPricesUsd` | (c) | Drop (+ delete `src/api/ekubo.ts`). Portfolio total = USDC only. |
| `useTokenSettingsId` | (c) | Drop; also delete PlayScreen's `formulaSettingsId` fallback logic. |
| `useControllerUsername`, `useGetUsernames` | (c) | Drop. Usernames → truncated pubkey `{4}…{4}` (pattern: ARCHIVE RebootHomePage). Touched UI: Home identity card, Profile header, Settings account row, Controller button label, leaderboard rows. |
| `useNftBalance`, `usePlayerBestRun`, `useGameTokensSlot` | (c) | Verified orphans in ORIG — delete, don't port. |
| `useDeepMemo`, `useGridAnimations`, `useTransitionBlocks`, `useLerpNumber` | keep | Pure; last three already copied from ARCHIVE in Phase 3. |

Gate note: hooks must be imported somewhere to be linted — either wire a
temporary `src/hooks/index.ts` barrel referenced from `App.tsx`, or accept
deferred lint coverage until Phase 5. **GATE**; commit.

---

## Phase 5 — Page-by-page port (gate + commit per page group)

**Order:** Home → Map → **PlayScreen** → BossReveal → Daily → Settings+Vault →
Profile → Rewards → Leaderboard → Spectator.

### The overlap rule (for every file brought into `client/src`)

1. **If ARCHIVE has a same-role file that already compiles against `@/solana` +
   `@/compat` (no `@dojoengine`/`starknet` imports): copy the ARCHIVE
   version.** It embodies solved problems (receipt projections, optimistic
   rollback, VRF waits). Applies to: Grid/Block/NextLine/SpectatorGrid,
   moveTxStore, navigationStore, chrome ActionBarSvg/HudBarSvg/chromeLayout,
   map GuardianGreeting/ZoneBackground, shared/*, elements/*, config/*,
   utils/*, enums, AudioManager, Loading, theme.
2. **Else copy the ORIG version** and route its chain imports through the
   compat alias (`@/dojo/*` → `src/compat/dojo/*`) or the Phase-4 hooks;
   delete removed-feature call sites (NFT, USD prices, usernames, metagame)
   rather than stubbing them.
3. **Where both exist and conflict (PlayScreen vs RebootPlayScreen, MapPage vs
   RebootMapPage, LevelPreview vs RebootLevelPreview): ORIG supplies
   JSX/presentation, ARCHIVE supplies transaction/state logic**, extracted
   into a hook/controller — never merge by pasting both files together.
4. Never `import` from `client-archive/` or `/home/djizus/zkube` — copy only.
   When in doubt, `diff` the two candidates first.

### Write-path mapping (ORIG `src/dojo/systems.ts` is never ported; the hooks are the API)

| ORIG systems call | Replacement |
|---|---|
| `startRun` / `replayLevel` | `run.startCampaignRun(mapId, level)` — internally: `buildPrepareCampaignRunPlan` (paymaster-sponsored) → `buildDelegateRunPlan` → `resolveRunErConnection` → VRF `hydrateRows` loop (`buildRequestRowPlan` + wait). All inside `useRebootRun`. |
| `move` | `run.playMove(row, start, destination)` — `buildPlayMovePlan`, session-key signed on the ER with expectedMove/expectedAction preconditions; auto VRF row refill afterward. |
| `applyBonus` | `run.applyBonus(row, column)` — `buildApplyBonusPlan` → refreshed `ActiveRunView`. |
| `purchaseMap` / `unlockWithStars` | `useRebootCampaign().unlock(mapId, "usdc" \| "stars")` (`buildPurchaseMapWithUsdcPlan` / `buildUnlockMapWithStarsPlan`, sponsored). |
| `startDailyGame` | `useRebootDaily().enter(payment)` → `run.startDailyRun(daily, payment)`. **New UI element:** free-stars vs USDC entry choice — copy from ARCHIVE `RebootDailyChallengePage.tsx`. |
| `questClaim` | `useRebootProgress().claimQuest(index)`; achievements via `claimAchievement(index)`. |
| `surrender` | No on-chain surrender. Closest: `run.dismissRun()` (forget marker locally; accounts remain recoverable) — relabel "Quit run". **Semantic downgrade, flagged.** |
| `claimPerfection` | No direct equivalent — perfection is `CampaignMapView.perfected`; rewards flow via achievements. Remove the button or repoint at the matching achievement claim. |
| `settleChallenge` | Drop — settlement is automatic. Payouts: `useRebootDaily().claim()` / `.refund()`. |
| `replayDailyLevel` | No equivalent (a daily attempt is one continuous run; "replay" = paying another entry). Remove per-level daily replay from MapPage. |
| `freeMint`, `create`, `createRun`, `addCustomGameSettings`, `settleWeeklyEndless` | Drop (dead code or removed feature). |

### PlayScreen — the flagship merge

ORIG `PlayScreen.tsx` supplies the JSX: GameBoard, `hud/GameHud.tsx`,
`actionbar/GameActionBar.tsx`, chrome SVGs (`ConstraintBarSvg`,
`GridFrameSvg`; ARCHIVE already has `ActionBarSvg`, `HudBarSvg`,
`chromeLayout`), `BonusButton.tsx`, dialogs (`GameOverDialog`,
`LevelCompleteDialog`, `VictoryDialog`).

ARCHIVE supplies the pipeline, **extracted into `client/src/play/usePlayController.ts`**
(source: `RebootPlayScreen.tsx` + `useRebootRun`):
- auto-start from `pendingPreviewLevel` (navigation store), calling `startCampaignRun`;
- `onMove`/`onBonus` builders returning authoritative projections
  (`toDisplayGrid(active.grid)` etc.) consumed by the ARCHIVE Grid's props;
- optimistic move queue + rollback + `blocksMatchGrid` divergence
  reconciliation (lives inside the ARCHIVE Grid — used verbatim);
- VRF request/wait hidden behind the Grid's `isTxProcessing` lock (no new UI);
- the delegate step's "Preparing on-chain run…" state mapped onto ORIG's
  existing `isGameLoading` spinner branch;
- auto-settle effect on terminal lifecycle + `settleStageLabel()` progress
  text over the frozen board;
- `phase === "base" | "settleable"` recovery panels and `phase === "settled"`
  receipt + "Collect rent" panel (new states, port as PlayScreen sub-panels);
- session-expiry "Renew session" panel (`recoverSession()`) and `dismissRun()`
  escape hatch;
- lifecycle sfx via the `prevLifecycleRef` effect (boss intro/defeat,
  level-up, victory, game-over).

Wiring details:
- `GameBoard.tsx` ports from ORIG with a two-line prop change: drop the
  starknet `Account` prop, add `onMove`/`onBonus` passthrough (types from the
  ARCHIVE Grid's `GridProps`). Keep ResizeObserver sizing, NextLine chrome,
  `nextLineOverride`.
- ORIG's `game` vs `toriiGame` split collapses to one object; navigation
  effects re-key off `run.activeRun.lifecycle` (`"levelComplete"` /
  `"finished"`) instead of `toriiGame.over` + level jumps.
- On terminal lifecycle, set `pendingLevelCompletion` (from the terminal
  `ActiveRunView` + rules) **before** calling `settleAndAdvance` so ORIG's
  `LevelCompleteDialog` still runs; then navigate to `map`.
- Delete `stores/receiptGameStore.ts` and `dojo/rpcReader.ts` — subsumed by
  onMove-returning-authoritative-state + the watcher.
- Adapt ARCHIVE `RebootPlayScreen.test.ts` to the extracted controller.

### Other pages

- **HomePage** — ORIG JSX; strip username/zStar display per Phase 4; keep the
  campaign auto-start behavior and devnet-status banner from ARCHIVE
  RebootHomePage; resume CTA from `useActiveStoryAttempt`.
- **MapPage** — ORIG + `map/` components (prefer ARCHIVE twins:
  GuardianGreeting, ZoneBackground; LevelPreview merges per the overlap rule);
  start-run wires through navigation `pendingPreviewLevel` → PlayScreen
  auto-start; audit LEVEL_CAP-50 math.
- **BossRevealPage** — ORIG + compat Game/constraint types.
- **DailyChallengePage** — ORIG + Phase-4 daily hooks; entry-payment choice
  from ARCHIVE.
- **SettingsPage + Vault** — ORIG minus Cartridge connect/username rows, plus
  the Vault section transplanted from ARCHIVE `RebootInfoPage.tsx`: deposit
  address copy, SOL/USDC balances, `withdrawSol`/`withdrawUsdc`, recovery
  export/restore. This is the identity surface replacing `Connect.tsx`
  (deleted everywhere) and `Controller.tsx` (reimplemented: truncated pubkey
  label, onClick → profile page; same button shell).
- **ProfilePage** — ORIG + `profile/` tabs; strip usernames/token balances/
  other-profile viewing; wire achievement/quest claims.
- **RewardsPage** — ORIG + `rewards/` tabs minus WeeklyTab; DailyTab's settle
  button dropped (settlement automatic), claims via daily `claim`/`refund` and
  progress claims. Copy `config/rewardTiers.ts` from ORIG (not in ARCHIVE).
- **LeaderboardPage** — ORIG, Daily tab only; rank by score (relabeled).
- **Spectator** — copy ARCHIVE `RebootSpectatorScreen.tsx` →
  `ui/pages/SpectatorScreen.tsx` (+ `useSpectatedRun`, `SpectatorGrid`, both
  already copied); `?player=`/`?pda=` hydration already enabled in Phase 3.

**GameEventsProvider replacement:** none. Move/bonus failure toasts fire in
the Grid's rollback; lifecycle fanfares via the `prevLifecycleRef` effect; if
a "Level N started" toast is wanted, it's a PlayScreen `useEffect` on
`run.activeRun?.level` — not a provider.

**Never ported:** ORIG `src/dojo/` (24 chain files), `cartridgeConnector.tsx`,
`dojo.config.ts`, `contexts/{MetagameProvider,controllers,gameEvents}.tsx`,
`ui/components/{Connect,Controller(replaced),ImageNFTZkube}.tsx`,
`api/ekubo.ts`, `config/{metagame,manifest}.ts`, manifests, and every (c)-hook
above. `NewsCard.tsx`: port only if a page uses it and it's chain-free.

**Per-group gate:** GATE + `pnpm dev` boots + the newly ported page renders
without console errors (read-only; no signing). Commit per page or small group.

---

## Phase 6 — Workspace, docs, deployment, final acceptance

1. **tsconfig.reboot.json**: its `include` lists
   `src/ui/pages/RebootPlayScreen.tsx` and `RebootDailyChallengePage.tsx`,
   which no longer exist — replace with the new controller/page paths; keep
   `typecheck:reboot` as the fast chain-layer typecheck.
2. **Docs sweep** (`client-budokan` → `client`, plus a changelog row in
   IMPLEMENTATION.md): `README.md` (~6 refs), `OPERATIONS.md` (~8 refs),
   `HANDOFF.md` (~20 refs; also update the page list to the new names and note
   `client-archive/` is a frozen reference slated for deletion after parity
   sign-off), `IMPLEMENTATION.md` (2 prose refs).
3. **Vercel — flag to user:** the Vercel project's *Root Directory* setting
   must change from `client-budokan` to `client` in the dashboard; not
   automatable from the repo. `client/vercel.json` itself needs no edits.
4. **Orphan check**: compare `find client/src -name '*.ts*'` against
   `NO_DNA=1 pnpm exec tsc -p tsconfig.app.json --listFilesOnly` — files
   unreachable from `main.tsx`/tests are invisible to lint-active; wire or
   delete them.
5. Optional space reclaim (ask user first):
   `rm -rf client-archive/node_modules client-archive/dist` (both untracked).
6. **Do NOT delete `client-archive/`** — separate decision after the manual
   parity sign-off.

### Final acceptance

Automated: `./validate.sh frontend` from repo root (frozen install, idl:check,
typecheck:reboot, build, vitest, lint) and CI workflow green.

Runtime, no signing: `pnpm dev` → app boots on 5175 with a fresh identity
(cleared localStorage) → Home renders campaign state;
`curl http://localhost:5175/api/paymaster` returns the identity matching
`ZKUBE_PAYMASTER_PUBLIC_KEY` (`CNhMPp5p3ViMEzBpeRRjXX1G672rwxHkyNG4gVRN7SgY`).

**Manual live-devnet checklist — every signing step requires explicit user
approval; the executor pauses and asks:**
1. Fresh identity → Home renders campaign state.
2. Settings → Vault shows deposit address + SOL/USDC balances; recovery
   export/restore round-trips.
3. Home → Map renders zones/levels from on-chain progress.
4. Start a run (prepare → delegate → VRF) — **approval required**.
5. Play ≥3 moves: optimistic apply, ER confirm, no board divergence; apply a
   bonus if charged.
6. Hard refresh mid-run → resume restores board, queue, and lifecycle.
7. Finish/fail the level → auto seal → commit → settle → progress reflected on
   Map/Home; LevelCompleteDialog fires with earned stars.
8. Spectate `?player=<pubkey>` from a second tab shows the live read-only board.
9. Withdraw residual SOL from the Vault — **approval required**.

---

## Risks & pitfalls specific to this migration

- **The `@/dojo` alias must exist in four places** and stay consistent:
  `vite.config.ts` (regex entry *before* the plain `@` entry),
  `vitest.config.ts` (missing today — Phase 0.5), `tsconfig.app.json` `paths`,
  and by inheritance `tsconfig.reboot.json`. ESLint type-aware rules resolve
  through the tsconfig projects, so a gap breaks lint too.
- **lint/tsc only see the import graph** rooted at
  `main.tsx`/`App.tsx`/`src/server`/`api`/`tools` (narrow `include` +
  `lint-active.mjs` design). A page that "passes the gate" while unwired
  proves nothing; conversely you can land files early without breaking gates.
  Wire before trusting; run the Phase 6 orphan check.
- **Never port ORIG `Grid.tsx`/`GameBoard.tsx` verbatim** — they call
  `useDojo`, take a starknet `Account`, and parse Starknet receipts. The
  ARCHIVE versions are the drop-in Solana equivalents; the merge point is
  adapting ORIG PlayScreen JSX to the ARCHIVE Grid's `onMove`/`onBonus`
  receipt-projection props.
- **`starknet.hash` leaks into "pure" code**: ORIG
  `dojo/game/types/level.ts` and `hooks/useMapLayout.ts`. ARCHIVE
  `useMapLayout` already replaced it; the level.ts compat shim exports only
  the pure `applyStarThresholdModifier`.
- **tailwind v4**: `index.css` uses `@config "../tailwind.config.cjs"` —
  relative to the CSS file; keep `src/index.css` + root `tailwind.config.cjs`
  in the same relative positions.
- **Assets are absolute paths** (`/assets/...`, `/fonts/...`) served from
  `public/` — the Phase 0.3 `git mv` covers them.
- **Node polyfills / ES2022 / wasm + topLevelAwait are load-bearing** for
  `@solana/web3.js` + `@magicblock-labs/ephemeral-rollups-sdk`; do not "clean
  up" the vite plugin list.
- **Port 5175 is shared with ORIG's dev script** — never run both dev servers
  at once.
- **No root pnpm workspace** — all pnpm inside `client/`; the lockfile copied
  in Phase 0 keeps `--frozen-lockfile` and the CI cache key valid; any dep
  change requires a deliberate lockfile update.
- **`.env` is gitignored** and travels to `client-archive/.env` in Phase 0 —
  recreating `client/.env` is a manual, flagged step (missing `.env` ⇒
  paymaster 503 ⇒ session renewal and all sponsored actions silently break).
- **`tools/sync-anchor-idl.mjs` hard-codes `client-budokan` destinations**
  (lines 7–8) — forget the edit and `idl:check`/CI lies.
- **CI/validate.sh atomicity** — Phases 0+1 must land as one commit or every
  push fails.
- **bigint vs BN.js**: the Solana layer uses native bigint (+ bn.js at the
  anchor boundary); the compat `Game` normalizes; watch for bigint reaching
  `JSON.stringify` or React keys in ported pages.
- **StrictMode double-mount**: ARCHIVE chain hooks (watcher subscriptions)
  tolerate it; keep StrictMode on.
- **Seed constants semantics**: `LEVEL_CAP` is 10 (not 50), `BOSS_LEVELS` is
  `[10]` — audit ported MapPage/HUD math that assumed the ORIG values.
- **One `useRebootRun` instance only** (RunProvider) — multiple instances mean
  multiple websocket watchers and conflicting optimistic state.

## Key reference files

| Purpose | Path (post-Phase-0) |
|---|---|
| Run state machine every gameplay hook wraps | `client-archive/src/solana/reboot/useRebootRun.ts` |
| Auto-start / auto-settle / VRF / session / settle-stage panels to absorb | `client-archive/src/ui/pages/RebootPlayScreen.tsx` |
| Already-adapted optimistic grid (use verbatim) | `client-archive/src/ui/components/Grid.tsx` |
| ActiveRunView→Game adapter seam (needs `totalCubes`) | `client-archive/src/compat/dojo/game/models/game.ts` |
| Alias/plugin template the port hangs on | `client-archive/vite.config.ts` |
| Vault UI to transplant into Settings | `client-archive/src/ui/pages/RebootInfoPage.tsx` |
| Largest ORIG rewiring surface | `/home/djizus/zkube/client-budokan/src/ui/pages/PlayScreen.tsx` |
| MagicBlock upstream reference (docs + code) | `/home/djizus/cycling-sim/docs/magicblock-focg.md` |
