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
| Player funding PDA | System-owned, zero-data 0.025 SOL target float for that owner's bounded account rent | Owner funds; only exact zKube wrappers can make it sign |
| Solana program | Identity, Campaign/Daily/Weekly state, Stars, native-SOL accounting, run settlement | Device session for safe play; owner for SOL purchases |
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
is a zero-data System account, not a program-owned vault or generic wallet: its
signer seeds are used only inside narrow self-CPI instructions for known zKube
account-creation paths. A session cannot transfer arbitrary SOL and can never
authorize a Star purchase. Enable also converts the exact retired 42-byte
program-owned funding account in place, preserving its address and lamports;
any other owner or layout fails closed.

## Connection and run lifecycle

The app renders only the connection screen until both wallet connection and
session enablement are ready. Selecting a wallet immediately continues into a
single versioned `Enable zKube` transaction. That transaction initializes a new
player when necessary, replenishes the shared funding float, creates the scoped
session token, and gives the device signer its bounded fee allowance.

Normal Campaign and Daily play is silent after enablement. A fresh run is
prepared and delegated atomically in one Solana v0 transaction, played on the resolved ER, then
sealed, committed, copied back, consumed, and cleaned automatically. Base,
Router, and ER connections are always separate.

The opening board uses one verified VRF callback and expands that unpredictable
result with a domain-separated SHA-256 syscall stream into exactly the configured
3–8 stable rows plus one preview. Eight draws are consumed from each digest; the
callback has no retry or settle loop, and every generated row is nonempty,
nonfull, coherent, and supported. Each
move that exposes a future hidden row atomically requests a fresh VRF value in
the same ER transaction, so client timing cannot select the next row. The
client prewarms an endpoint-scoped ER blockhash, skips ER preflight, and keeps a
single ActiveRun account subscription alive; notification data is validated and
decoded directly, with short polling used only while recovering a missed write.

`PlayerState.active_run_id` enforces one open run per owner. It prevents two
enabled devices from launching overlapping runs and lets a fresh device
reconstruct the exact run PDA from chain state. Browser storage is only a cache;
the durable pointer is cleared only when copied-back terminal `ActiveRun` state
is consumed into progression and closed atomically on Solana.

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

The live Devnet `ProtocolConfig` pins these native-SOL destinations:

| Destination | Public address |
| --- | --- |
| Team | `FVN2XcPhXJGyUmDZWts5EBmsiK7aHzQoMFCkT57oZZhP` |
| Treasury | `9rVYVyB3xUEhVMixoz44ssdJJc8C7CGPkyrRLrh7R5jR` |
| Reward | Program-derived `reward_vault` PDA |

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

The canonical production client is
[`https://zkube-solana.vercel.app/`](https://zkube-solana.vercel.app/). It is
Git-deployed from `z-korp/zkube-solana:main` into the z-korp Vercel team
(`z-labs`), project `prj_5kqIxlxgXHXGhldje8unic9h3qYA`. Manual production
deploys are not part of the release flow. The Devnet keeper is temporarily
hosted in the `jcn-data` Fly organization until a z-korp Fly organization is
available; that temporary exception does not apply to the web client.

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

The v3 source tree uses the new program address
`Apyuy9VZvg7DLcQhe6KGv3sw2MNzriMjtCx2q7zac1QR`. It is not live until its
initial-deploy, bootstrap, keeper, and client transaction bundle is separately
simulated, fingerprinted, approved, and executed. The old v2 deployment remains
the currently reachable Devnet program during this maintenance window.

The previous Devnet release ran the native-SOL program at deployment slot `476696498`.
The deployed program artifact is 1,758,456 bytes with SHA-256
`52bdd43dc4f0f14c421302b0553dfaa79a1e7fa347df487a4bb77598cf0f02ea`;
the full padded ProgramData payload has SHA-256
`13a240476008e629534a090d7f43848691d529635d8328f51681ad7eedbe1430`.
Protocol, economy, Daily rules, all ten map catalogs, and Campaign activation
are initialized and verified. Existing embedded-wallet-era progress was
intentionally removed rather than migrated.

The Fly keeper is live with its separately approved bounded write policy. Its
first pass opened Devnet day `20650` and week `2950`; both accounts are verified
and playable. The keeper has a `0.1 SOL` reserve floor covering the full
variable-capacity leaderboard rent, at most eight writes per pass, and at most
two expired-session revocations per pass. The matching static PWA is live.

The v3 account pass compacts Campaign stars to 80 bytes, achievement claims to
one 24-bit-bounded word, removes stale run addresses from Daily ranking state,
and reduces the fully allocated 50-entry Daily leaderboard from 4,546 to 2,946
bytes. Per-player profile, Campaign, quest, milestone, and stipend state now
live in one 363-byte `PlayerState`; each run uses one 595-byte `ActiveRun`
instead of shell/active/receipt triplication. The funding target is stored in
`ProtocolConfig`; the client treats
larger or malformed values as invalid instead of trusting a browser constant.

The remaining release work is the approved v3 initial deployment and fresh
bootstrap, followed by real-wallet desktop and Seeker acceptance and the signed
TWA APK only after browser acceptance passes. Existing v2 Devnet progress is
intentionally not migrated.

Every live deploy, bootstrap stage, keeper write enablement, SOL movement, or
Daily publication needs exact operator approval. A single approval may cover a
fully enumerated release bundle whose signers, accounts, spends, and deployment
fingerprints are fixed in advance; any drift stops the bundle. Mainnet is disabled.

## Security invariants

- Never request, export, log, or persist external-wallet secrets.
- Validate account owner, discriminator, data length, PDA relationship, and
  cluster genesis before decoding untrusted RPC data.
- A session token must match owner, actor, target program, fee payer, and expiry.
- Star purchases require the owner signer and exact quoted lamports.
- Preserve `ActiveRun` until terminal copyback; consume progression, clear the
  active pointer, and close rent atomically.
- Resolve ER endpoints through `getDelegationStatus`; never hardcode a region.
- Keep Android signing keys, deploy authorities, and keeper secrets outside git.

Agent and operator rules live in `AGENTS.md`; `CLAUDE.md` is a symlink to it.
