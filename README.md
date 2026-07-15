# zKube Solana + MagicBlock

zKube is a fully on-chain puzzle game with a ten-map campaign and a Daily
Arena. Durable identity, progression, contests, USDC accounting, receipts, and
governance live on Solana; latency-sensitive active runs execute on a
MagicBlock Ephemeral Rollup (ER) and settle back to the base layer.

The client uses the connected Solana address as the durable player identity.
Wallet Standard supports desktop wallets, Mobile Wallet Adapter 2.0 supports
Seeker, and one sponsored “Enable zKube” approval creates a scoped device
session for about seven days of silent gameplay and settlement. Star purchases
remain owner-approved because they move USDC. Player-facing gameplay is not an
operator-approved or manual settlement workflow.

The app is connection-gated: visitors remain on wallet onboarding until both
the external wallet connection and the scoped device session are ready. The
connect action prompts “Enable zKube” immediately when no reusable session is
available; disconnected browsing is not supported.

## Read first

- [STATUS.md](STATUS.md) — live Devnet identity, current evidence, incidents,
  and remaining work.
- [Architecture](docs/architecture.md) — product rules, authority boundaries,
  accounts, Router/ER/VRF flow, and settlement invariants.
- [Operations](docs/operations.md) — deployment identity, approval gates,
  custody, monitoring, evidence hashes, and incident response.
- [Development](docs/development.md) — repository layout, toolchain, local
  workflow, validation, IDL, and release previews.
- [AGENTS.md](AGENTS.md) — mandatory rules for agents and operators; it does
  not describe product behavior.

## Repository layout

```text
Anchor.toml, Cargo.toml       Anchor workspace at repository root
programs/solana/              zKube Anchor program
target/deploy/solana.so       local SBF build output (ignored)
client/                       Vite app, chain clients, tools, Fly services
fixtures/                     shared Rust/TypeScript gameplay fixtures
docs/                         active architecture, operations, development docs
```

`client/` is the web deployment root. The former archived client and temporary
port plan have been removed after explicit sign-off; no runtime or validation
path depends on them.

The same Vite client is packaged for Seeker as a PWA/Trusted Web Activity.
TWA metadata and the release-certificate Digital Asset Links template live in
`client/twa/`; Android signing keys remain outside the repository.

## System boundaries

- Solana base owns identity, progression, Stars, catalogs, Daily contests,
  canonical-USDC custody, receipts, claims, governance, sponsorship allowances,
  and treasury accounting.
- MagicBlock owns only delegated `ActiveRun` state, authoritative moves, and
  fresh per-row VRF while a run is active.
- The browser renders decoded authoritative state and orchestrates
  transactions; it does not compute rows, scores, rewards, or ranks.
- External wallets sign only session enablement and Star purchases. Scoped
  device sessions sign safe player actions and never authorize USDC spending.
- The paymaster is a stateless, shape-limited fee payer. Sponsorship entitlement
  and cadence quotas are program-owned.
- Vercel serves only the static PWA. Separate Fly apps isolate the always-warm
  paymaster HTTP signer from the non-public Daily/Weekly keeper worker.
- Protocol v1 accepts six-decimal canonical SPL Token USDC and rejects
  Token-2022 payment assets. External yield deployment remains disabled.

## Validation

Run the complete offline/static gates from the repository root:

```bash
NO_DNA=1 ./validate.sh program
NO_DNA=1 ./validate.sh frontend
```

Or run the client directly:

```bash
cd client
NO_DNA=1 pnpm install --frozen-lockfile
NO_DNA=1 pnpm dev --host 127.0.0.1
```

All Solana, Anchor, and pnpm chain commands must use `NO_DNA=1`. Validation and
dry-run previews are not authorization to sign or send a transaction.

## Deployment status

MagicBlock Devnet is the rollout and acceptance target; mainnet is rejected by
the current tooling. The live program is
`5NfTo5ML4UTa6ep4x9d616fyWQYM3CTcpcE5V9P7YUbA`. See [STATUS.md](STATUS.md) for
the exact deployed slot/hash and the important distinction between the live
binary and newer source hardening.
