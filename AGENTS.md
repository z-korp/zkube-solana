# Agent working rules — zkube-solana

Scope: these rules govern **AI coding agents and operators running agents in
this repository**. Nothing in this file describes product behavior. The shipped
client needs no approvals and no manual steps: it silently creates an embedded
identity that signs programmatically, the paymaster sponsors all base fees and
rent, gameplay is session-key signed on the ephemeral rollup, and settlement
runs automatically. If a document makes gameplay sound approval-gated, the
document is wrong — fix the document.

## Transaction policy

- Never sign or send a transaction without explicit user approval for the
  exact scope (instructions, accounts, signers, spend). Approval for one
  operation never carries over to another; a successful simulation is
  evidence, not authorization.
- Automated verification is offline: typecheck, lint, vitest, build, and
  read-only RPC probes. Live signed flows (settling a run, withdrawing,
  deploying, bootstrapping) are user-approved, one exact scope at a time.
- Prefix every Solana/Anchor/pnpm chain command with `NO_DNA=1`.
- Never print, copy, expose, or commit signer bytes, recovery codes, seeds,
  or `.env` contents. The embedded browser identity's recovery material must
  never leave the browser.

## Worktree rules

- Never use `git reset --hard`, `git checkout --`, or blanket cleanup; the
  worktree may carry another agent's in-flight work.
- `/home/djizus/zkube` (original Starknet client) and `/home/djizus/cycling-sim`
  (MagicBlock reference implementation) are read-only external references.

## Chain-data discipline

- Treat all RPC data as untrusted: check account owner, data length,
  discriminator, PDA relationship, and cluster genesis before decoding.
- Keep base-layer, Router, and ER connections separate. Resolve the ER through
  `getDelegationStatus`; never hardcode a regional endpoint.
- Preserve unsettled run accounts until durable receipt evidence exists; never
  close accounts merely because an ER transaction returned success.

## Actions that always need a separate explicit approval

Program deploy/upgrade, bootstrap stages, yield adapter work, moving USDC,
publishing a Daily challenge, governance changes, and anything touching
mainnet (currently rejected by tooling).

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

## Reading order

1. `STATUS.md` — current deployed state and open items.
2. `docs/architecture.md` — product, account, Router/ER/VRF, and settlement rules.
3. `docs/operations.md` — deployment identity, custody invariants, and incidents.
4. `docs/development.md` — repository layout and offline validation workflow.
5. `/home/djizus/cycling-sim/docs/magicblock-focg.md` and
   `devnet-deploy-runbook.md` — upstream MagicBlock reference patterns.
