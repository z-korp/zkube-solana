# Agent working rules — zkube-solana

Scope: these rules govern coding agents and operators in this repository. They
do not add approval prompts to the shipped product.

## Product truth

- The app is connection-gated. Wallet selection immediately continues to a
  single owner-approved `Enable zKube` flow.
- The connected Solana address is the player identity. There are no embedded
  wallets, recovery codes, deposits, or recovery material.
- The owner funds a shared 0.025 SOL player funding PDA and a 0.001 SOL device
  fee allowance. There is no Kora or custom paymaster.
- A scoped device session authorizes safe play for about seven days; ER gameplay
  is gasless. Its on-chain rent payer must equal the player owner; the keeper
  may reclaim only expired Session Keys accounts, at most two per pass. Star
  purchases always require a separate exact native-SOL owner approval and
  preserve the 10/10/80 split.
- One durable `active_run_id` per player prevents overlapping runs and enables
  cross-device discovery. Settlement and cleanup are automatic.
- Fly runs only the independently funded Daily/Weekly keeper. The web client is
  static PWA/TWA code and contains no server signer.

If code or comments contradict these rules, fix them with the implementation.
Architecture and operations documentation belongs in code comments and
`README.md`; do not add new Markdown documents.

## Transaction policy

- Never sign or send a transaction without explicit user approval for that
  exact operation, instructions, accounts, signers, and spend. One approval
  never carries to another operation; simulation is evidence, not authority.
- Automated verification is offline: format, typecheck, lint, tests, builds,
  and read-only RPC probes.
- Program deploy/upgrade, bootstrap stages, keeper write enablement, moving SOL,
  publishing a Daily challenge, governance changes, and anything on mainnet
  always require a separate explicit approval. Mainnet is currently rejected.
- Prefix every Solana, Anchor, or pnpm chain command with `NO_DNA=1`.
- Never print, copy, expose, or commit signer bytes, seeds, recovery material,
  `.env` contents, keeper secrets, or Android signing credentials.

## Worktree rules

- Preserve unrelated and in-flight changes. Never use `git reset --hard`,
  `git checkout --`, blanket cleanup, or destructive file restoration.
- Use `apply_patch` for edits and `rg`/`rg --files` for discovery.
- `/home/djizus/zkube` and `/home/djizus/cycling-sim` are read-only references.

## Chain-data discipline

- Treat RPC data as untrusted: verify cluster genesis, account owner, exact or
  bounded data length, discriminator, PDA seeds, and account relationships.
- Keep Solana base, MagicBlock Router, and resolved ER connections separate.
  Resolve the ER via `getDelegationStatus`; never hardcode a regional endpoint.
- The player funding PDA may sign only narrow self-CPI wrappers. Never add a
  generic PDA transfer or arbitrary-instruction forwarding path.
- Require owner signatures for every Star purchase. A session must never
  authorize native-SOL spending outside the fixed safe-action boundary.
- Preserve run accounts until the durable base receipt is consumed. Clear
  `active_run_id` only in that atomic consumption path, before cleanup.

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
