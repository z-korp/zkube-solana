# zKube Solana + MagicBlock

This repository contains the Solana reboot of zKube: a ten-map PvE campaign and a Daily Arena whose authoritative active runs execute on MagicBlock ephemeral rollups and settle to versioned Solana accounts.

Current product boundaries:

- Solana base layer owns identity, progression, Stars, content, Daily contests, USDC custody, receipts, claims, governance, sponsorship allowances, and treasury accounting.
- MagicBlock owns only the delegated active-run state and fresh per-row VRF/action lifecycle.
- The browser renders decoded authoritative state and builds transactions.
- The optional zero-SOL fee-payer relay is stateless; quota entitlement is fully on-chain.
- Payment custody is six-decimal canonical SPL Token USDC with pairwise-distinct vaults; Token-2022 extensions are rejected by protocol v1.
- External yield deployment is disabled until a separately selected and reviewed adapter is implemented.

Start with:

- [HANDOFF.md](HANDOFF.md) — complete current-state handoff for the next agent,
  including the live run and exact remaining lifecycle steps.
- [IMPLEMENTATION.md](IMPLEMENTATION.md) — scope, architecture, iteration status, decisions, and validation evidence.
- [MAGICBLOCK.md](MAGICBLOCK.md) — authoritative cycling-sim-derived Router, ER, VRF, embedded identity, settlement, and proof rules.
- [OPERATIONS.md](OPERATIONS.md) — deployment identity, approval gates, custody invariants, readiness probe, and incident procedures.
- [client-budokan/.env.example](client-budokan/.env.example) — public/server configuration inventory; never commit a real paymaster secret.
- [client-budokan/deployment/README.md](client-budokan/deployment/README.md) — approved deployment-manifest contract and fail-closed production build gate.

Sanitized Devnet evidence lives under `artifacts/`. In particular,
`devnet-loader-rent-audit.proof.json` records the exact initial-deploy versus
upgrade buffer flows so permanent ProgramData rent is never mistaken for a
failed upload leak again.

## Validation

```bash
NO_DNA=1 ./validate.sh program
cd client-budokan
pnpm idl:check
pnpm exec tsc -b --pretty false
pnpm lint
pnpm exec vitest run
pnpm build
```

## Live Devnet status

The zKube program is live on MagicBlock Devnet:

- Program: `5NfTo5ML4UTa6ep4x9d616fyWQYM3CTcpcE5V9P7YUbA`
- ProgramData: `ALpqN17vyyQr3vuqaHiCAdawtiMniVxK6PzEgPw7P9sB`
- Upgrade authority: `2so568MdBWj9FMdC1pLQEJtgMo3LpYXFHKZ39GvEgEox`
- Latest deployment slot: `475577726`
- Latest upgrade signature: `2wrqVqv9C8sqK1Hrb2xFE37f48YPfVW2EoxULjc1qaJvHH63bX38Yvvbo3Ca3MefF6W49Q1FeLpuchpUuzUXBR5t`
- Deployed SBF SHA-256: `d075288f0c7776ed50dad38cb770ea4e2c6f277b2049b8a6336cd69b87336636`
- Sanitized proofs: `artifacts/devnet-program-deployment.proof.json` for the initial deployment and `artifacts/devnet-program-upgrade.proof.json` for the current binary (upgrade proof SHA-256 `fadd75eeaea00adaab6495e91eac5ed99bcac481e671a9447464b5ffffa43ede`)

The custody stage is live: five empty canonical-USDC vaults were created and the
stateless paymaster was funded with 0.1 SOL under approved fingerprint
`08063b99625c0a82`. Protocol initialization is also live under approved
fingerprint `1f6cd8031b2ec13a`, and all version-1 catalogs are live under
fingerprint `d3d34aa2e7528cad`. The first embedded-client run prepared,
delegated, consumed VRF rows, and reached `levelComplete` on the Router-resolved
ER. Its commit reproduced `InvalidWritableAccount`: the ER outer instruction
marked base-only Magic Action targets writable. Campaign and Daily commit
contexts now follow cycling-sim by keeping those outer target metas read-only
and granting writability only inside the base-layer `CallHandler`. The
corrected SBF
`d075288f0c7776ed50dad38cb770ea4e2c6f277b2049b8a6336cd69b87336636`
was deployed under approved fingerprint `21ef11168ed0fe45` at slot `475577726`,
signature `2wrqVqv9...BR5t`. The loader drained and closed the temporary
11.08325016-SOL buffer back to the deployer, and the on-chain code prefix
matches the artifact byte-for-byte. The preserved Router-resolved commit now
simulates successfully at 55,849 CU with only the payer, delegated ActiveRun,
and Magic context writable. Owner-signed settlement/copyback/cleanup remain to
be executed from the embedded client.
Selected public bootstrap identities are recorded in
`artifacts/devnet-bootstrap-identities.candidate.json`; candidate status is not
approval. Sanitized custody, protocol, and catalog execution proofs are stored under
`artifacts/`.

## Devnet deployment and upgrades

```bash
cd client-budokan
NO_DNA=1 pnpm chain:devnet:deploy
```

The rollout architecture follows cycling-sim: Solana base writes target
`https://rpc.magicblock.app/devnet`, delegation selects a public validator
through the MagicBlock Router, and live play uses the ER `fqdn` returned by
`getDelegationStatus`. The deployment planner is dry-run-only unless the exact
printed fingerprint is explicitly approved and supplied. It now defaults to an
existing-program upgrade; a fresh identity migration must explicitly select
`ZKUBE_DEPLOY_MODE=initial`. Mainnet remains a separate, disabled launch gate.

## Devnet protocol bootstrap

The protocol bootstrap is dry-run-first and deliberately staged because later
transactions depend on accounts created by earlier stages:

```bash
cd client-budokan
NO_DNA=1 pnpm chain:devnet:bootstrap
ZKUBE_BOOTSTRAP_STAGE=protocol NO_DNA=1 pnpm chain:devnet:bootstrap
ZKUBE_BOOTSTRAP_STAGE=catalogs NO_DNA=1 pnpm chain:devnet:bootstrap
```

Each stage verifies Devnet genesis, the deployed ProgramData SBF hash,
canonical six-decimal SPL USDC, signer public identities, account ownership,
rent, and funder headroom. It performs unsigned Devnet simulations and emits a
sanitized candidate. Sending requires the exact stage fingerprint plus explicit
approval; approval for one stage never authorizes another.

The client silently creates a stable embedded zKube identity; Phantom and other
injected wallets are not part of the app flow. Users copy their zKube Vault
address to top up from any external source for paid content, while sponsored
gameplay can keep a zero SOL balance.

The original `~/zkube` presentation is restored as Solana-native routes: home,
ten-map progression, boss reveal, gameplay HUD/action bar, campaign completion,
Daily Arena, profile, quests/rewards, leaderboard, and settings. The account
panel is the embedded zKube Vault rather than a wallet connector. Authoritative
gameplay and progression values are decoded from Solana/ER accounts; no
Cairo/Dojo state path remains in the executable client.

The localhost stack remains available only as an optional developer test. It is
not an Iteration 1 acceptance gate and does not substitute for Devnet evidence.

## Web deployment

Configure `client-budokan` as the deployment platform's project root. Its single
`vercel.json` builds the Vite app and preserves `api/paymaster.ts` as the
stateless fee-payer function. Installations use the committed lockfile. Supply
the public and server-only values listed in `client-budokan/.env.example` through
the platform settings; keep `PAYMASTER_SECRET_KEY` in its secret manager.
Production builds additionally require `ZKUBE_DEPLOYMENT_MANIFEST` to identify
an approved sanitized manifest whose environment and SBF hash pass
`pnpm chain:manifest`; candidate or mismatched manifests fail the build.
