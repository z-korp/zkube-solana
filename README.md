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

**Campaign** is free and optional on the money identity, and does not gate
Arcade. Its 100 trials play locally. A connected Solana address identifies the
player; playing needs no device session, signature, or SOL. The 25-byte on-chain
star array is the player's Campaign save, written by their own device and
synchronized across their devices. The program does not verify this progress,
and it has no effect on money.
Updates wait for a funded device session and do not interrupt play. An unfinished
trial resumes on its own device from its saved seed and actions. Every new
attempt draws a fresh 32-byte seed from the platform random source.

The store identity stays walletless and local, with its existing purchase gate
on realms 4–10. Both identities use the same local Campaign client. Campaign
stars grant no SOL, entries, or prize eligibility; emblems 1–12 reflect that
reported progress.

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

Each Daily draws one of ten Campaign realms and one of sixteen protocol
objectives. Its guardian, objective, and realm starting height are fixed for the
whole field, while one global pressure step and a shared eight-tier block table
govern every Daily. Campaign and Daily use the same guardian rule, and scoring
is triangular action score alone with the Daily pressure multiplier applied in
Arcade. Selection is derived from a protocol seed and the
absolute day identifier, so the 160 realm-objective pairs cycle without
replacement and are independently recomputable.

The pot splits between **Score** and **Theme** over the same runs. Score ranks
total performance; Theme ranks only the count attributable to the day's objective.
Both require a positive metric, and Classic folds its empty Theme half back into
Score. Board weights follow `1/rank` and extend through the last rounded payout
that still covers the entry price, with a minimum width of four before limiting
to qualifying players and dropping zero payouts. Payouts floor to 0.001 SOL and dust rolls
forward. The retained board pays up to its explicit capacity, records when the
full width exceeds that bound, and winners claim directly from the finalized
rows.

## What's changing

Approved 2026-08-08 and partially built. Kredits, the protocol draw, the two
Daily boards, direct claim settlement, and the points ladder are in source.

| Unit | Length | Carries |
| --- | --- | --- |
| Day | 24h | the money, realm, guardian, and objective that shape it |
| Draw cycle | 160 days | each realm-objective pair exactly once |

**Kredits replace the per-run signature.** Entries are prepaid in bundles rather
than signed one at a time, because a wallet prompt before every run is fatal to
impulse play. Kredits are one-way — no withdrawal, transfer, or cash-out — and
prizes still pay in SOL. The shop offers 1-, 10-, and 25-Kredit packs at the
same 0.01 SOL unit price.

**Playing funds the pot, not buying.** Spending a Kredit sends 90% of its price
to the following paid Daily's pot. The operator's 10% is swept at purchase,
leaving only prize money in the Kredit vault. Prior play funds today; today's
entries grow the following paid Daily. Nothing is held back from a daily pot
for anything else.

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
the entry price, subject to the minimum-width rule and qualifying field.
Small pots can therefore pay less than an entry price. Zero payouts are dropped.

**Winners claim instead of being pushed a payment.** Finalization allocates one
exact-sized account for each board. The keeper submits the sorted rows in small
chunks, and the program verifies each row against that player's result, the full
ordering, uniqueness, and the program-computed winner count before sealing the
board. Claims stay disabled until sealing; afterwards the program looks up the
owner's position and recomputes that rank's payout directly. Each board's reward
stays claimable for thirty days from its sealing. Spending a Kredit can collect
unclaimed rewards from up to two attached boards in the same transaction;
unavailable attachments are skipped and explicit claiming remains available.
After both windows, anything unclaimed
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
awards another. The realm drawn for a Daily supplies that same guardian bonus,
with no wildcard realm or second bonus pairing.
Mainnet remains gated on the same counsel, economic, and distribution review as
before.

## Architecture

| Component | Role |
| --- | --- |
| `crates/zkube-core` | Deterministic Rust engine: grid, blocks, guardians, scoring, metrics, period and payout math, canonical encoding, replay schedule |
| `crates/zkube-core-wasm` | Node WASM build of the same engine for keeper calculations |
| `crates/zkube-core-ffi` | Native byte boundary over the same engine for Unity |
| `programs/solana` | Anchor program: Campaign stars, competitive records, accounting, boards, settlement |
| MagicBlock ER | Active gameplay and per-row VRF, on a Router-resolved validator |
| `services` | Keeper worker: Daily cadence and last-resort permissionless recovery |
| `unity` | The only client: Android money and local store identities sharing Rust gameplay |

The engine is the single source of truth for game rules, and native Rust, WASM,
and the on-chain program must all agree on the same committed golden vectors
before an ABI can ship. The generated IDL is the contract between program,
keeper, and client.

The Unity client retains the artwork and protocol behavior, with all gameplay
executed by the Rust core over the native FFI. The money identity,
`com.zkorp.zkube`, targets the Solana dApp Store. The store identity,
`com.zkorp.zkube.store`, targets Google Play with an ARM64 and x86_64 AAB,
a local name, a local UTC Daily, and a native purchase to unlock Campaign.
The store identity preserves the v1 local save format. Arcade is on chain only
for the money identity. Store billing and distribution remain in development.

Arcade gameplay runs on a MagicBlock ephemeral rollup, then commits back to base
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
tools/chain/ standalone operator commands and the checked-in program IDL
assets/      authoritative artwork and authored presentation inputs
unity/       native Android client and reproducible Unity build tooling
fixtures/    committed golden vectors and chain fixtures
artifacts/   frozen build artifacts
validate.sh  repository validation entry point
```

## Build and validate

Requires Rust with the pinned toolchain in `rust-toolchain.toml`, Anchor, Node,
pnpm, Python 3, the Unity Editor and Android tools pinned in
`unity/toolchain.json`, including the Rust targets listed for both Android identities. Set
`UNITY_EDITOR` when the Editor is installed outside the default Hub location.
The `NO_DNA=1` prefix is required by the maintainer workstation's sandbox
tooling; it is inert elsewhere and safe to keep on every command.

```bash
NO_DNA=1 ./validate.sh
```

`validate.sh` defines the gates and available iteration scopes. GitHub static
validation is `workflow_dispatch` only and is not a push or pull-request gate.

For Unity iteration, `NO_DNA=1 python3 unity/tools/build.py test` runs the
managed tests against Rust fixtures; add `--test-platform PlayMode` for board interaction tests with
a graphics display. Desktop tests use Linux texture imports; Android artifacts
use Android imports. `NO_DNA=1 python3 unity/tools/build.py android` reproduces the
asset imports, Rust libraries and verified Kotlin wallet AAR, then builds the
money APK under `build/unity/`. Add `--identity store` to build the local store
AAB and its installable inspection APK. Each build produces package inspection
and source provenance reports. These local artifacts use local signing; release certificate acceptance
and publication are separate. Existing `ZKUBE_ANDROID_VERSION_CODE` and
`ZKUBE_ANDROID_VERSION_NAME` overrides apply to Unity too.

The Android store handoff metadata lives in
`unity/dapp-store/publishing.json`. Unity's build tool produces the packages used
for that handoff.

## Platform support

| Surface | Status | Wallet path |
| --- | --- | --- |
| Unity Android (dApp Store / Seeker) | In development | Kotlin Mobile Wallet Adapter plugin |
| Unity Android (Google Play) | In development | Local name; native Campaign purchase |

Seed Vault Wallet is Seeker's built-in wallet and the reference MWA target;
Phantom and Solflare on Android are additional compatibility targets. Paid
Arcade distribution remains subject to the counsel and distribution review
stated above.

The Kotlin MWA plugin requires sign-only v0 transaction support. Returned
message bytes and existing device partial signatures are checked before relay.
Owner transactions pin a 400,000-compute-unit limit and a
1,000-micro-lamport unit price before approval, a 400-lamport maximum priority fee.

## Contributing

`AGENTS.md` holds the working rules for this repository: protocol reference,
transaction-approval policy, and operator procedures. Read it before changing
program state, keeper behaviour, or anything that moves SOL.

## License

Licensed under the Apache License, Version 2.0 — see [`LICENSE`](LICENSE).
Unless you explicitly state otherwise, any contribution intentionally submitted
for inclusion in this repository shall be licensed as above, without any
additional terms or conditions.
