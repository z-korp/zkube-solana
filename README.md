# zKube on Solana

zKube is a connection-gated Solana game. The connected Solana address is the
player identity; there are no embedded wallets, recovery codes, deposits, or
zKube-held user funds. The web client is a Vite PWA intended for desktop Wallet
Standard wallets and a Seeker Trusted Web Activity using Mobile Wallet Adapter.

## Runtime architecture

| Boundary | Responsibility | Who pays / signs |
| --- | --- | --- |
| External wallet | Durable player owner, first enable, renewals, Star purchases | Owner signs and pays |
| Device session | Seven-day scoped signer stored only in that browser | Receives a 0.001 SOL fee allowance from the owner |
| Player funding PDA | Shared 0.025 SOL target float for that owner's bounded account rent | Owner funds; only exact zKube wrappers can spend it |
| Solana program | Identity, Campaign/Daily/Weekly state, Stars, native-SOL accounting, receipts | Device session for safe play; owner for SOL purchases |
| MagicBlock ER | Delegated active gameplay and VRF | Gasless gameplay; Router selects the validator |
| Fly keeper | Daily/Weekly cadence, permissionless settlement recovery, cleanup | Its own SOL-funded keypair |
| Static PWA/TWA | UI, wallet discovery, session storage, transaction assembly | No server signer and no paymaster |

```text
wallet ── Connect & Enable (one owner approval) ──> 7-day device session
   │                                                   │
   ├── exact SOL approval ──> Star purchase             ├── silent base actions
   └── funds 0.025 SOL player PDA + 0.001 SOL device ──└── gasless ER moves

Solana base <── delegate / copy back ──> Router-selected MagicBlock ER
     ▲
     └── Fly keeper: Daily + Weekly cadence and permissionless cleanup
```

There is deliberately no Kora or custom paymaster. The user's owner-funded PDA
is not a generic wallet: its signer seeds are exposed only inside narrow
self-CPI instructions for known zKube account-creation paths. A session cannot
transfer arbitrary SOL and can never authorize a Star purchase.

## Connection and run lifecycle

The app renders only the connection screen until both wallet connection and
session enablement are ready. Selecting a wallet immediately continues into a
single versioned `Enable zKube` transaction. That transaction initializes a new
player when necessary, replenishes the shared funding float, creates the scoped
session token, and gives the device signer its bounded fee allowance.

Normal Campaign and Daily play is silent after enablement. A run is prepared on
Solana, delegated through the MagicBlock Router, played on the resolved ER, then
sealed, committed, copied back, consumed, and cleaned automatically. Base,
Router, and ER connections are always separate.

`PlayerProfile.active_run_id` enforces one open run per owner. It prevents two
enabled devices from launching overlapping runs and lets a fresh device
reconstruct the exact run PDA from chain state. Browser storage is only a cache;
the durable pointer is cleared only after the receipt is consumed on Solana.

## Native-SOL economy

Star purchases are owner-signed native-SOL transfers. The UI shows the exact
price and 10% team / 10% reward / 80% treasury split before opening the wallet.

| Stars | Price |
| ---: | ---: |
| 10 | 0.01 SOL |
| 50 | 0.0475 SOL |
| 100 | 0.09 SOL |
| 500 | 0.425 SOL |
| 1,000 | 0.8 SOL |

Weekly native-SOL reward pools are bounded from 0.1 to 1 SOL. Program PDAs pin
the canonical reward vault and every configured destination; integer lamport
accounting preserves the exact split. The keeper cannot purchase Stars or move
player funding.

Daily entry burns 10 Stars per attempt; it does not directly transfer SOL or
open the owner wallet. Campaign clears award 10 XP for each improvement to a
level's lifetime best rating: 1/2/3 stars are worth 10/20/30 XP total for that
map-level, and equal or worse replays award nothing. The separate one-time
perfect-map reward remains 20 Stars and 1,000 XP.

## Repository map

| Path | Contents |
| --- | --- |
| `programs/solana` | Anchor program, authorization, native economy, funding wrappers, run lifecycle |
| `client/src/chain` | Wallet/session adapters, transaction plans, Router/ER resolution, domain clients |
| `client/src/platform` | Wallet Standard, MWA registration, browser storage boundaries |
| `client/src/ui` | Existing React UI plus the connection gate |
| `client/public` | PWA manifest, service worker, icons, Digital Asset Links |
| `client/twa` | Trusted Web Activity packaging metadata |
| `services` | Fly keeper only; no player transaction service |

The public service worker caches only immutable application assets. RPC,
Router, ER, keeper, and chain-account responses are never cached.

## Local development and validation

Requirements: Rust/Anchor toolchain, Node 20.19+, and pnpm. Never place wallet,
deployer, keeper, or Android signing secrets in the repository.

```bash
NO_DNA=1 anchor build

cd client
NO_DNA=1 pnpm install
NO_DNA=1 pnpm dev
```

The complete offline gate is:

```bash
NO_DNA=1 ./validate.sh program
cd client
NO_DNA=1 pnpm idl:check
NO_DNA=1 pnpm exec tsc -b --pretty false
NO_DNA=1 pnpm lint
NO_DNA=1 pnpm exec vitest run
NO_DNA=1 pnpm build
```

No mock wallet is an acceptance substitute. Desktop acceptance uses Phantom
and another Wallet Standard wallet. Seeker acceptance uses Seed Vault Wallet
and covers connect/enable, Campaign, Daily, refresh/resume, settlement/cleanup,
claims, exact owner-approved purchase, rejection, account switching, expiry,
and renewal.

## Devnet release status and sequence

The source tree contains a breaking program ABI and native-SOL configuration.
It is **not compatible with the previously deployed Devnet program** until the
new SBF, bootstrap state, keeper, and client are released together. Existing
embedded-wallet-era Devnet progress is intentionally not migrated.

Going live requires these separately approved operations, in order:

1. Freeze writes and archive the current read-only deployment evidence.
2. Build and verify the exact SBF/IDL artifact from the release commit.
3. Separately approve and deploy/upgrade the Devnet program.
4. Separately approve each bootstrap stage for protocol, native-SOL economy,
   maps, achievements, quests, and governance configuration.
5. Fund the Fly keeper with SOL, install its secret outside the repository,
   deploy `services/fly.keeper.toml`, and verify a read-only pass before writes.
6. Publish the matching static PWA, then complete desktop and real Seeker
   acceptance against that exact program artifact.
7. Produce the signed TWA APK only after browser acceptance passes.

Every live deploy, bootstrap stage, keeper write enablement, SOL movement, or
Daily publication needs its own exact operator approval. Mainnet is disabled.

## Security invariants

- Never request, export, log, or persist external-wallet secrets.
- Validate account owner, discriminator, data length, PDA relationship, and
  cluster genesis before decoding untrusted RPC data.
- A session token must match owner, actor, target program, fee payer, and expiry.
- Star purchases require the owner signer and exact quoted lamports.
- Preserve unsettled run accounts until durable receipt evidence exists.
- Resolve ER endpoints through `getDelegationStatus`; never hardcode a region.
- Keep Android signing keys, deploy authorities, and keeper secrets outside git.

Agent and operator rules live in `AGENTS.md`; `CLAUDE.md` is a symlink to it.
