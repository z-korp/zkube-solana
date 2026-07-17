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
authorize a Star purchase. Initialization accepts only the canonical empty,
System-owned funding PDA; retired program-owned funding layouts fail closed.

## Connection and run lifecycle

The app renders only the connection screen until both wallet connection and
session enablement are ready. Selecting a wallet immediately continues into a
single versioned `Enable zKube` transaction. That transaction initializes a new
player when necessary, replenishes the shared funding float, creates the scoped
session token, and gives the device signer its bounded fee allowance.

Normal Campaign and Daily play is silent after enablement. A fresh run is
prepared and delegated atomically in one Solana v0 transaction, played on the resolved ER, then
timestamped by the action that first reaches a terminal state, committed
immediately, copied back, consumed, and cleaned automatically. There is no
separate sealing instruction. Base, Router, and ER connections are always
separate.

The opening board uses one verified VRF callback and expands that unpredictable
result with a domain-separated SHA-256 syscall stream into exactly the configured
3–8 stable rows plus one preview. Eight draws are consumed from each digest.
Opening rows use the same weighted packer as every later row, are inserted and
settled until the requested height is reached, and have a bounded deterministic
fallback for pathological future catalogs. Weighted oversized blocks are
conditioned out instead of becoming accidental holes, then whole block and gap
entities are shuffled to remove packing-direction bias. Every delivered row is
nonempty, nonfull, and coherent. Campaign runs keep the authored level weights,
while Daily runs select the tier reached by the preceding action's pressure
score. Each move that exposes a future hidden row atomically requests a fresh VRF value in
the same ER transaction, so client timing cannot select the next row. The
client prewarms an endpoint-scoped ER blockhash, skips ER preflight, and keeps a
single ActiveRun account subscription alive; notification data is validated and
decoded directly, with short polling used only while recovering a missed write.

Line score follows the original Cairo per-action triangular curve: the first
line is worth 1 base point, the second adds 2, the third adds 3, and the fourth
adds 4. The same counter spans the settle before next-row insertion and the
settle after insertion, so a four-line action is always worth 10 base points
before the snapshotted score, combo, line, or perfect-clear modifiers. Separate
settle phases retain Cairo's integer-floor multiplier behavior.

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

Daily rank is determined only by total Daily score descending, qualifying
Daily bonus-condition triggers descending, then terminal action timestamp
ascending. Engine score, challenge bonus points, and moves remain visible
statistics but are not tie-breakers. Classic rules never add bonus triggers;
other rules add exactly one trigger for each action that earns nonzero
challenge bonus credit.

Content publication is staged and immutable. Governance may publish future
Campaign map catalogs and a future Daily rules catalog while the current
release remains playable. While the protocol is paused,
`activate_content_release` validates the strict version increase, exact ordered
enabled map PDAs, Campaign map count, and selected Daily rules catalog, then
switches the protocol and economy versions atomically. Existing player
progression is preserved, and runs or challenges that already snapshotted older
rules remain settleable.

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

The v3 program is live on Devnet at
`Apyuy9VZvg7DLcQhe6KGv3sw2MNzriMjtCx2q7zac1QR`, with ProgramData account
`7XHh2WTjAw19Nt3eSjTHGBbrw8QgPQbAT3upa3NDATZu` and initial deployment slot
`476753345`. Its fresh bootstrap and first Daily/Weekly cadence are complete.
The v3 keeper image is live but returned to read-only mode after that exact
one-pass bundle. The client release still needs to be separately fingerprinted,
approved, and executed, so v3 is not yet the client-active release. The old v2
deployment remains the currently reachable browser program during this
maintenance window.

The v3 custody preflight is satisfied and the protocol foundation was
initialized at slot `476755019`. `ProtocolConfig` and `RewardVault` are owned
by the v3 program, use account version 1, preserve the 0.025 SOL player-funding
target, and point at the verified external team and treasury destinations. The
canonical Stars economy was initialized at slot `476756061`; it preserves the
10-Star Daily entry, owner-approved native-SOL pack prices, disabled sale
window, and zeroed lifetime sales ledger. Immutable Daily rules catalog v1 was
published at slot `476757680` with catalog hash
`7c9d64c4ab5c95c51f9a1e8b52767f84de9245de6604074c0f7f6930a906334f`.
All ten immutable Campaign map catalogs were published and verified at slots
`476758274` through `476758292` and activated at slot `476758914`. All six
bootstrap stages now satisfy their read-only postconditions. The approved
one-pass keeper stage opened week `2950` at slot `476764468` and day `20650` at
slot `476764471`; ongoing keeper writes and the client stage remain separately
approval-gated.

The previous Devnet release ran the native-SOL program at deployment slot `476696498`.
The deployed program artifact is 1,758,456 bytes with SHA-256
`52bdd43dc4f0f14c421302b0553dfaa79a1e7fa347df487a4bb77598cf0f02ea`;
the full padded ProgramData payload has SHA-256
`13a240476008e629534a090d7f43848691d529635d8328f51681ad7eedbe1430`.
Protocol, economy, Daily rules, all ten map catalogs, and Campaign activation
are initialized and verified. Existing embedded-wallet-era progress was
intentionally removed rather than migrated.

The replacement v3 Fly keeper is live at registry digest
`sha256:459bc65e6ee620b55e19f8cf9242c1cd3b67c361ab66938f3ffdad05db461537`.
Its exact one-pass bundle spent 35,770,480 lamports to open and verify Devnet
day `20650` and week `2950`, then removed the release fingerprint and confirmed
a fresh zero-write pass. Its remaining balance is 918,019,040 lamports, above
the `0.1 SOL` reserve floor. The keeper still caps each pass at eight writes and
expired-session revocation at two accounts, but ongoing writes are currently
disabled. The production static PWA still targets v2.

The v3 account pass compacts Campaign stars to 80 bytes, achievement claims to
one 24-bit-bounded word, removes stale run addresses from Daily ranking state,
and uses a 3,046-byte fully allocated 50-entry Daily leaderboard with the
official trigger-count and completion-time tie-breakers. Per-player profile,
Campaign, quest, milestone, and stipend state live in one 355-byte
`PlayerState`; each run uses one 449-byte `ActiveRun` instead of
shell/active/receipt triplication. Removing obsolete run provenance saves about
0.001 SOL of recyclable rent per concurrent run. The funding target is stored
in `ProtocolConfig`; the client treats
larger or malformed values as invalid instead of trusting a browser constant.

The pre-deployment SBF profile experiment selected release `opt-level = "s"`;
`opt-level = "z"` was deliberately excluded. The speed profile produced a
1,429,168-byte ELF and 9,948,213,360-lamport ProgramData rent estimate, while
the selected size profile produces a 1,200,672-byte ELF with SHA-256
`4236db1f07271bfc0fdd489bfd27c887dde91309427cb40cc78350078781d7bf`
and an 8,357,881,200-lamport estimate. Both estimates use the current Devnet
rent schedule and the ELF length plus the 45-byte upgradeable-loader metadata.
The selected profile passed the real SBF account/instruction suite without a
stack warning. The exact ELF hash was verified again from the deployed
ProgramData bytes. Initial deployment spent 8,372,157,640 lamports, below its
8,409,022,640-lamport approved maximum. Solana CLI 4.0.2 used 1,311 loader write
transactions (1,313 successful loader transactions total); the preflight
model's 1,371-write estimate was conservative and has been retained in the
ignored deployment evidence for auditability. Its measured compute units were:
revenue update 10,961, level
claim 17,782, quest claim 18,486, Campaign consume 23,365, Star purchase
30,699, terminal move 44,535, funded prepare 58,675, and full ten-map content
activation 212,244. These are pre-deployment fingerprints, not authorization
to deploy or write chain state.

The weighted-generator repair is deployed on v3 Devnet. Its
`opt-level = "s"` ELF is 1,202,512 bytes with SHA-256
`fb0e7aad8cf8f09c35b61c9c7c1e91d59137d2005c290eb015789d5e955b365f`.
The matching speed-profile ELF is 1,434,224 bytes with a 9,983,403,120-lamport
rent estimate and cannot fit the existing ProgramData account; neither profile
emits an SBF stack warning. The selected artifact's own rent estimate is
8,370,687,600 lamports, but it exceeds the live 1,200,672-byte code capacity by
1,840 bytes. Devnet's loader therefore requires the minimum 10,240-byte
extension to 1,210,912 bytes: 71,270,400 additional rent lamports and an
8,429,151,600-lamport final ProgramData balance. Extension signature
`2h6LRD4BD5gt5qB7LuTvkYNZcVJZn9NxqYQ23DgnWVR7gX3YyxPAMp6pUC9E6otqfvRPVvnUEuKPsofwSSDQ4C2X`
and upgrade signature
`5nEBXwRW1cdY8HQhMcN6YD94xCJPQDKnD8ZUPJqCtVeRUszbg8okcxpAtW6jTug2nvn8JpMK56S1SLvn2CoBCZAa`
are confirmed; the deployed ELF prefix matches the candidate hash and all
8,400 capacity-tail bytes are zero. Real SBF execution measures
the complete eight-row opening callback at 111,002 compute units, the bounded
sparse-catalog fallback at 126,673, and an ordinary weighted-row callback at
27,834; the stale-counter rejection also passes.

The follow-up Cairo scoring-parity candidate is not yet deployed. Its selected
`opt-level = "s"` ELF is 1,202,616 bytes with SHA-256
`a6d7122e9bd6cf5c3fae6d892716df0e5a3a4406cc14c6c3e368dec488e326f2`.
Its current Devnet ProgramData rent estimate is 8,371,411,440 lamports. The
matching speed-profile ELF is 1,435,072 bytes with SHA-256
`43c17062d293076a5d0909052877c5de630755c55b5c56fcf164ac2320cbbb5d`
and a 9,989,305,200-lamport rent estimate; it cannot fit the live ProgramData
capacity. Neither profile emits an SBF stack warning, and a clean selected
rebuild reproduced the candidate byte-for-byte.
It fits the existing 1,210,912-byte ProgramData capacity without extension;
the exact post-upgrade padded SBF SHA-256 is
`2f345f3b1cfef82fdb32c7e8e913783cd33af555c9f8afcddc3fc1baf0d90e0d`.
The real SBF four-line terminal move uses 48,882 compute units and confirms
the 10-point Cairo curve plus atomic terminal timestamp/accounting behavior.
The bounded Devnet upgrade plan requires the loader buffer
`81aC6XkuuUrdzWMfRNhZKVZhPapqi4MzWTmveaKh9koN` to remain absent, binds its
exact 8,371,355,760-lamport temporary rent, allows one signing attempt, and
caps net deployer spend at 50,000,000 lamports. Its approval evidence SHA-256
is `316bfbcc8ae622235c0b69cd385c78d8c3770f148c04409c0cb876525d32a31f`
(`316bfbcc8ae62223`). This dry-run fingerprint is evidence only; no transaction
was signed or sent.

The remaining release work is the Git-driven v3 client cutover, the separately
approved bounded keeper release, real-wallet desktop and Seeker acceptance, and
the signed TWA APK only after browser acceptance passes. The keeper's initial
write enablement is approval-gated; after that, only its fingerprint-bound
allowlist may recur within the fixed per-pass bounds. Existing v2 Devnet
progress is intentionally not migrated.

The v3 keeper also requires the exact compiled release fingerprint alongside
the case-sensitive write opt-in. This keeps a newly deployed image read-only
even if Fly still holds an older `KEEPER_WRITE_ENABLED=true` secret. The
fingerprint is enabled only after the replacement image reports a clean
read-only planning pass, and it is currently absent after the completed
one-pass cadence release. The next keeper candidate adds a last-line signing
policy: every transaction must use the base connection, keeper payer, canonical
instruction discriminator and fixed PDAs, current Daily/Weekly cadence address,
and no additional signer. It also verifies the full padded ProgramData SHA-256
before each pass, simulates the keeper balance delta, caps spend at 50,000,000
lamports per pass, retains the eight-write/two-session limits, and stops below
the 0.1 SOL reserve floor. None of those candidate controls enable writes until
their exact release bundle is approved and applied.

Every live deploy, bootstrap stage, keeper write enablement, SOL movement, or
Daily publication needs exact operator approval. A single approval may cover a
fully enumerated release bundle whose signers, accounts, spends, and deployment
fingerprints are fixed in advance; any drift stops the bundle. When ProgramData
must grow, the extension dry-run prints the padded post-extension SBF preimage;
use that preimage to plan the upgrade before presenting both operations as one
bundle, avoiding a second approval solely because capacity padding changed the
full ProgramData hash. Mainnet is disabled.

## Security invariants

- Never request, export, log, or persist external-wallet secrets.
- Validate account owner, discriminator, data length, PDA relationship, and
  cluster genesis before decoding untrusted RPC data.
- A session token must match owner, actor, target program, fee payer, and expiry.
- Star purchases require the owner signer and exact quoted lamports.
- Revenue destinations must be nonzero and pairwise distinct.
- Preserve `ActiveRun` until terminal copyback; consume progression, clear the
  active pointer, and close rent atomically.
- Resolve ER endpoints through `getDelegationStatus`; never hardcode a region.
- Keep Android signing keys, deploy authorities, and keeper secrets outside git.

Agent and operator rules live in `AGENTS.md`; `CLAUDE.md` is a symlink to it.
