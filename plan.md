# zKube World — Grounded Monorepo and Release Plan

Status: working plan, updated 2026-07-19. Decisions marked **locked** should not
be reopened without an explicit product or protocol decision. This file is a
temporary planning exception to the repository rule that durable architecture
and operations documentation belongs in `README.md` and code comments. Once the
new monorepo is established, approved parts of this plan move there and this
file can be removed.

## Core vision

zKube is two deliberately separate products powered by one deterministic game
engine:

- **Campaign** is an off-chain mobile game for the Apple App Store and Google
  Play. It has ten maps and one hundred authored levels, local-first saves,
  platform cloud/social features, ads, and a restorable remove-ads purchase. It
  contains no wallet, RPC, Arcade screen, real-money play, or cross-link to the
  Arcade product.
- **Arcade** is the on-chain competitive product. It contains the previous
  Daily's free unranked Practice challenge, the current Daily's separately paid
  ranked Arena, and the rolling seven-day Weekly jackpot. Campaign and Story do
  not exist as Arcade modes or on-chain concepts.

Each product is independently complete. Campaign players never need Arcade,
and Arcade players never need Campaign: Practice and a short Arcade-native
onboarding teach every mechanic required for competition. Installing both is an
optional choice for players who want both solo content and paid competition,
not a funnel requirement.

The shared engine is `zkube-core`: deterministic Rust compiled to WASM for web
and mobile consumers, and independently implemented in Cairo against the same
golden vectors. There is no TypeScript rules-engine fork.

Release order is **Campaign → Solana Arcade → Starknet Arcade → additional
chains**. Solana hardening continues in parallel while Campaign is the release
priority. Store approval and technical health gate the Campaign release;
retention and revenue metrics are observed inputs, not blockers.

## Product and money firewall

These invariants apply across every iteration:

- Campaign progression, saves, achievements, ads, and purchases never create or
  imply an Arcade entry, prize right, qualification right, or payout.
- The launch binaries remain separate: the Apple/Google Campaign binary contains
  no Arcade code or calls to action, while the Solana dApp Store/web Arcade
  binary does not embed the one-hundred-level Campaign. Shared branding, engine,
  controls, art language, and the external `zkube.xyz` umbrella make them feel
  related without creating a product or policy dependency.
- Every ranked Arcade run requires a separate owner-signed payment. Device
  sessions cannot authorize entry payments.
- Ranked entry is **pay-to-play**: there is no progression, campaign, or
  eligibility gate — anyone holding the ticket can enter. The free on-ramp is
  Practice (replay yesterday's Daily) or the separate Campaign app, so the
  Arcade needs no campaign or eligibility unlock (a short Arcade-native
  onboarding still teaches the mechanics — see Core vision).
- Practice is free and unranked. It uses the previous Daily's rules and fresh
  verifiable randomness. Practice alone must satisfy every free Arcade
  progression path.
- Settlement is push-only, can be late, and is never cancelled. There are no
  prize claims.
- Empty pots roll forward. Failed-entry refunds are bounded incident recovery
  funded only from operator collateral, never from a prize pot.
- XP, quests, achievements, titles, ratings, emblems, stats, and any session NFT
  never grant currency, entries, mint odds, prize eligibility, or payout
  authority.
- There is no fungible reward, progression, or governance token—ever.
- Scores and replay commitments are independently reproducible from published
  inputs and the protocol's golden vector suite.
- Mainnet remains per-chain gated by counsel, economics, distribution review,
  keeper readiness, signer review, and an exact release approval bundle.

## Locked architecture decisions

### Repository and history

- Create a new **private** staging repository named `z-korp/zkube-world`.
- Do not rename, relink, rewrite, or otherwise disturb the current public
  `z-korp/zkube` or private `z-korp/zkube-solana` repositories during
  development. The current live Starknet deployment must remain unaffected.
- Import the complete committed Solana repository into the empty staging repo
  using native Git object/ref transfer. Preserve every `refs/heads/*` and
  `refs/tags/*` ref and its exact object ID. Do not use `git filter-repo`,
  subtree squashing, history rewriting, or a flat file copy.
- Restructure imported files only afterward with ordinary committed `git mv`
  operations. Existing source repositories remain retained archives; nothing
  is deleted.
- The monorepo stays private until the user explicitly decides otherwise. No
  milestone automatically makes it public.
- Only at a separate human-controlled cutover, after the replacement surfaces
  are live-ready, may the repositories be renamed in this order:
  `z-korp/zkube` → `z-korp/zkube-starknet`, then
  `z-korp/zkube-world` → `z-korp/zkube`.
- Vercel projects, domains, Git links, production routing, and deletion of
  `zkube-budokan-sepolia` are user-owned operations outside this migration.
  None occurs in Phase 0.

A completed local rehearsal established that direct ref import preserves the
Solana source exactly: 199 reachable commits imported as 199, the active branch
tip stayed at `dd2eb7b…`, and a tracked move retained its 14-commit
`git log --follow` history. The real migration must repeat and record these
checks against the source state at migration time.

### Engine and replay constitution

- `zkube-core` owns grid state, blocks, mutators, scoring, ratings, pressure
  tiers, rules catalog, canonical encoding, and replay commitment scheduling.
- The crate is pure Rust and `no_std`-friendly. Chain programs and applications
  are thin adapters around its protocol behavior.
- Campaign and browser simulation use the generated WASM package. A low-end
  Android on-device performance spike is an acceptance gate, not permission to
  create a second engine.
- Before the first deployment, adopt **`zkube-replay-v2`**. It is a versioned,
  canonical SHA-256 encoding over chain domain, challenge, rules hash,
  chain-qualified 32-byte player identity, run ID, mode, ordered VRF outputs,
  and ordered player actions.
- Preserve score behavior and the existing account field used to store the
  replay hash, but intentionally regenerate replay outputs and golden fixtures.
  The committed vectors are the protocol constitution.

### Solana protocol

- Remove undeployed on-chain Campaign accounts, instructions, and progression
  dependencies now. Move authored Campaign content off-chain and minimize the
  v4 ABI before its first deployment.
- The first Solana deployment is USDC-denominated. Initialize the snapshotted
  entry price to exactly **1 USDC = 1,000,000 base units**. There is no
  SOL-priced production phase.
- Later price changes require the existing governance pattern plus explicit
  terms/rules approval. Each entry snapshots price and split values.
- The launch entry path is **direct USDC only**, and the program only ever
  accepts canonical USDC — it never invokes an aggregator and never treats an
  input mint, route, or quote as protocol truth.
- Alternative-token funding (e.g. a client-composed "Pay with BONK" swap into
  USDC before the unchanged exact-USDC `enter_arena_v1`) is **deferred,
  frontend-only, post-launch** work and needs no program change since the
  program is already USDC-only. Design detail is parked in the Parking lot.
- Entries split 75% Daily, 15% operator revenue, and 10% Weekly. Daily pays
  45/25/15/10/5; Weekly pays 60/25/15.
- Winner associated token accounts are created idempotently when needed, with
  their SOL rent absorbed by the operator.
- Preserve separate Base, Router, and resolved Ephemeral Rollup connections;
  resolve placement with delegation status. Preserve one durable
  `active_run_id` and the recovery/settlement safety rules from the repository's
  `AGENTS.md`.
- The first deployment remains paused until the complete keeper is deployed,
  fingerprinted, read-only verified, and included in an exact approval bundle.

### Multi-chain Arcade

- Ship chain-specific applications as build-time flavors from one frontend
  codebase. Do not add runtime chain switching initially.
- The eventual public shape is a root chooser with
  `arcade.zkube.xyz/solana` and `arcade.zkube.xyz/starknet`, but the user owns
  its hosting and routing implementation.
- A stable `ArenaProvider` boundary isolates chain reads, owner-signed entry,
  run lifecycle, replay submission, boards, and payout status.
- Starknet uses native USDC and a fresh implementation proven against the same
  replay vectors. Cairo feasibility and representation constraints must be
  resolved in a spike before contract implementation.
- Denshokan may be required for Starknet session NFTs. Those NFTs have no entry
  value, prize rights, progression authority, or payout authority. Paid owner,
  rank, and payout remain bound to the Starknet account, and NFT transfer can
  never redirect them.

## Target monorepo shape

```text
zkube-world/
├── apps/
│   ├── campaign/                 # Store app; no chain code
│   └── arcade/                   # Build-time Solana/Starknet flavors
├── packages/
│   ├── game-ui/                  # Shared visual game primitives
│   ├── campaign-content/         # Authored maps and level catalog
│   ├── platform-services/        # Save, cloud, ads, IAP adapters
│   ├── arcade-domain/            # Frontend state and view models
│   └── protocol-types/           # Generated public protocol types
├── crates/
│   ├── zkube-core/               # Deterministic Rust engine
│   └── zkube-core-wasm/          # Generated WASM boundary
├── chains/
│   ├── solana/
│   │   ├── program/
│   │   ├── sdk/
│   │   └── keeper/
│   └── starknet/
│       ├── contracts/
│       ├── sdk/
│       └── keeper/
├── services/
│   └── world-indexer/            # Added only for the World Board
└── fixtures/
    └── replays/                  # Versioned cross-language golden vectors
```

The exact package names may be normalized during the move, but the ownership
and dependency directions may not be blurred: applications consume generated
engine/protocol packages; they do not reimplement protocol rules.

## Ownership and handoff contract

**Codex owns all backend work:** root workspace and CI integration, `crates/`,
programs and contracts, keepers, services, replay fixtures and golden vectors,
protocol schemas, generated IDL/ABI/SDK packages, backend chain adapters, and
release/verification tooling.

**Claude owns all frontend work:** `apps/`, visual/UI packages, Arcade frontend
state and controllers, platform services and native shells, Campaign and Arcade
redesigns, assets, animation, interaction, and product copy.

Campaign content has a deliberate seam: Claude authors and catalogs gameplay
content; Codex owns its schema, canonical hashing, validation, and compiler.

The teams hand off through versioned generated packages—not copied types or
parallel implementations:

- `@zkube/core-wasm`
- `@zkube/solana-sdk`
- the later Starknet SDK
- `@zkube/protocol-types`
- golden replay fixtures and contract tests

No agent edits paths owned by the other without an explicit handoff. The
existing implementation and Claude's design artifact are reference inputs; the
redesign is allowed a clean visual and information-architecture break. After
that break, code and tests become the executable acceptance truth.

## Milestones

### Phase 0 — Private monorepo foundation and protocol reset

Purpose: establish the safe workspace and freeze one deterministic truth before
shipping either product.

1. Review all intended dirty and untracked Solana work and commit it explicitly
   in the source repository. Do not import an ambiguous worktree.
2. Record a source ref-to-OID manifest for all branches and tags, run
   `git fsck --full`, and record reachable commit counts.
3. Create empty private `z-korp/zkube-world`; directly import every source
   branch and tag without rewriting history. Compare source/import ref maps,
   object IDs, and reachable commit counts.
4. Create the monorepo restructuring branch and move tracked files with normal
   `git mv`. Sample important paths with `git log --follow` and `git blame`.
5. Establish the root Cargo/pnpm workspace, CI path filters, generated-artifact
   boundaries, and ownership rules. Reserve Starknet paths without importing or
   modifying the live repository.
6. Extract `zkube-core`, compile its WASM package, and prove the Solana wrapper
   preserves intended score/state behavior.
7. Specify `zkube-replay-v2`; regenerate and commit canonical vectors covering
   rules revisions, VRF streams, move streams, final state, score, and hash.
8. Remove on-chain Campaign state and instructions, move authored content to
   the Campaign side, and make Practice sufficient for all free Arcade
   progression.
9. Generate the first stable SDK/type packages for the frontend handoff.
10. Reconcile approved architecture and operations into the new root
    `README.md` and scoped `AGENTS.md` files.

Exit gates:

- Imported ref map, object IDs, commit counts, `fsck`, followed history, and
  sampled blame all pass.
- No existing repository, deployment, Vercel project, or domain was renamed or
  relinked.
- Rust native and WASM pass the full golden vector suite.
- Low-end Android WASM performance is acceptable.
- The minimized Solana ABI is frozen before first deployment and contains no
  Campaign concept.
- Root builds and tests are green; generated SDK boundaries are consumable by
  the frontend without backend source ownership leaks.

### Phase 1 — Campaign store release

Purpose: ship the broad off-chain game first and validate the engine and content
pipeline without financial or chain coupling.

- Ten maps and one hundred authored levels using `zkube-core` WASM.
- Local-first saves with migrations and corruption recovery.
- Game Center and Google Play Games cloud/social integration where supported.
- Ads plus a restorable one-time remove-ads purchase.
- Separate bundle IDs, store listings, privacy disclosures, policy checklist,
  crash reporting, and release tracks.
- No wallet, chain SDK, RPC, Arcade navigation, prize language, or in-app link
  to real-money play.

Exit gates:

- Apple App Store and Google Play approval.
- Crash-free and save-integrity health are acceptable.
- Ads/IAP plumbing and restore behavior are verified.
- Retention, progression, and monetization metrics are reported for learning,
  not treated as hard release blockers.

### Phase 2 — Solana Arcade Devnet and release readiness

Purpose: finish and harden the already in-flight Solana product while Campaign
is prepared, then release it after Campaign.

- Complete Daily/Weekly program state, exact 1 USDC entries, token-account
  custody, push settlement, incident refunds, expiry, recovery, and cleanup.
- Complete the independently funded keeper with genesis, ProgramData,
  instruction, PDA, cadence, write-count, spend, and reserve guards.
- Redesign Arcade around four primary destinations:
  **Home · Arena · Quests · Profile**. There is no Campaign tab.
- Arena exposes owner-signed paid entry, live Daily/Weekly pots, ranked boards,
  attempts, compact profiles, quest/streak status, Practice comparison, and
  pushed-payout status.
- Launch is **direct USDC only**. Alternative-token funding ("Pay with BONK"
  autoswap) is a deferred, frontend-only fast-follow (see Parking lot) and is
  out of Phase-2 launch scope.
- Practice uses yesterday's challenge and fresh VRF, with no entry or rank.
- Publish a Devnet KPI dashboard for paid runs/DAU, retry funnel, quest
  completion, operational settlement, and Thursday jackpot behavior.

Exit gates:

- Program, keeper, generated client, conformance, conservation, recovery, and
  adversarial suites pass.
- Every entry snapshots exactly 1,000,000 USDC base units at initialization and
  the configured split; there is no lamport-denominated entry path.
- No swap-assisted entry at launch (deferred). The program remains byte-for-byte
  agnostic to any input token and aggregator; the only entry path is exact USDC.
- No owner-signed payment can be authorized by a device session.
- Devnet deployment, funding, keeper enablement, and any later mainnet action
  each remain subject to their exact approval bundle.
- Mainnet additionally requires counsel, economic, distribution, and operations
  review. It launches directly in USDC.

### Phase 3 — Starknet Arcade parity

Purpose: add the second chain only after the shared protocol and Solana product
have become stable evidence.

1. Run a focused Cairo feasibility spike for canonical encoding, integer
   semantics, SHA-256 cost/implementation, rules representation, and fixture
   ingestion.
2. Implement fresh Starknet contracts and SDKs against the approved protocol;
   do not port obsolete Campaign concepts.
3. Pass every applicable `zkube-replay-v2` vector bit-for-bit and add
   chain-specific custody, USDC, settlement, and failure-path tests.
4. Integrate Denshokan only behind the session-NFT restrictions above.
5. Build the Starknet Arcade flavor through the same `ArenaProvider` boundary.
6. Gate Starknet Devnet/testnet and mainnet independently from Solana.

Exit gates:

- Cairo feasibility risks are resolved explicitly, not hidden in adapters.
- Rust, Solana, WASM, and Cairo agree on all shared vectors.
- Starknet USDC custody and push settlement pass conservation and adversarial
  tests.
- The existing live Starknet repository and deployment remain intact until the
  user initiates the final cutover.

### Repository-name cutover — human controlled, not an iteration

This gate happens only after replacement Campaign and Arcade surfaces are
live-ready and the user chooses the cutover window.

- Freeze and record current ref maps for both repositories; verify full history
  and create independent recovery bundles before any rename.
- Audit raw GitHub URLs, package metadata, Actions, store metadata, and external
  integrations for name coupling.
- Rename the legacy public repo to `z-korp/zkube-starknet`, preserving all of
  its history and refs.
- Rename the private staging repo to `z-korp/zkube` only after the first rename
  is verified.
- Re-verify refs, clone/fetch behavior, CI, releases, and history after each
  rename.
- The user separately performs Vercel/project/domain relinking and may delete
  `zkube-budokan-sepolia`. Codex does not perform or bundle those operations
  into the Git migration.
- Repository visibility remains private unless the user explicitly changes it.

### Phase 4 — World Board and World Championship

Purpose: add cross-chain status first, then a clearly graded unified-money
event.

- A lightweight indexer reads finalized boards from both chains, archives
  replay hashes and shared Daily configurations, and exposes only verifiable
  derived data.
- The World Board displays regional ranks and World titles; per-chain prizes
  remain isolated.
- A later monthly championship is hosted on Solana, uses a separate pot and
  fixed free attempts, and accepts qualification from finalized regional
  boards through a published operator-attested audit bundle.
- Region contributions may use CCTP when its production support and threat model
  pass a fresh review. Trust-minimized messaging replaces attestation only when
  it is mature enough to reduce—not obscure—risk.

Exit gates:

- Every aggregated row is independently traceable to finalized chain state.
- The first championship settles end-to-end in USDC and publishes its complete
  audit bundle without manual state edits.

## Interface contracts

### Core result

At minimum, the deterministic engine exposes stable equivalents of:

```text
RulesRevision
RulesHash
Challenge
Mode = Practice | Ranked
VrfOutput
PlayerAction
RunResult { score, final_state, replay_hash }
```

Serialization, integer widths, overflow behavior, endianness, ordering, and
domain separators are part of the versioned protocol—not implementation
details.

### Arena provider

Frontend chain flavors consume a provider with stable capabilities for:

```text
readConfig
readArena
readPlayer
readLeaderboard
quoteEntryFunding
enterRankedRun
preparePracticeRun
readOrRecoverActiveRun
submitReplay
readPayoutStatus
```

The exact TypeScript surface is generated from backend-owned protocol packages.
The provider never gives a device session authority over owner-paid entry or
payout destination.

`quoteEntryFunding` (deferred with the autoswap fast-follow — not a launch
capability) returns integer base-unit amounts and a short-lived, validated quote
for a supported input mint. It is advisory until the complete
transaction is rebuilt, simulated, reviewed by the wallet owner, signed, and
confirmed. API transport may be direct/keyless for development or use a
stateless rate-limited credential proxy in production; it must never possess a
wallet, signer, custody funds, or decide whether an entry succeeded.

## Validation and approval gates

### Local and CI validation

- Native Rust and WASM must pass identical unit, property, and golden-vector
  suites.
- Solana must retain its full program, service, IDL, type, lint, Vitest, and
  production-build gates, always with `NO_DNA=1` for chain commands.
- Cairo gets the same shared vector corpus plus Starknet-specific security,
  custody, and resource-bound tests.
- Campaign tests save migration, offline behavior, corrupted storage, restore
  purchases, ads failure, platform-service absence, and low-end device
  performance.
- Arcade flavors test disconnected/read-only states, wrong network, stale RPC,
  rejected signature, unresolved or expired runs, late settlement, and
  idempotent payout-account creation.
- Swap-assisted entry tests are deferred with the autoswap fast-follow. When
  built: integer base units only; validate the canonical USDC mint, input-mint
  metadata, instruction programs/accounts, quote expiry, minimum output,
  transaction limits, simulation result, and post-confirmation entry state;
  prove atomic rollback except the unavoidable network fee.

### Actions that always require exact approval

- Any deployment or transaction signing/sending.
- Program or contract initialization and upgrade.
- Funding, withdrawals, keeper signer or authority changes.
- Initial keeper enablement and recurring keeper release fingerprint.
- Governance, incident declaration, rules/terms, entry price, or split changes.
- Mainnet action on any chain.
- Enabling a new swap aggregator or broadening the supported input-mint policy.
- Repository rename, visibility change, archive/delete operation, or production
  Git-link change.
- Vercel project/domain modification or deletion.

## Research still required

### Cairo conformance spike

Before Phase 3 implementation, produce a short executable spike answering:

- Can Cairo reproduce the canonical `zkube-replay-v2` byte encoding exactly?
- What SHA-256 implementation and resource cost are acceptable?
- Which Rust integer/overflow semantics require explicit Cairo constraints?
- How are rules hashes and chain-qualified player identities represented?
- Can the full fixture suite run in CI without a manually maintained translation
  layer?

Failure does not authorize a silent format fork. Any required protocol revision
must be versioned and re-approved across all consumers.

## Decision log

- **Locked:** two separate products and one shared deterministic engine.
- **Locked:** Campaign first, then Solana, then Starknet, then more chains;
  Solana hardening may proceed in parallel.
- **Locked:** Campaign approval and technical health gate release; business
  metrics are observational.
- **Locked:** private staging repository is `z-korp/zkube-world`.
- **Locked:** current repositories and the live Starknet deployment remain
  untouched throughout development.
- **Locked:** native full-ref Git import, followed by normal tracked moves;
  no `git filter-repo`, rewrite, squash, or source-repo deletion.
- **Locked:** final two-step repository rename is a separate human-controlled
  cutover.
- **Locked:** the staging monorepo stays private until an explicit user decision.
- **Locked:** Vercel, domains, routing, and `zkube-budokan-sepolia` cleanup are
  user-owned and outside the migration.
- **Locked:** Solana launches from its first deployment at exactly 1 USDC
  (1,000,000 base units), not SOL.
- **Locked:** ranked Arcade entry is pay-to-play — no progression, campaign, or
  eligibility gate. The free on-ramp is Practice (replay yesterday's Daily) or
  the separate Campaign app; the Arcade needs no campaign/eligibility unlock.
- **Locked:** launch is direct-USDC-only. Alternative-token "Pay with BONK"
  autoswap is a deferred, frontend-only fast-follow; the program never accepts
  BONK or calls an aggregator, and direct USDC is the only entry path at launch.
- **Locked:** Rust/WASM is the only Campaign/browser engine; no TypeScript fork.
- **Locked:** `zkube-replay-v2` replaces the undeployed Solana-specific replay
  commitment before vectors and ABI freeze.
- **Locked:** build-time Arcade chain flavors precede runtime switching.
- **Locked:** remove every on-chain Campaign concept before Solana v4 deployment.
- **Locked:** Denshokan session NFTs cannot influence money or progression.
- **Locked:** Codex owns backend; Claude owns frontend, with generated package
  contracts as the handoff boundary.
- **Locked:** Solana hosts the first World Championship, subject to a fresh
  mainnet approval bundle.

## Parking lot

These are intentionally deferred and do not block Phase 0:

- Whether Practice is discoverable only inside Arena or also through a Home
  onboarding card. It remains the only free Arcade progression route either
  way.
- Whether a later Solana-dApp-Store-only combined bundle should include the full
  Campaign after both standalone products have shipped. Consider it only if
  measured install friction warrants the extra binary size and QA surface, and
  counsel confirms the product firewall remains clear. It is not v1 scope and
  never changes the Apple/Google Campaign-only binary.
- Exact Campaign ad placement and remove-ads price, subject to store policy and
  UX review.
- Which chain follows Starknet; it must first pass the replay vectors and ship a
  conforming `ArenaProvider`.
- Prepaid run credits, cosmetic weekly chests, replay cards, and deterministic
  guardian mints. Each requires separate product, economic, and where applicable
  counsel review.
- Alternative-token "Pay with BONK" autoswap (frontend-only, post-launch). Design
  kept for reference: one owner-signed atomic versioned tx — validated swap setup
  → aggregator swap into the owner's USDC → unchanged exact-USDC `enter_arena_v1`
  → cleanup; accept a route only when post-slippage min USDC output ≥ the ticket;
  fall back to a clearly separated user-approved swap-then-entry (two signatures)
  when the atomic tx exceeds size/account/compute limits. Jupiter Swap V2
  `/build` is the first adapter candidate (recheck at build time). Only ever
  explicitly supported, liquid input mints, validated by mint address (never
  symbol/image). Enabling a new aggregator or broadening input mints needs exact
  approval.

## References

- Current Solana implementation: this repository, treated as the migration
  source until the exact ref import.
- Current Starknet implementation: `z-korp/zkube`, kept live and unchanged until
  the human-controlled cutover.
- Claude's frontend/design artifact: retained as a visual and interaction
  reference for the frontend owner, not as protocol truth.
- Durable operational truth: the applicable repository `README.md`, scoped
  `AGENTS.md`, committed golden vectors, generated interfaces, and passing tests.
