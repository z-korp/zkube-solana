# zKube on Solana

zKube is a wallet-native puzzle game for the Solana dApp Store and Seeker: a
falling-block board where clearing lines feeds combos, and where a paid run
competes for a real SOL prize pot.

One application, two modes. **Campaign** is a free 100-level world map.
**Arcade** is the competitive mode — each ranked run costs exactly 0.01 SOL and
plays for that period's Daily, Weekly, and Season pots.

- Play: <https://zkube-solana.vercel.app/>
- Demo: <https://youtu.be/Kx3BbohxvNA>
- Program: [`Dz9RaTXpp4vadhBS6oT3RPLjqTT4M4RVwfpowjumSJyd`](https://explorer.solana.com/address/Dz9RaTXpp4vadhBS6oT3RPLjqTT4M4RVwfpowjumSJyd?cluster=devnet)
  on Devnet

zKube previously ran on Starknet, where it spent several months among the
network's most-used contracts. This repository is the Solana rewrite, built on
MagicBlock ephemeral rollups so that gameplay executes on-chain at input speed
while money and records settle on Solana base layer.

## Status

Live on **Devnet**. Mainnet is deliberately gated on counsel, economic, and
distribution review, because paying SOL to compete for SOL is skill-gaming
territory that needs a legal answer before it takes real money.

## How it works

The connected Solana address is the player identity. There are no embedded
wallets, recovery codes, deposits, soft currencies, shops, passes, token swaps,
or prize claims.

**Campaign** is free and optional, and never gates Arcade. It is ten zones of
ten levels — 100 levels, 300 possible stars — stored as one packed 25-byte,
two-bits-per-level array. Stars are the only progression in the game: there is
no XP, no quests, no achievements, no ratings. Campaign never grants SOL,
entries, or prize eligibility.

**Arcade** is competition only. Every ranked run requires a separate
owner-signed transfer of exactly 0.01 SOL (10,000,000 lamports), split as:

| Destination | Share |
| --- | ---: |
| Following Daily pot | 60% |
| Following Weekly pot | 20% |
| Following 28-day Season pot | 10% |
| Operator revenue | 10% |

Entries fund the *next* period, so every pot is fully prepaid before anyone can
play for it — the prize you see is the prize that exists. Days run on UTC:
entries close at 23:45 and live runs freeze at 23:59.

- **Daily** keeps one best score per wallet; top five split 45/25/15/10/5.
- **Weekly** picks three deterministic skill metrics (a combo metric, a
  single-action metric, and a full-run metric), splits its pot equally between
  the three boards, and pays 60/25/15 on each.
- **Season** is a Monday-aligned 28-day period scored from each wallet's best
  20 finalized Daily band results; top five split 45/25/15/10/5.

Settlement is atomic, push-only, and never cancelled — winners are paid without
claiming. It may be late, but a late payout is still paid. A paid entry becomes
exactly one scored or expired entry, with no refund path, and the on-chain
invariant is `entries_scored + entries_expired == entries_paid`. Payouts floor
to 0.001 SOL and all dust rolls into the next period of the same type.

## Architecture

| Component | Role |
| --- | --- |
| `crates/zkube-core` | Deterministic Rust engine: grid, blocks, mutators, scoring, metrics, period and payout math, canonical encoding, replay schedule |
| `crates/zkube-core-wasm` | WASM build of the same engine for the client |
| `programs/solana` | Anchor program: Campaign stars, competitive records, accounting, boards, settlement |
| MagicBlock ER | Active gameplay and per-row VRF, on a Router-resolved validator |
| `services` | Keeper worker: period preparation, recovery, rollup, settlement, archival, cleanup |
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
