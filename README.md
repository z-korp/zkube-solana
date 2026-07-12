# zKube Solana + MagicBlock

zKube is a fully on-chain puzzle game with a ten-map campaign and a Daily
Arena. Durable identity, progression, contests, USDC accounting, receipts, and
governance live on Solana; latency-sensitive active runs execute on a
MagicBlock Ephemeral Rollup (ER) and settle back to the base layer.

The shipped client silently creates an embedded identity, signs
programmatically, uses a stateless paymaster for base fees and rent, uses a
scoped session key for ER gameplay, and settles automatically. Player-facing
gameplay is not an operator-approved or manual transaction workflow.

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
client/                       Vite app, chain clients, tools, paymaster API
fixtures/                     shared Rust/TypeScript gameplay fixtures
docs/                         active architecture, operations, development docs
```

`client/` is the web deployment root. The former archived client and temporary
port plan have been removed after explicit sign-off; no runtime or validation
path depends on them.

## System boundaries

- Solana base owns identity, progression, Stars, catalogs, Daily contests,
  canonical-USDC custody, receipts, claims, governance, sponsorship allowances,
  and treasury accounting.
- MagicBlock owns only delegated `ActiveRun` state, authoritative moves, and
  fresh per-row VRF while a run is active.
- The browser renders decoded authoritative state and orchestrates
  transactions; it does not compute rows, scores, rewards, or ranks.
- The paymaster is a stateless, shape-limited fee payer. Sponsorship entitlement
  and cadence quotas are program-owned.
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
