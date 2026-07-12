# Deployment manifests

Production deployment is fail-closed and requires a sanitized, approved zKube
manifest. Do not add a candidate file here and label it approved. The approved
file is created only after the separately authorized proof/deployment produces
the required fingerprint, SBF hash, signatures, on-chain account identities,
and sanitized evidence hash.

Recommended path after approval:

```text
deployment/approved.devnet.json
```

Validate a release artifact before publishing the manifest:

```bash
NO_DNA=1 pnpm chain:manifest -- \
  --manifest deployment/approved.devnet.json \
  --artifact ../solana/target/deploy/solana.so \
  --require-approved
```

For an artifact-less web build, set `ZKUBE_PROGRAM_ARTIFACT_SHA256` from that
validated release and run the same gate with `--artifact-sha256`. Vercel does
this automatically through `pnpm deploy:build` when `VERCEL_ENV=production`.

The manifest is public evidence. It must never contain a wallet path, keypair,
seed phrase, private/secret key, RPC credential, or paymaster secret.

The selected Devnet identity
`5NfTo5ML4UTa6ep4x9d616fyWQYM3CTcpcE5V9P7YUbA` is live at slot `475536003`.
ProgramData `ALpqN17vyyQr3vuqaHiCAdawtiMniVxK6PzEgPw7P9sB` matches SBF SHA-256
`1a6f1dd87811eabf7213433e3d49e104212e19b76df67cb6a3828d8a8c15161a` and is
controlled by dedicated upgrade authority
`2so568MdBWj9FMdC1pLQEJtgMo3LpYXFHKZ39GvEgEox`. Deployment signature is
`bkhBvwRimF6xQHLbMDt5ULcQfb4sghbraK7Jdw4a3gS3t6sT3WNobDsyL5httCWBFxNVEzfHmj6k4aSb7uRCwKj`;
sanitized proof SHA-256 is
`620b14cad362ebbf5fd0ad23075d2da3f673b11f19454e14a1e0a835688c7b3d`.
The retired `7zdL...Y2nN` deployment remains untouched and is not on the zKube
rollout path.

Preview the cycling-sim-style Devnet upgrade plan from the built SBF:

```bash
NO_DNA=1 pnpm chain:devnet:deploy
```

The planner is Devnet-only, defaults to `https://rpc.magicblock.app/devnet`,
defaults to `upgrade`, and binds the SBF hash, operation, stable program
identity, signer public identities, and sanitized commands into a fingerprint.
It keeps preflight enabled and sends nothing by default. An executable upgrade
requires the deployed authority, a funded Devnet fee payer, the explicit send
flag, and the exact approved fingerprint. Set `ZKUBE_DEPLOY_MODE=initial` only
for an explicitly reviewed fresh identity migration.

The completed initial deployment deliberately separated roles: cycling-sim
signer `7WFy...ZDRA` paid the one-time Devnet loader rent/fees, while dedicated
zKube signer `2so5...gEox` became upgrade authority. The program and authority
key files remain ignored and `0600`; stable buffer `9B7U...d6bw` closed after
the successful upload. Program deployment precedes the still-pending,
separately approved protocol/vault/catalog initialization and end-to-end
Router/ER gameplay proof. No secret belongs in this directory or a deployment
manifest.

Before producing the full runtime manifest, initialize custody, protocol, and
catalogs through the separately fingerprinted `pnpm chain:devnet:bootstrap`
stages. The program deployment proof cannot stand in for bootstrap approval.
The browser becomes writable only after `ProtocolConfig` binds the advertised
paymaster and the five verified canonical-USDC vaults.
