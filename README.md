# zKube on Solana

zKube is a wallet-native puzzle game for the Solana dApp Store and Seeker: a
falling-block board where clearing lines feeds combos, and where a paid run
competes for a real SOL prize pot.

One application, two modes. **Campaign** is a free 100-level world map.
**Arcade** is the competitive mode — each ranked run costs exactly 0.01 SOL and
plays for the Daily's Score and Theme boards.

zKube previously ran on Starknet, where it spent several months among the
network's most-used contracts. This repository is the Solana rewrite, built on
MagicBlock ephemeral rollups so that gameplay executes on-chain at input speed
while money and records settle on Solana base layer.

## Status

There is no live deployment. The former v4 Devnet deployment was abandoned and
v5 will require a fresh bootstrap. Mainnet remains gated on counsel, economic,
and distribution review, because paying SOL to compete for SOL is skill-gaming
territory that needs a legal answer before it takes real money.

## How it works

This section describes the v5 source being prepared for a fresh bootstrap. It is
not a description of deployed state.

The connected Solana address is the player identity. There are no embedded
wallets or recovery codes.

**Campaign** is free and optional, and never gates Arcade. It is ten zones of
ten levels — 100 levels, 300 possible stars — stored as one packed 25-byte,
two-bits-per-level array. The packed star record is Campaign's only progression,
and Campaign never grants SOL, entries, or prize eligibility. A level's score
target, authored cumulative Shape, and authored one-action Blow are three
independent star sources that latch in any order. Reaching every authored source
completes the level; exhausting the move budget or board ends it with latched
stars kept.

**Arcade** is competition only. The owner prepays Kredits at exactly 0.01 SOL
(10,000,000 lamports) each. Spending one Kredit routes:

| Destination | Share |
| --- | ---: |
| Following paid Daily pot | 90% |
| Operator revenue | 10% |

Entries fund the *next paid Daily*, even across a suspension, so every pot is
prepaid before anyone can play for it. Days run on UTC: entries remain open
until live runs freeze at 23:59. A paid entry becomes exactly one scored or
expired entry, with no refund path, and the on-chain invariant is
`entries_scored + entries_expired == entries_paid`.

Each Daily uses one complete configuration from a published content pool. Its
realm, permanent guardian mutator, guardian bonus, objective, and starting
height are fixed for the whole field, while one global pressure profile governs
every Daily. Daily uses neutral passive scoring; Campaign realms keep their
authored line-clear and perfect-clear bonuses.
Selection is derived from a protocol seed and the day identifier, so tomorrow
is independently recomputable today and a pool cycles without replacement
before repeating.

The pot splits between **Score** and **Theme** over the same runs. Score ranks
total performance; Theme ranks only points attributable to the day's objective.
Both require a positive metric, and Classic folds its empty Theme half back into
Score. Board weights follow `1/rank` and extend through the last rounded payout
that still covers the entry price. Payouts floor to 0.001 SOL and dust rolls
forward. The retained board pays up to its explicit capacity, records when the
full width exceeds that bound, and winners claim directly from the finalized
rows.

## What's changing

Approved 2026-08-08 and partially built. Kredits, the content pool, the two
Daily boards, direct claim settlement, and the points ladder are in source.

| Unit | Length | Carries |
| --- | --- | --- |
| Day | 24h | the money, realm, active mutator, and objective that shape it |
| Pool revision | Until replaced | authored Daily configurations and global pressure |

**Kredits replace the per-run signature.** Entries are prepaid in bundles rather
than signed one at a time, because a wallet prompt before every run is fatal to
impulse play. Kredits are one-way — no withdrawal, transfer, or cash-out — and
prizes still pay in SOL. The shop offers 1-, 10-, and 25-Kredit packs at the
same 0.01 SOL unit price.

**Playing funds the pot, not buying.** Spending a Kredit sends 90% of its price
to the following paid Daily's pot; the other 10% is operator revenue. Prior play
funds today, so the pot rises with how much the game is actually played. It also
swings across the week, and deliberately so — the biggest pots land on the
quietest days, which is exactly when playing is worth the most. Nothing is held
back from a daily pot for anything else.

The daily pot then divides across two boards scored from the same runs — **Score**
takes 50% and **Theme** takes 50% — so one entry places on both. Score ranks the
run's total. Theme ranks only the part of it earned by playing that day's
objective, which is a different thing every day: destroying size-N blocks on a
Blocks day, qualifying combo moves on a Combo day, exact-N clears on an
ExactLines day. Clear a lot carelessly and you win Score; play only the theme and
you win Theme. On a Classic day there is no theme to play, so the whole pot goes
to Score.

**Payout width becomes a rule instead of a count.** Weights fall off as
`1/rank`, and a board pays down to the last place whose payout still meets
the entry price. Everyone who places made money, and the number of places grows
with the field instead of staying at five.

**Winners claim instead of being pushed a payment.** Finalization allocates one
exact-sized account for each board. The keeper submits the sorted rows in small
chunks, and the program verifies each row against that player's result, the full
ordering, uniqueness, and the program-computed winner count before sealing the
board. Claims stay disabled until sealing; afterwards the program looks up the
owner's position and recomputes that rank's payout directly. Each board's reward
stays claimable for thirty days from its sealing, and anything you are still
owed is collected automatically the next time you spend a Kredit, so returning
players never make a separate trip. After both windows, anything unclaimed
returns to the next Daily pot, never to operator revenue.

**A persistent points ladder replaces the season bands.** Placing on a board
earns `50 · ln(entrants / rank)`, so a strong finish in a deep field is worth
more than the same rank in a thin one. Points only ever accumulate, never decay,
and pay no SOL; the reward is a named tier shown beside you on every
leaderboard. They are computed on chain from the finalized board, so anyone can
recompute and verify them. The entry streak remains visible attendance but does
not multiply points. A championship is discretionary,
unscheduled, and funded separately rather than skimmed from Daily pots.

Every Campaign and Arcade run starts with one reroll of the incoming row and
can hold at most three beside its guardian bonus. A perfect clear in either mode
awards another. Daily pool entries still
pin that guardian bonus, with no wildcard realm or second bonus pairing.
Mainnet remains gated on the same counsel, economic, and distribution review as
before.

## Architecture

| Component | Role |
| --- | --- |
| `crates/zkube-core` | Deterministic Rust engine: grid, blocks, mutators, scoring, metrics, period and payout math, canonical encoding, replay schedule |
| `crates/zkube-core-wasm` | WASM build of the same engine for the client |
| `programs/solana` | Anchor program: Campaign stars, competitive records, accounting, boards, settlement |
| MagicBlock ER | Active gameplay and per-row VRF, on a Router-resolved validator |
| `services` | Keeper worker: Daily preparation, recovery, settlement, archival, cleanup |
| `client` | Static PWA/TWA — wallet, Campaign, and Arcade UI, with no server signer |

The engine is the single source of truth for game rules, and native Rust, WASM,
and the on-chain program must all agree on the same committed golden vectors
before an ABI can ship. The generated IDL is the contract between program,
keeper, and client.

Gameplay runs on a MagicBlock ephemeral rollup, then commits back to base
layer. At a run's deadline the ER freezes the last fully accepted state and
appends a deadline event: a run with at least one accepted action is scored from
that partial state, while an untouched run expires. Late VRF output is ignored,
and expired state can never become scoreable later.

Replay commitments bind the chain domain, challenge, rules hash, player, run ID,
and mode, then fold ordered VRF, action, bonus, abandon, and deadline events
with SHA-256. Every payout-bearing leaderboard row retains its replay
commitment, so results stay independently recomputable while move lists live
off-chain.

The keeper is an independently funded worker with a bounded signer. It cannot
deploy, initialize, seed pots, change rules, withdraw revenue, or reach mainnet;
its write authority is pinned to a fingerprinted release and hard per-pass
write and spend ceilings. It treats all RPC data as untrusted and validates
cluster genesis, program identity, account owner, length, discriminator,
version, and PDA derivation before decoding anything.

## Repository layout

```
crates/      deterministic engine (core, WASM bindings, codegen)
programs/    Anchor program — state, instructions, game rules
services/    keeper worker and chain services
client/      React PWA/TWA
fixtures/    committed golden vectors and chain fixtures
artifacts/   frozen build artifacts
validate.sh  program validation entry point
```

## Build and validate

Requires Rust with the pinned toolchain in `rust-toolchain.toml`, Anchor, Node,
and pnpm. The `NO_DNA=1` prefix is required by the maintainer workstation's
sandbox tooling; it is inert elsewhere and safe to keep on every command.

```bash
NO_DNA=1 ./validate.sh program

cd services
NO_DNA=1 pnpm install --frozen-lockfile
NO_DNA=1 pnpm run build
NO_DNA=1 pnpm test

cd ../client
NO_DNA=1 pnpm idl:check
NO_DNA=1 pnpm core:wasm:sync
NO_DNA=1 pnpm core:wasm:check
NO_DNA=1 pnpm exec tsc -b --pretty false
NO_DNA=1 pnpm lint
NO_DNA=1 pnpm exec vitest run
NO_DNA=1 pnpm build
```

These local gates are authoritative. GitHub static validation is
`workflow_dispatch` only and is not a push or pull-request gate. Tests must
cover exact lamport conservation, period rollover, deadline freezing, replay
parity, ER recovery, account validation, and Campaign's inability to mutate
competitive records.

## Platform support

| Surface | Status | Wallet path |
| --- | --- | --- |
| Desktop browser | Supported | Wallet Standard extension |
| Android Chrome | Supported | Mobile Wallet Adapter |
| Chrome-installed PWA | Supported | Mobile Wallet Adapter |
| TWA (dApp Store / Seeker) | Target | Mobile Wallet Adapter |
| iOS | Not claimed supported | — |
| Other Android browsers | Not claimed supported | — |

Seed Vault Wallet is Seeker's built-in wallet and the reference MWA target;
Phantom and Solflare on Android also work but are not requirements. iOS and
non-Chrome Android browsers are untested rather than deliberately blocked.

`client/src/platform/capabilities.ts` classifies observable browser signals
only, and MWA registration follows that classification, so a desktop or iOS
browser never registers the mobile connector. TWA detection requires Android,
standalone display mode, and an `android-app://` referrer together, so a plain
Android browser or installed PWA is never promoted on user agent alone.

Signing is sign-only by design: the client requires
`solana:signTransaction` at transaction version `0`, rejects wallets that can
only sign-and-send, and fails the check rather than accepting a mutated message
or a discarded device-session partial signature. Owner transactions pin a
400,000-compute-unit limit and 1,000-micro-lamport unit price before approval —
a 400-lamport maximum priority fee — which also prevents wallet-side fee
message enhancement.

### Local device testing over HTTPS

The dev preview exposes a read-only capability panel, but a physical device must
load it from a trusted HTTPS origin: plain HTTP on a LAN address is not a secure
context, and the pinned MWA package will not register.

Create a development certificate **outside this repository** with a locally
trusted CA such as `mkcert`, include the workstation LAN IP or test hostname,
install that CA on the test device, then point Vite at the files:

```bash
cd client
NO_DNA=1 ZKUBE_HTTPS_CERT_PATH=/absolute/path/outside/repo/dev-cert.pem \
  ZKUBE_HTTPS_KEY_PATH=/absolute/path/outside/repo/dev-key.pem pnpm dev
```

Open `https://<certificate-host-or-lan-ip>:5175/?dev=1` and expand
`Capability diagnostics`; `?dev=0` clears the opt-in. The panel reports the
classified platform, secure-context and WebView signals, MWA support reason,
and each discovered wallet's chains, feature keys, and supported transaction
versions. It reads registry metadata only — it never connects, authorizes,
signs, or sends — and the whole `client/src/dev/` harness is gated on
`import.meta.env.DEV`, so production builds eliminate it.

Certificate and key suffixes are ignored repository-wide. Keep all generated TLS
material outside the worktree, and never use browser flags that weaken
secure-context or certificate checks.

## Contributing

`AGENTS.md` holds the working rules for this repository: protocol reference,
transaction-approval policy, and operator procedures. Read it before changing
program state, keeper behaviour, or anything that moves SOL.

## License

Licensed under the Apache License, Version 2.0 — see [`LICENSE`](LICENSE).
Unless you explicitly state otherwise, any contribution intentionally submitted
for inclusion in this repository shall be licensed as above, without any
additional terms or conditions.
