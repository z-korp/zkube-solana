# zKube on Solana

zKube is a connection-gated Solana game. The connected Solana address is the
player identity; there are no embedded wallets, recovery codes, deposits, or
zKube-held user funds. The web client is a Vite PWA intended for desktop Wallet
Standard wallets and a Seeker Trusted Web Activity using Mobile Wallet Adapter.

## Runtime architecture

| Boundary | Responsibility | Who pays / signs |
| --- | --- | --- |
| External wallet | Durable player owner, first enable, renewals, Star purchases | Owner signs and pays |
| Device session | Seven-day scoped signer stored only in that browser | Holds a recyclable 0.005 SOL fee allowance from the owner |
| Player funding PDA | System-owned, zero-data 0.025 SOL target float for that owner's bounded account rent | Owner funds; only exact zKube wrappers can make it sign |
| Solana program | Identity, Campaign/Daily/Weekly state, Stars, native-SOL accounting, run settlement | Device session for safe play; owner for SOL purchases |
| MagicBlock ER | Delegated active gameplay and VRF | Gasless gameplay; Router selects the validator |
| Fly keeper | Daily/Weekly cadence, permissionless settlement recovery, cleanup | Its own SOL-funded keypair |
| Static PWA/TWA | UI, wallet discovery, session storage, transaction assembly | No server signer and no paymaster |

```text
wallet ── Connect & Enable (one owner approval) ──> 7-day device session
   │                                                   │
   ├── exact SOL approval ──> Star purchase             ├── silent base actions
   └── funds 0.025 SOL player PDA + 0.005 SOL device ──└── gasless ER moves

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

### Deferred Kora-sponsored Devnet gameplay

This is a deferred design record, not current product behavior, implementation
authority, deployment approval, or transaction approval. Product truth and
verified chain state remain authoritative.

The possible later release would use direct static-client-to-Kora sponsorship
for session-authorized Solana base actions. Kora would pay transaction fees
while the device signer silently authorizes gameplay; the owner would still
provide the reusable 0.025 SOL funding-PDA reserve. It would remove the device
fee allowance, refill checks, and balance-driven renewal while retaining owner
approval for initial enablement, seven-day renewal, Star purchases, and a
Kora-outage fallback. No program upgrade, IDL change, or account migration is
expected.

Infrastructure requirements:

- Pin the newest audited Kora release containing reCAPTCHA and rolling Redis
  limits; if unavailable, use `v2.2.0-beta.7` on Devnet only and never track
  `main`.
- Host Kora and Redis under z-korp, preferably its Fly organization and
  otherwise z-korp Railway. The JCN infrastructure exception does not apply.
- Configure free pricing, forced signature verification, fail-closed Redis,
  TLS, and CORS restricted to the canonical Vercel origin and approved local
  development origins.
- Enable only liveness, configuration, payer/version discovery, and transaction
  signing. Disable sending, transfers, payments, bundles, plugins, Lighthouse,
  and every Kora fee-payer System/SPL authority policy.
- Allow only the exact zKube Devnet program as an outer program, at most two
  signatures, and no durable nonce transactions.
- Protect signing with reCAPTCHA v3 and rolling limits of 20 requests/minute
  and 250/day per supplied device identifier, plus a conservative global
  limit. Treat client-provided identifiers as throttling rather than identity.
- Bound abuse through the program allowlist, reCAPTCHA, alerts, and a dedicated
  Kora signer initially funded with at most 0.02 Devnet SOL. Any refill remains
  a separately approved transfer.
- Keep signer material, Redis credentials, and reCAPTCHA secrets in platform
  secrets. Monitor payer balance, spend, rejection rate, Redis health, and
  sponsorship latency.

Client transaction requirements:

- Replace the fixed transaction fee-payer assumption with explicit-payer and
  Kora-preferred policies. Owner, keeper, administration, and ER transactions
  remain explicit-payer operations.
- Sponsor safe session-authorized base actions such as run preparation and
  delegation, terminal consumption/closure, Daily entry, progression claims,
  and cosmetic-label writes.
- Exclude session creation/renewal, Star purchases, governance, keeper activity,
  and ER gameplay from sponsorship.
- Build a v0 message using the pinned Kora payer, locally add required ephemeral
  and device signatures, simulate against the base RPC, and request Kora's
  signature.
- Before submission, require the returned payer to match the pinned deployment,
  exact message bytes and signer order to remain unchanged, the device signature
  to remain present, and Kora's Ed25519 signature to verify.
- Submit through the existing Solana base connection; do not use
  `signAndSendTransaction`.
- On Kora, Redis, or reCAPTCHA failure, rebuild the same instructions with the
  connected owner as fee payer, retain device authorization, and request one
  wallet approval. Rejection leaves the action unsubmitted.
- Ship only public settings for enablement, endpoint, pinned payer, and site key.
  Emit sponsor attempt/result/fallback telemetry without transaction contents,
  tokens, or signer material.

Device-session requirements:

- Create sessions with zero device allowance. Readiness depends only on the
  stored keypair and validated Session Token relationships and expiry.
- Remove device balance polling, fee reserves, refill/rotation transfers,
  allowance errors, and low-balance UI while preserving seven-day owner renewal
  and owner-funded Session Token rent.
- For legacy funded device signers, perform a retry-safe, one-time exact drain to
  the validated owner, with the device paying the fee. Never redirect or discard
  the balance.
- Leave the 0.025 SOL funding PDA, narrow funded self-CPI wrappers, rent
  recycling, and cross-device `active_run_id` behavior unchanged.

Verification and rollout requirements:

- Test Kora payer compilation, partial signing, exact-message verification,
  tampering, wrong payers, invalid signatures, reCAPTCHA and Redis denial, owner
  fallback, and exclusion of owner-only/keeper/ER paths.
- Exercise enablement, Campaign/Daily launch, settlement, claims, label writes,
  outage fallback, and legacy allowance recovery against a local validator with
  pinned Kora and Redis.
- Prove Kora loses only network fees, the funding PDA retains its governed target
  except for recyclable rent use, and Star purchases preserve owner approval and
  10/10/80 conservation.
- Roll out Kora/Redis health first, then a staging feature flag, desktop and
  Seeker acceptance, and finally the Git-driven Vercel production release.
- Funding the Kora signer requires exact Devnet chain-write approval naming the
  signer, recipient, and maximum 0.02 SOL. Mainnet remains blocked pending an
  audited stable Kora release and cryptographically bound usage identity.

References: the [official Kora repository](https://github.com/solana-foundation/kora),
[Kit client guide](https://solana.com/docs/tools/kora/guides/kit-client), and
[full transaction flow](https://solana.com/docs/tools/kora/guides/full-demo).

## Connection and run lifecycle

The app renders only the connection screen until both wallet connection and
session enablement are ready. Selecting a wallet immediately continues into a
single versioned `Enable zKube` transaction. That transaction initializes a new
player when necessary, replenishes the shared funding float, creates the scoped
session token, and gives the device signer its bounded fee allowance.
When a live signer runs low, the owner refills that same signer to the target
instead of creating a new session. Rotation drains the locally controlled old
signer back to the owner before funding its replacement; an expired token is
revoked in the same transaction when eligible. A different browser has a
different signer and therefore parks its own allowance. Changed wallet
messages or discarded partial signatures remain rejected after signing.

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
Pack sizes and prices are governed together; every accepted ladder must have
strictly increasing quantities and prices, and each larger pack must cost no
more per Star than the preceding pack. The live Devnet packs are:

| Stars | Price |
| ---: | ---: |
| 10 | 0.02 SOL |
| 50 | 0.09 SOL |
| 200 | 0.3 SOL |
| 500 | 0.7 SOL |
| 1,000 | 1.25 SOL |

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
perfect-map reward is 20 Stars and 300 XP. Standard four-tier achievements pay
100/400/1,500/4,000 XP; Explorer pays 200/800/2,400/6,800 XP. This preserves
the existing 40,200-XP achievement pool and every player's accumulated XP
while moving more of the reward toward long-tail accomplishments. Level
milestones at levels 10 through 100 pay their level in Stars, for a 550-Star
lifetime total. Players who claimed the previous flat rewards receive only the
aggregate difference, so the transition cannot double-credit them.

The wallet address remains the authoritative player identity. A player may set
one optional cosmetic label for profile and Daily/Weekly leaderboard display.
Labels are 3–16 ASCII letters, digits, or underscores and must start with a
letter. They are not unique, have no moderation state, cooldown, or Star fee,
and are created or updated by the already-authorized device session. One
59-byte label PDA is derived only from the wallet; the first creation uses the
owner's narrow funding wrapper. Leaderboards continue to store wallets and
scores only. Clients resolve labels in batches and always display the shortened
wallet beside a label, falling back to the wallet when metadata is missing or
invalid. There is deliberately no XP leaderboard in this release.

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

Campaign content v2 is authored as a version-bound release rather than a
version-agnostic bootstrap payload. It keeps the existing targets, move caps,
difficulty tiers, row weights, and opening heights while giving each guardian
one scoring identity, two matching constraint families, and one renewable
bonus loop. Mutator IDs 21–40 describe v2 without changing the client copy for
older snapshotted runs. Activation also requires an unchanged Daily rules v2
catalog because the governed switch advances both content versions together.
`NO_DNA=1 pnpm --dir client chain:devnet:content-plan` performs the read-only
Devnet preflight and prints the exact accounts, spends, packet sizes,
instruction hashes, and fingerprint needed for one release-bundle approval; it
does not load a signer or send transactions. It deliberately fails closed once
any immutable target account already exists.

Campaign/Daily content v2 was activated on Devnet on July 17, 2026 under
fingerprint `7f72e4a188d6513e`. Eleven immutable catalogs and one atomic
pause/activate/unpause transaction spent exactly 31,467,840 lamports across 12
confirmed transactions. The activation signature is
`2K7gxgWxuJWdzQ2ozemKw8tjhKHGVj7yKSeDs2azJupBhr7NMsH2CQochp8JGtfPoVTXpzJWVack6Uc6nn2iVF4E`;
its signature-verified simulation consumed 99,815 compute units. Independent
postflight decoding reports content version 2, ten enabled maps with ten levels
each, map 1 unlocked for a fresh address, economy revision 3, and an unpaused
protocol.

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
The Cairo scoring-parity upgrade is confirmed at slot `476858563`, the bounded
keeper is write-enabled, and the Git-driven production client at
`https://zkube-solana.vercel.app/` targets this v3 program.

The tenth-row boundary correction from `a0e233f` is live at slot `476926533`.
The governed pack rebalance, progression rebalance, milestone reconciliation,
and legacy public-username release are live from program slot
`476930727`; the governed pricing revision finalized at slot `476930939`. The
cosmetic-label/session-recycling source revision is not live until its separate
upgrade is approved and verified. No source revision or simulation is treated
as evidence of deployed state.

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
bootstrap stages now satisfy their read-only postconditions. The initial
one-pass keeper stage opened week `2950` at slot `476764468` and day `20650` at
slot `476764471`. The bounded recurring release opened day `20651` at slot
`476858841`; its exact account postconditions are verified below.

The previous Devnet release ran the native-SOL program at deployment slot `476696498`.
The deployed program artifact is 1,758,456 bytes with SHA-256
`52bdd43dc4f0f14c421302b0553dfaa79a1e7fa347df487a4bb77598cf0f02ea`;
the full padded ProgramData payload has SHA-256
`13a240476008e629534a090d7f43848691d529635d8328f51681ad7eedbe1430`.
Protocol, economy, Daily rules, all ten map catalogs, and Campaign activation
are initialized and verified. Existing embedded-wallet-era progress was
intentionally removed rather than migrated.

The replacement v3 Fly keeper is live at registry digest
`sha256:2a1eb56732598736543df47515ae9d5772f350bd4c4c73d8d77eece2d7175ebb`.
Its first bounded recurring pass spent 25,880,320 lamports, opened Devnet day
`20651` with signature
`2QR15gqDp2aYszgctVF3Nn6yWVXvbqEngKpMxhxZ6xzmM1sHPG6DD6Xbc9EVLax178QDFTETe23ENew3WfXE4tph`,
and finalized one eligible historical Daily with signature
`3cyieojkxJhqsM6UiKkt6HddeFzh9dZYpkj9X9AE6s6qSj2knhEBEWTsEBXCknxATMZMHUMih6rh2sqktUDKBrHU`.
It completed with two writes, zero failures, zero backlog, and a remaining
balance of 892,138,720 lamports. Current day `20651` is open on map 3 with a
10-Star entry; its 415-byte challenge and 3,046-byte leaderboard are owned by
the v3 program.

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

The Cairo scoring-parity release is deployed. Its selected
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
(`316bfbcc8ae62223`). The approved upgrade signature is
`MMLv7iMmdko1E4DLfMDQWxBcZtTQvHVpNKEtTQiPWzzQ184Yeb43zCdUXtyqGAvbKzR2TXavAxUmgdAoiz8ubDU`;
the buffer closed, the padded postimage matched exactly, and net deployer spend
was 13,150,000 lamports.

The row-capacity correction is deployed on Devnet. Occupying the tenth grid row
is legal; only a move whose
settled board still cannot accept its visible preview (the attempted eleventh
row) finishes the run. That blocked action still consumes one move and keeps
its checked score, combo, objective, and terminal-time accounting. A bonus on
a ten-row board does not end the run, and satisfying the level on the same
action takes precedence over overflow. Bottom-row insertion now rejects at
capacity atomically instead of discarding row ten. The clean hotfix artifact
used for deployment is 1,202,992 bytes with SHA-256
`4146adbd787e40c5aa5634214fb25c59d18b679a37f2f8f024c69be3520e36f7`;
the deployed 1,210,912-byte ProgramData payload has SHA-256
`502820620c37390dbe46f6bcffc86322e69e4c9359f04c945746a21d98be5373`.
The legal tenth-row move, including its mocked VRF boundary, uses 54,190
compute units; the blocked eleventh-row move uses 37,548 and proves that no VRF
request is enqueued. Upgrade signature
`525ZtUR1HM2XfDJVDaWmxHb78bvnRLRccd3qGdTVFULaFAQhMUAEjC2sfVmhYgymJFdUvys8s24EZauWExoEhUrQ`
is finalized, the temporary buffer is closed, ProgramData capacity and
authority are unchanged, and net deployer spend was 13,160,000 lamports.

The progression, governed-pack, and public-username release is deployed. Its
selected `opt-level = "s"` ELF is 1,319,656 bytes with
SHA-256 `f24b7c44e336cdfb67ca7ec5903ee4eb3b63a907f2fa0a851031efbf302c8354`
and a 9,186,009,840-lamport ProgramData rent estimate. The speed profile is
1,568,864 bytes with SHA-256
`87afcc2e6433a9228633cd7a2b19be1de9a2aa773e163a706ceea3be77baf250`
and a 10,920,497,520-lamport estimate. Neither build emits an SBF stack
warning; the selected build passes all 13 real SBF tests, with content
activation at 213,018 compute units, a complete opening callback at 128,197,
funded prepare at 59,181, paid username rename at 36,910, registration at
28,045, milestone reconciliation at 18,155, pack governance at 13,483, and
moderation at 13,399.

The former 1,210,912-byte ProgramData account was extended by 108,744 bytes for
exactly 756,858,240 rent lamports. The extension produced padded postimage
`743a1ded711d5c8fa88d350aa0880bfaff2a51a1f827beb5a3e92a9d9e140cd1`
under fingerprint `c64dff1f5194aed7` and finalized with signature
`4XPmoz2PW9WW4ceuAE4R4rxHVzpdFhdXMSvgbCMTNhZXdGjJ6SdcM7zdAsSrhbC8MXJXemQu2MDurgR43ny2Y4Qw`.
The subsequent upgrade bound a 9,185,954,160-lamport temporary buffer and
fingerprint `14690131e79f879c`
(full evidence SHA-256
`14690131e79f879c8fbc5ab2af258995c795f221b7d65809862b5ef2f8e5c431`).
Upgrade signature
`4ebDAgGsj7ph5Kvk19pGCifrrW3WSgeMs7T4QtVQWxfMjTN16sixjwoDocT69H3ts167yp3XzpJsHYTF5h4YgnHp`
is finalized. ProgramData now has exact 1,319,656-byte capacity and
9,186,009,840 lamports, preserves authority
`2so568MdBWj9FMdC1pLQEJtgMo3LpYXFHKZ39GvEgEox`, and the temporary buffer is
closed.

The release used two separately approved 1 SOL Devnet faucet credits, then the
extension, upgrade, and governed pricing write under amended bundle
`c2346b0e29ee4189`. Pricing was pinned to the new SBF hash, exact legacy economy
revision 1, fee payer `7WFy4QkiUx9GZHkVz3wdWJbdMgMf6gtK8JnbWDYqZDRA`, pricing
operator `HmCGfPTW2ahuNySTddvbQpJxutDUhjMbR9j8ekFzHQ5b`, zero native-SOL
transfer, and fingerprint `7fee407b7db9bfbe`. Signature
`4Ny9prrbV5KjvoZwDAATsPoVZYVb2BofrFDCtsqJpmXDPbBYKDHCszFxBtKMfbZGfiHd1xLBxsnr1sBSnGPY5ayk`
finalized after a signature-verified 13,483-compute-unit simulation and spent
10,000 lamports. It advanced only the economy revision to 2 and set the five
packs to 10/50/200/500/1,000 Stars at 0.02/0.09/0.30/0.70/1.25 SOL. Daily entry
remains 10 Stars, zone unlock remains 20 Stars, and sales remain disabled.
Total non-faucet deployer spend for extension, upgrade, and pricing was
771,303,240 lamports; the verified final deployer balance is 9,647,869,601
lamports.

The remaining release work is real-wallet desktop and Seeker acceptance and
the signed TWA APK only after browser acceptance passes. Only the keeper's
fingerprint-bound allowlist may recur
within the fixed per-pass bounds. Existing v2 Devnet progress is intentionally
not migrated.

The v3 keeper also requires the exact compiled release fingerprint alongside
the case-sensitive write opt-in. This keeps a newly deployed image read-only
even if Fly still holds an older `KEEPER_WRITE_ENABLED=true` secret. The
fingerprint was enabled only after the replacement image reported a clean
read-only planning pass. The live keeper has a last-line signing policy: every
transaction must use the base connection, keeper payer, canonical
instruction discriminator and fixed PDAs, current Daily/Weekly cadence address,
and no additional signer. It also verifies the full padded ProgramData SHA-256
before each pass, simulates the keeper balance delta, caps spend at 50,000,000
lamports per pass, retains the eight-write/two-session limits, and stops below
the 0.1 SOL reserve floor. The release was built from commit `041f156` and is
deployed at registry digest
`sha256:2a1eb56732598736543df47515ae9d5772f350bd4c4c73d8d77eece2d7175ebb`.

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
