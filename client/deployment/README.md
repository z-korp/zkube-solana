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
`5NfTo5ML4UTa6ep4x9d616fyWQYM3CTcpcE5V9P7YUbA` is live with its current
upgrade at slot `475577726`. ProgramData
`ALpqN17vyyQr3vuqaHiCAdawtiMniVxK6PzEgPw7P9sB` has a 1,592,248-byte code
prefix matching SBF SHA-256
`d075288f0c7776ed50dad38cb770ea4e2c6f277b2049b8a6336cd69b87336636`;
its remaining 1,544 allocation bytes are zero. Dedicated upgrade authority
`2so568MdBWj9FMdC1pLQEJtgMo3LpYXFHKZ39GvEgEox` is unchanged. The current
upgrade signature is
`2wrqVqv9C8sqK1Hrb2xFE37f48YPfVW2EoxULjc1qaJvHH63bX38Yvvbo3Ca3MefF6W49Q1FeLpuchpUuzUXBR5t`;
approved fingerprint `21ef11168ed0fe45` and the sanitized evidence are in
`../../artifacts/devnet-program-upgrade.proof.json`. The retired
`7zdL...Y2nN` deployment remains untouched and is not on the zKube rollout
path.

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

The completed deployment deliberately separates roles: cycling-sim signer
`7WFy...ZDRA` pays Devnet loader fees, while dedicated zKube signer
`2so5...gEox` remains upgrade authority. Program and authority key files stay
ignored and `0600`. Both the initial stable upload buffer and the temporary
upgrade buffer closed after their successful operations.

Custody, protocol, and all eleven progress/map catalogs are already live under
approved fingerprints `08063b99625c0a82`, `1f6cd8031b2ec13a`, and
`d3d34aa2e7528cad`; their sanitized proofs are in `../../artifacts/`.
`ProtocolConfig` binds the advertised paymaster and five verified
canonical-USDC vaults. Those approvals do not authorize a new upgrade,
gameplay transaction, settlement, withdrawal, or publication of an approved
runtime manifest. The final owner-signed Router/ER settlement and Daily-USDC
lifecycle proofs remain separate approval-gated operations. No secret belongs
in this directory or a deployment manifest.
