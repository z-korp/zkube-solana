# Development

## Toolchain and layout

- Rust `1.89.0`, Anchor `1.0.2`, and the committed Cargo lockfile.
- Node `>=20.19`; CI uses Node `24.13.0` and pnpm `10.22.0`.
- Anchor workspace files live at repository root.
- Program source: `programs/solana/`.
- Economy state/instructions: `programs/solana/src/state/economy_v2.rs` and
  `programs/solana/src/instructions/economy_v2_instructions.rs`.
- Generated SBF/IDL/types: `target/deploy/solana.so`, `target/idl/solana.json`,
  and `target/types/solana.ts`.
- Client and chain tooling: `client/`; checked-in generated client ABI:
  `client/src/chain/idl/`.
- Economy runtime/builders: `client/src/chain/economyClient.ts`,
  `economyAdminClient.ts`, `weeklyClient.ts`, and their controllers.
- Progress claims and Mastery projection: `client/src/chain/progressClient.ts`
  and `programs/solana/src/instructions/progress_instructions.rs`.
- Shared Rust/TypeScript golden fixtures: `fixtures/game-parity.json`.

Build outputs, `.devnet/`, `artifacts/`, environment files, and signer material
are ignored. Never print or copy key material. The deleted client archive is not
a dependency or reference tree.

## Validation workflow

Preferred gates:

```bash
NO_DNA=1 ./validate.sh program
NO_DNA=1 ./validate.sh frontend
# or both
NO_DNA=1 ./validate.sh all
```

The program gate runs formatting, workspace tests, Clippy with warnings denied,
an optimized Anchor/SBF build, IDL generation, and a hard scan for stack-frame/
compiler diagnostics. The frontend gate installs the frozen lockfile, checks IDL
drift, runs chain TypeScript and project builds, Vitest, and zero-warning lint.

Useful focused commands:

```bash
NO_DNA=1 cargo test --workspace
NO_DNA=1 cargo clippy --workspace --all-targets -- -D warnings
NO_DNA=1 anchor build --ignore-keys

cd client
NO_DNA=1 pnpm idl:sync
NO_DNA=1 pnpm idl:check
NO_DNA=1 pnpm exec tsc -b --pretty false
NO_DNA=1 pnpm run typecheck:chain
NO_DNA=1 pnpm lint
NO_DNA=1 pnpm exec vitest run
NO_DNA=1 pnpm build
```

Do not hand-edit generated IDL/types. Change the program, build, sync, and commit
the resulting ABI together. Treat account-meta/discriminator drift as a hard
failure.

## Client development

```bash
cd client
NO_DNA=1 pnpm install --frozen-lockfile
NO_DNA=1 pnpm dev --host 127.0.0.1
```

The Vite server mounts `/api/paymaster` for local-only development; set
`VITE_PUBLIC_ZKUBE_PAYMASTER_ENDPOINT=/api/paymaster` to use it. Production
uses the standalone compiled Fly service. Public/server configuration is
inventoried in `client/.env.example`.
Production rejects a path-based paymaster signer; use the deployment secret
manager. Never request or expose external-wallet recovery material or browser
device-session signer bytes.

Wallet and platform boundaries live in `client/src/platform/`, while the
connected-player/session lifecycle lives in `client/src/chain/`. Wallet
Standard or MWA connector types stop at the single `WalletLike` adapter and do
not spread into instruction builders. DOM, browser storage, service-worker, and
connector access remain behind platform modules so chain/domain code can move
to a later Expo client without a second implementation today.

`ConnectedPlayerGate` is mounted directly under the Solana providers. It keeps
all game/domain providers unmounted until the external address is connected and
its device session is ready. Wallet selection must use the atomic
`connectAndEnable` flow so a missing or expired session prompts enablement
immediately and a valid reusable session does not request another approval.

Fresh profiles start at run ID `1`. Run PDAs include the connected owner, and
both Campaign and Daily builders must call the shared candidate-account
preflight before constructing a prepare transaction. Keep the owner-isolation
and occupied shell/active-run/receipt cases in `runIdentity.test.ts`; do not
replace an on-chain collision with client-side run-ID guessing.

The installable web release includes `manifest.webmanifest`, static-only
service-worker caching, and `client/twa/twa-manifest.json`. The service worker
keeps all cross-origin RPC/Router/ER/paymaster traffic and local `/api`
responses network-only. After the external Android release certificate exists,
generate Digital Asset Links without committing a key:

```bash
cd client
TWA_SHA256_CERT_FINGERPRINT=AA:...:FF NO_DNA=1 pnpm twa:configure-links
```

Commit the generated public JSON only for the reviewed release certificate.
Keystores and credentials remain outside the repository.

The Fly services compile to production Node artifacts and share one container:

```bash
cd client
NO_DNA=1 pnpm run server:build
docker build -f Dockerfile.fly -t zkube-fly-services:local .
fly config validate --strict -c fly.paymaster.toml
fly config validate --strict -c fly.keeper.toml
```

`paymasterHttpServer.ts` owns HTTP/CORS/body/concurrency/readiness boundaries.
`keeperWorker.ts` owns the restart-safe cadence. The keeper depends only on a
remote `PaymasterClient`; importing or loading the paymaster key there is a
security regression.

The runtime keeps three connection roles distinct:

- base RPC for durable reads/writes and delegation;
- Router for `getDelegationStatus`;
- Router-returned ER `fqdn` for delegated gameplay and commit/undelegate.

Never hardcode a regional ER. Validate genesis, account owner, data length,
discriminator, PDA relationships and version before decoding RPC data.

## Local and Devnet tools

The local stack/smoke runner is diagnostic only and cannot satisfy Devnet
acceptance. All chain tools are dry-run-first:

```bash
cd client
NO_DNA=1 pnpm chain:local:smoke
NO_DNA=1 pnpm chain:devnet:deploy
NO_DNA=1 pnpm chain:devnet:reset
NO_DNA=1 pnpm chain:devnet:bootstrap
NO_DNA=1 pnpm chain:readiness -- --help
NO_DNA=1 pnpm chain:devnet:cost-report -- --limit 100
NO_DNA=1 pnpm chain:manifest -- --help
```

The cost report is signer-free: it validates the configured Devnet genesis and
summarizes paymaster fees, net deltas, rent/escrow outflow, rent refunds, and
current-IDL operations. It cannot classify older deployed instruction ABIs.
No command above authorizes a send. Live signed flows require the exact current
scope and fingerprint after simulation. Mainnet is rejected by tooling.

## Live binary versus source

The live Devnet hash is recorded only in [STATUS.md](../STATUS.md). Current
source includes post-deployment hardening, so a local build must not overwrite
that status value or be called deployed. Before any proposed upgrade:

1. run the full program and frontend gates;
2. hash `target/deploy/solana.so` and verify it fits the live allocation; if it
   does not, stop and prepare a separately reviewed ProgramData extension plan;
3. generate a new dry-run plan/fingerprint;
4. inspect instructions, signers, accounts, fees and maximum spend;
5. obtain explicit approval for that exact plan;
6. simulate with signatures immediately before send and verify bytes/state
   afterward.

This repository cleanup authorizes none of those steps.

## Testing expectations

The Rust suite covers deterministic gameplay, VRF mapping, progression, exact
10/10/80 sale accounting, explicit controls, and lifecycle predicates;
TypeScript tests cover builders, real v0/Ed25519 signature preservation,
session/account-switch rejection, paymaster policy, routing/reconnect,
recovery, monitoring, and UI state. Economy changes must retain tests for per-player
issuance, cadence rollover, one-award-only behavior, rounding conservation,
exact Magic Action account ordering, and paymaster signer indices. Add
instruction-level integration coverage for account constraints and CPIs when
changing security-sensitive paths, and retain shared fixture parity between
Rust and TypeScript.
