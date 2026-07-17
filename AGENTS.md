# Agent working rules — zkube-solana

Scope: these rules govern coding agents and operators in this repository. They
do not add approval prompts to the shipped product.

## Product truth

- The app is connection-gated. Wallet selection immediately continues to a
  single owner-approved `Enable zKube` flow.
- The connected Solana address is the player identity. There are no embedded
  wallets, recovery codes, deposits, or recovery material.
- The owner funds a shared 0.025 SOL System-owned, zero-data player funding PDA
  and a recyclable 0.005 SOL device fee allowance. A low live signer is refilled
  in place; a locally controlled expired signer is drained during rotation.
  There is no Kora or custom paymaster.
- A scoped device session authorizes safe play for about seven days; ER gameplay
  is gasless. Its on-chain rent payer must equal the player owner; the keeper
  may reclaim only expired Session Keys accounts, at most two per pass. Star
  purchases always require a separate exact native-SOL owner approval and
  preserve the 10/10/80 split.
- One durable `active_run_id` per player prevents overlapping runs and enables
  cross-device discovery. Settlement and cleanup are automatic.
- Fly runs only the independently funded Daily/Weekly keeper. The web client is
  static PWA/TWA code and contains no server signer.
- The canonical web deployment is `https://zkube-solana.vercel.app/`, owned by
  the z-korp Vercel team (`z-labs`) in project
  `prj_5kqIxlxgXHXGhldje8unic9h3qYA`. Production deploys only from
  `z-korp/zkube-solana:main`; never deploy zKube under JCN DATA.
- The Devnet Fly keeper is temporarily hosted in the `jcn-data` Fly
  organization until a z-korp Fly organization is available. This is the only
  approved JCN infrastructure exception and must not be copied to Vercel.
- Replacing the currently deployed 10-Star Daily entry with a 0.01 SOL entry
  remains deliberately deferred and requires its own contract, client,
  migration, and deployment review.

If code or comments contradict these rules, fix them with the implementation.
Architecture and operations documentation belongs in code comments and
`README.md`; do not add new Markdown documents.

## Deferred design records

- `README.md` under “Deferred Kora-sponsored Devnet gameplay” contains the
  saved implementation and rollout plan for a possible later Devnet Kora
  sponsorship release. Its purpose is to preserve
  the researched no-custom-API design, security constraints, fallback,
  verification, and hosting decisions. It is planning material only: it does
  not supersede Product truth, authorize implementation or deployment, or
  approve funding the Kora signer.

## Transaction policy

- The funded Devnet deployment fee payer is
  `/home/djizus/cycling-sim/.devnet/deployer.json` with public key
  `7WFy4QkiUx9GZHkVz3wdWJbdMgMf6gtK8JnbWDYqZDRA`. The reference repository is
  read-only: use this keypair in place; never copy, modify, delete, or commit it.

- Never sign or send a transaction without explicit user approval for its
  exact instructions, accounts, signers, and spend. One approval may cover an
  enumerated release bundle only when every operation is presented in advance
  with its cluster, signer, recipient/accounts, exact or maximum spend, and
  deterministic fingerprint where available. Stop before signing if any
  approved detail drifts; vague or standing approvals are invalid. Simulation
  is evidence, not authority.
- The sole recurring-write exception is a separately approved, fingerprinted
  keeper release whose code enforces the canonical instruction allowlist,
  Devnet genesis and deployed ProgramData hash, exact keeper payer/signer,
  current cadence PDAs, at most eight writes and two expired-session closures
  per pass, a 0.05 SOL simulated spend ceiling per pass, and the 0.1 SOL reserve
  floor. Changing that allowlist, fingerprint, cluster, signer, or any bound
  requires a new exact approval bundle; the exception grants no general or
  operator-interactive transaction authority.
- Automated verification is offline: format, typecheck, lint, tests, builds,
  and read-only RPC probes.
- Program deploy/upgrade, bootstrap stages, initial keeper write enablement, moving SOL,
  publishing a Daily challenge, governance changes, and anything on mainnet
  require explicit approval, either individually or as exact operations in an
  enumerated release bundle. Mainnet is currently rejected.
- Prefix every Solana, Anchor, or pnpm chain command with `NO_DNA=1`.
- Never print, copy, expose, or commit signer bytes, seeds, recovery material,
  `.env` contents, keeper secrets, or Android signing credentials.
- The ignored v3 program identity is `.devnet/zkube-v3-program-keypair.json`;
  source control contains only its public address. Never display the file.

## Worktree rules

- Preserve unrelated and in-flight changes. Never use `git reset --hard`,
  `git checkout --`, blanket cleanup, or destructive file restoration.
- Use `apply_patch` for edits and `rg`/`rg --files` for discovery.
- `/home/djizus/zkube` and `/home/djizus/cycling-sim` are read-only references.
- Vercel CLI inspection must run from the repository root with an existing
  link to the exact z-korp project above and an explicit `--scope z-labs`.
  Production publishing is Git-driven; do not run a manual Vercel production
  deployment.

## Chain-data discipline

- Treat RPC data as untrusted: verify cluster genesis, account owner, exact or
  bounded data length, discriminator, PDA seeds, and account relationships.
- Keep Solana base, MagicBlock Router, and resolved ER connections separate.
  Resolve the ER via `getDelegationStatus`; never hardcode a regional endpoint.
- The player funding PDA may sign only narrow self-CPI wrappers. Never add a
  generic PDA transfer or arbitrary-instruction forwarding path.
- Require owner signatures for every Star purchase. A session must never
  authorize native-SOL spending outside the fixed safe-action boundary.
- Preserve `ActiveRun` until its copied-back terminal state is consumed. Clear
  `active_run_id`, update progression, and close `ActiveRun` in that one atomic
  base-layer instruction.

## Validation gates

```bash
NO_DNA=1 ./validate.sh program
cd client
NO_DNA=1 pnpm idl:check
NO_DNA=1 pnpm exec tsc -b --pretty false
NO_DNA=1 pnpm lint
NO_DNA=1 pnpm exec vitest run
NO_DNA=1 pnpm build
```

Start with `README.md`, then inspect the code at the boundary being changed:
`state`/`instructions` for on-chain invariants, `client/src/chain` for client
transactions, `client/src/platform` for wallet/browser adapters, and `services`
for the keeper. Do not infer deployed state from source; verify it read-only.
