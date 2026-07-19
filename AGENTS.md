# Agent working rules — zkube-solana

These rules govern coding agents and operators in this repository. They do not
add approval prompts to the shipped product.

## Product truth

- zKube v4 targets the Solana dApp Store and Seeker. Google Play is out.
- The connected Solana address is the player identity. There are no embedded
  wallets, recovery codes, deposits, soft currencies, shops, passes, or prize
  claims.
- Campaign and yesterday's unranked Practice are free. Map 1 unlocks Arena.
- Every ranked Arena run requires a separate owner-signed exact 0.02 SOL entry.
  Device sessions can never authorize that transfer.
- Entries split 75% to the Daily pot, 15% to operator revenue, and 10% to the
  seven-day Weekly jackpot. Daily pays 45/25/15/10/5 and Weekly pays 60/25/15.
- Settlement is push-only, may be late, and is never cancelled. Empty pots roll
  forward; profile synchronization never gates money.
- Failed entries are refunded only after a bounded authority-declared Daily
  incident and always from operator collateral, never a prize pot. Ordinary
  unresolved entries expire after the recovery and declaration windows.
- XP, quests, achievements, titles, ratings, emblems, and stats never grant
  SOL, entries, prize eligibility, or mint odds.
- The owner funds the shared System-owned zero-data player funding PDA and the
  recyclable device fee allowance. Funding PDAs sign only narrow self-CPI rent
  paths; there is no Kora or generic paymaster.
- One durable `active_run_id` prevents overlapping runs and supports
  cross-device recovery. Base, Router, and resolved ER connections remain
  separate; resolve ER placement with `getDelegationStatus`.
- Fly runs only the independently funded Daily/Weekly keeper. The web client is
  static PWA/TWA code with no server signer.
- v4 is Devnet-first and presently undeployed. Mainnet requires counsel,
  economic, and distribution review.

Architecture and operations documentation belongs in code comments and
`README.md`; do not add new Markdown documents.

## Transaction policy

- The Devnet deployment fee payer is the read-only keypair at
  `/home/djizus/cycling-sim/.devnet/deployer.json`, public key
  `7WFy4QkiUx9GZHkVz3wdWJbdMgMf6gtK8JnbWDYqZDRA`. Never copy, modify, expose,
  delete, or commit it.
- Never sign or send a transaction without explicit approval for exact
  instructions, accounts, signers, cluster, and spend. A short `I approve` is
  valid only when it directly answers the immediately preceding single
  enumerated bundle and no detail has drifted.
- The recurring keeper exception requires a separately approved fingerprinted
  release enforcing Devnet genesis, deployed ProgramData hash, exact signer,
  current/recent cadence PDAs, canonical instruction allowlist, at most eight
  writes and two expired-session closures, 0.05 SOL simulated spend per pass,
  and a 0.1 SOL reserve floor.
- Governance, incident declaration, terms/rules changes, funding, withdrawals,
  deployment, initial keeper enablement, and all mainnet actions remain outside
  recurring authority and require exact approval.
- Automated verification is offline. Prefix every Solana, Anchor, and pnpm
  chain command with `NO_DNA=1`.
- Never expose signer bytes, seed phrases, `.env` contents, keeper secrets,
  Android credentials, or the ignored v4 program keypair.

## Worktree and chain-data discipline

- Preserve unrelated and in-flight changes. Never use destructive restoration
  or blanket cleanup. Use `apply_patch` for edits and `rg` for discovery.
- `/home/djizus/zkube` and `/home/djizus/cycling-sim` are read-only references.
- Treat RPC data as untrusted: verify cluster genesis, owner, bounded length,
  discriminator, PDA seeds, and account relationships before decoding.
- A player funding PDA may never gain a generic transfer or arbitrary
  instruction-forwarding path.
- Preserve `ActiveRun` until copied-back terminal state is consumed, or until a
  deterministic refund/expiry resolution prevents late scoring and permits
  safe cleanup.
- Production Vercel publishing is Git-driven only from
  `z-korp/zkube-solana:main` to project
  `prj_5kqIxlxgXHXGhldje8unic9h3qYA` under `z-labs`. Never deploy zKube under
  JCN DATA; its temporary exception is Fly Devnet keeper hosting only.

## Validation gates

```bash
NO_DNA=1 ./validate.sh program
cd services
NO_DNA=1 pnpm install --frozen-lockfile
NO_DNA=1 pnpm run build
NO_DNA=1 pnpm test
cd ../client
NO_DNA=1 pnpm idl:check
NO_DNA=1 pnpm exec tsc -b --pretty false
NO_DNA=1 pnpm lint
NO_DNA=1 pnpm exec vitest run
NO_DNA=1 pnpm build
```

Start with `README.md`, then inspect `state`/`instructions` for contract work,
`services` for keeper work, and client chain/platform boundaries only when the
client is explicitly in scope. Never infer deployed state from source.
