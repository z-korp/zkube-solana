# zKube Solana — Project status

Updated: 2026-07-12 (Europe/Paris). This file tracks current deployed state and
open items. It replaces the retired `HANDOFF.md`; agent working rules live in
`AGENTS.md`, architecture in `MAGICBLOCK.md`, operations in `OPERATIONS.md`,
and the full implementation record in `IMPLEMENTATION.md`.

## Runtime pointers

- Client: `client/` (Vite dev on `http://127.0.0.1:5175`, paymaster route
  `/api/paymaster`, expected identity
  `CNhMPp5p3ViMEzBpeRRjXX1G672rwxHkyNG4gVRN7SgY`).
- Frozen pre-port client: `client-archive/` (read-only reference, outside all
  gates; delete only after parity sign-off, as a separate decision).
- Base RPC: `https://rpc.magicblock.app/devnet` · Router:
  `https://devnet-router.magicblock.app/`. Devnet is the rollout and
  acceptance target; mainnet is a separate disabled gate.

## Live Devnet program

- Program: `5NfTo5ML4UTa6ep4x9d616fyWQYM3CTcpcE5V9P7YUbA`
  (ProgramData `ALpqN17vyyQr3vuqaHiCAdawtiMniVxK6PzEgPw7P9sB`, upgrade
  authority `2so568MdBWj9FMdC1pLQEJtgMo3LpYXFHKZ39GvEgEox`).
- Current binary: slot `475787281`, signature `3k5JLn49…xjuF`, SBF SHA-256
  `65e45420574910611285f25bbaa95eb5a69a04f9ea4b8fe1a4880ffba218646e`
  (adds `abandonRunV1`; includes the corrected Magic Action commit metas).
  ProgramData allocation extended to 1,604,032 code bytes (7,432 headroom);
  deployed code hash independently verified byte-for-byte, trailing bytes
  zero, stable buffer closed, upgrade authority preserved.
- Bootstrap complete: custody `08063b99625c0a82`, protocol `1f6cd8031b2ec13a`,
  catalogs `d3d34aa2e7528cad`. Canonical Devnet USDC, vault addresses, and
  sanitized proofs are recorded in `MAGICBLOCK.md`, `OPERATIONS.md`, and
  `artifacts/`.

## Client state

The original zKube client is fully ported to `client/` on the Solana/
MagicBlock layer (branch `feat/solana-reboot`, commits `a6cb50f..a635c4e`;
execution plan preserved as `CLIENT_PORT_PLAN.md`). No Starknet/Dojo/Cartridge
code remains in the executable graph.

The player lifecycle is fully automatic — no wallet popups, no manual chain
steps, no player SOL required:

- The embedded identity is created silently and signs programmatically;
  session creation rides the first sponsored prepare transaction, and expired
  sessions renew silently on resume (one guarded attempt per lapse; failures
  surface a retry affordance).
- The paymaster funds all base fees, account rent, and the Magic Action
  escrow; a fresh zero-SOL identity plays campaign Map 1 Level 1 end-to-end.
- Moves/bonuses are session-key signed on the Router-resolved ER.
- Settlement (seal → commit/undelegate → copyback → receipt → rent reclaim)
  runs in an auto-settle effect; there is no manual settle button. Resuming
  into an already-settled run auto-cleans its rent, and orphaned base runs
  are recoverable.
- Quit is an on-chain abandon (`abandonRunV1`, live since slot `475787281`):
  terminal with zero stars, settled through the unchanged pipeline, ActiveRun
  rent reclaimed — cycling-sim abort semantics. The local forget-marker path
  remains only as a fallback and for the explicit "Forget locally" buttons.
- Clicks that remain are user intent (choosing a level, paid Daily entry,
  claims, unlocks, withdrawals) — the same set cycling-sim keeps.

The chain layer lives at `client/src/chain/` (generated IDL under
`src/chain/idl/`, controllers `useRunController`/`useCampaignController`/
`useDailyController`/`useProgressController`, contexts share single
instances). No dojo/starknet/cartridge/torii vocabulary and no "reboot"
codename remain in executable source.

Gate: 53 test files / 197 tests, IDL check, strict + chain typechecks
(`typecheck:chain`), zero-warning lint, production build — all green; 69
Rust tests, formatting/Clippy/SBF/IDL clean.

## Open items

1. **Legacy first-run cleanup** — the pre-upgrade run (embedded owner
   `BQNuPSn2oHn9sU9rKA2hdZfDmiMpdwFYX9D9HqvFKTB6`, run 1, Map 1 Level 1,
   `levelComplete`, copied back to base, receipt still unconsumed). The
   browser holding that identity finalizes it via the explicit
   `http://127.0.0.1:5175/?recover=1` flow; the sponsored envelope is
   `consumeSponsorshipV1` + `consumeRunReceiptV1` + `closeSettledActiveRunV1`
   (simulates at 48,993 CU). Operator approval required before signing.
   Afterward: verify receipt/progress postconditions and save a sanitized
   lifecycle proof.
2. **Vercel dashboard**: set the project Root Directory to `client`
   (not automatable from the repo).
3. **Paymaster reserve ops** — the paymaster ran dry on 2026-07-12
   (0.011 SOL left of the original 0.1), which blocked every new player with
   a raw "Simulation failed … Custom:1" panel. Refunded to ~1 SOL from the
   deployer. Each fresh-identity first run costs it ~0.014 SOL. Needed:
   scheduled `pnpm chain:readiness --min-paymaster-lamports` alerting, a
   friendly client message when sponsorship is unavailable, and a stale
   quit-dialog copy fix (it still describes the pre-abandon local-only
   behavior).
4. **Signed live-Devnet acceptance**: multi-move gameplay depth, settle-through
   -to-receipt on a fresh run, Vault withdraw, and a recovery-code restore
   round-trip. Each signing step is approval-gated.
5. **Recorded debt**: production bundle code-splitting; production monitoring/
   alerting deployment, independent security review, and launch policy
   decisions (tracked in `IMPLEMENTATION.md` Iteration 5 and `OPERATIONS.md`).

## Validation

```bash
NO_DNA=1 ./validate.sh program
NO_DNA=1 ./validate.sh frontend
```
