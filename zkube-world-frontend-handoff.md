# zKube World — Frontend session handoff (Claude)

You are the **frontend owner** for the `zkube-world` monorepo. Codex owns the
backend and is executing Phase 0. This file gets you productive without stepping
on Codex or re-deriving the product.

> Drop this in the repo as `apps/AGENTS.md` (repo convention: scoped `AGENTS.md`,
> with `CLAUDE.md` symlinked to it) on your own frontend branch, once `apps/`
> exists. Until then, read it from here.

## Read first, in this order
1. Repo root `README.md` and `AGENTS.md` — **authoritative product truth + rules.** Trust these over everything else.
2. The nearest scoped `AGENTS.md`.
3. `/home/djizus/zkube-solana/plan.md` — the multi-phase roadmap & decision log. **Caveat: its economy numbers are stale** (it predates the Season / 60-20-10-10 model). Use it for sequencing and rationale, not for splits/payouts.
4. This file.

## Your lane
- **You own frontend:** `apps/campaign`, `apps/arcade`, `packages/game-ui`, `packages/arcade-domain`, `packages/platform-services`, assets, animation, interaction, product copy, the Campaign + Arcade redesigns.
- **Codex owns backend — never edit:** `crates/` (`zkube-core`, `zkube-core-wasm`), `chains/`, `packages/protocol-types`, `packages/solana-sdk`, keepers, `fixtures/`, `provenance/`, validation, CI. You **consume** these as generated packages.
- **Campaign-content seam:** you author and catalog gameplay content; Codex owns its schema, canonical hashing, validation, and compiler.
- Work on your **own branch off `refactor/phase0-backend`** (e.g. `feat/frontend`). Never commit to imported legacy refs. Coordinate cross-lane changes through an explicit handoff, never by editing Codex's paths.

## Current repo state (at handoff)
- Codex is on `refactor/phase0-backend`. Scaffolded: `crates/`, `chains/solana`, `fixtures/replays`, `packages/protocol-types`, `packages/solana-sdk`. **No `apps/` yet — that's you.**
- **Your source material:** `legacy/solana-client` — the preserved React/Vite frontend WIP. Rework *from* it into `apps/` + `packages/`; do not redesign it in place (it's a provenance snapshot).
- **Build against generated packages** (check they exist / build before relying on them — `ls packages/`, and whether `crates/zkube-core-wasm` produces `@zkube/core-wasm`):
  - `@zkube/core-wasm` — the deterministic engine. Run the game through this. **Never reintroduce a client-side game simulation.**
  - `@zkube/protocol-types` — generated types.
  - `@zkube/solana-sdk` — generated builders/codecs.
  - golden replay fixtures.
- If a package isn't ready yet, build against a **mock `ArenaProvider` + type stubs** and swap the real ones in later.

## The product (summary — but the repo README/AGENTS are truth)
Two separate products, one engine:

- **Campaign** (`apps/campaign`): offline Capacitor iOS/Android game, 10 maps / 100 levels on `@zkube/core-wasm`, local-first saves + Game Center/Play Games + ads + one restorable remove-ads IAP. **Zero chain code, wallet pkgs, RPC, prize language, or Arcade links — enforced in CI.**
- **Arcade** (`apps/arcade`): wallet-native competitive PWA (build-time chain flavor; Solana first). Free Practice + paid Ranked. **4 tabs: Home · Arena · Quests · Profile — no Campaign tab.**

### Arcade economy — THIS supersedes the old design artifact's numbers
- Entry: owner-signed **exactly 1 USDC** (1,000,000 base units) per Ranked run. **Pay-to-play, no gate.** Device sessions can never authorize the transfer.
- Split per entry: **60% → following Daily · 20% → following Weekly · 10% → current Season · 10% → team.** Entries fund the *next* Daily/Weekly and the *current* 28-day Season (read the split from on-chain terms — never hardcode).
- **Three competitions to surface, not two:**
  - **Daily** — one best run per wallet; pays top 5 (45/25/15/10/5).
  - **Weekly** — **three rotating skill bounties** (combo / single-action / full-run), each pays 60/25/15; a wallet can win more than one.
  - **Season** — 28 days (Monday-aligned); best 20 Daily-band results; points 100/60/30/10/2 with rank caps; pays 45/25/15/10/5.
- Settlement is **push-only; no refunds, no claims, no incidents** — entries resolve scored-or-expired (`entries_scored + entries_expired == entries_paid`). Payouts round down to **whole USDC**; every remainder rolls into the next same-type competition.
- **Launch seed** (one-time subsidy): 100 Daily / 150 Weekly / 250 Season USDC, so early pots aren't empty.
- **Cadence:** entries close **23:00 UTC**, runs continue to **23:30**, then force-finish. UI shows both the *current guaranteed* prize and the *following-period building* funding, and a two-phase countdown (entries-close, then run-deadline).
- **Practice:** free/unranked, yesterday's rules + fresh VRF, no board row. It's the free on-ramp and the only free progression path.
- **"Pay with BONK"** is a deferred frontend-only fast-follow (client swap into USDC before the unchanged entry). **Direct USDC only at launch.**
- **No token, ever.** XP/quests/achievements/titles/emblems never grant currency, entries, or prize eligibility.

### What changed vs the earlier design artifact
- Arena is now **Daily / Weekly / Season** (three views). Weekly is three bounty boards; Season is a new standings view.
- Entry sheet: 1 USDC, the **60/20/10/10** split from on-chain terms, **USDC balance + ATA** check (not SOL/faucet), "non-refundable · scored or expired," and a note that your entry seeds the *following* period.
- Pot display distinguishes **current guaranteed** (already funded) from **building** (this period's entries → next period).
- No claim/refund UI anywhere.

## First-session tasks (order; parallel-safe with Codex)
1. Read repo `README.md`/`AGENTS.md` + `plan.md`; `ls packages/` and confirm what's buildable.
2. Cut your frontend branch off `refactor/phase0-backend`.
3. Scaffold `packages/game-ui` by extracting shared board/animation/audio/render primitives from `legacy/solana-client` (Grid, Block, HUD chrome, shared kit).
4. Scaffold `apps/arcade` on a **mock `ArenaProvider`**: the 4-tab shell + Daily/Weekly/Season Arena + the 1 USDC entry sheet + Practice + push-settlement receipts.
5. Scaffold `apps/campaign` (Capacitor) on `@zkube/core-wasm` + `platform-services`; wire the **CI policy wall**.
6. Re-cut the design artifact to the new economy (it's reference, not truth).

## Guardrails (hard)
- **Consume, never reimplement:** no scoring, period math, payout arithmetic, replay encoding, or account layouts in TS — all from generated packages. No client-side game sim; render authoritative engine/chain output.
- **Money safety:** owner wallet signs every entry; device sessions never authorize a transfer or payout destination.
- **Product wall:** the Campaign binary carries zero chain/wallet/RPC/prize/Arcade-link content — CI enforces it.
- **Never touch Codex-owned paths** without an explicit handoff.
- **No deploy, sign, transaction, repo rename, or Vercel/domain change without exact human approval.** Prefix Solana/Anchor/pnpm chain commands with `NO_DNA=1`.
- Preserve unrelated work; discover with `rg`; no destructive cleanups.

## Design system to preserve (from `legacy/solana-client`)
Tailwind v4 + shadcn/Radix (new-york); **Outfit** (body) + **Fredericka the Great** (display); 10 per-zone civilization accent themes via `data-theme`; the three-register look (glass-dark UI / illustrated board / carved-metal HUD); the shared kit — ArcadeButton, SegmentedTabs, Sheet, Card, StatTile, PageHeader, LevelRing, PlayerIdentityHeader, EmptyState, InfoSheet; mobile-first, desktop phone-frame, floating pill bottom nav.

## References
- Repo `README.md` + `AGENTS.md` — product/economy truth (Season, 60/20/10/10, three Weekly bounties, no refunds).
- `/home/djizus/zkube-solana/plan.md` — roadmap & decision log (economy numbers stale; sequencing/rationale still good).
- Design artifact (needs re-cut to the new economy): https://claude.ai/code/artifact/6fdf47b0-eb67-4dc4-a54e-ecd0e5764305
- `legacy/solana-client` — frontend migration source.
