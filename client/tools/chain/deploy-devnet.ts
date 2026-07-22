import {
  devnetDeploymentInputFromEnv,
  formatDevnetDeployment,
  runZkubeDevnetDeployment,
} from "../../src/chain/deploymentRunner";

async function main(): Promise<void> {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    process.stdout.write(
      [
        "zKube Devnet deployment planner",
        "",
        "Required for the configured zKube program deployment:",
        "  ZKUBE_DEPLOY_MODE=initial | upgrade (required; never inferred)",
        "  ZKUBE_DEPLOYER_KEYPAIR=<funded Devnet fee-payer path>",
        "  ZKUBE_UPGRADE_AUTHORITY_KEYPAIR=<dedicated zKube authority path>",
        "  ZKUBE_PROGRAM_BUFFER_KEYPAIR=<fresh resumable buffer keypair path>",
        "",
        "Optional:",
        "  ZKUBE_BASE_RPC=https://rpc.magicblock.app/devnet",
        "  ZKUBE_ANCHOR_WORKSPACE=..",
        "  ZKUBE_PROGRAM_ARTIFACT=../target/deploy/solana.so",
        "  ZKUBE_EXPECTED_CURRENT_SBF_SHA256=<required upgrade preimage hash>",
        "  ZKUBE_DEPLOYER_RESERVE_LAMPORTS=100000000",
        "  ZKUBE_PROGRAM_KEYPAIR=<required only for initial deployment>",
        "  ZKUBE_DEPLOYER_PUBLIC_KEY=<read-only preview alternative>",
        "  ZKUBE_PROGRAM_BUFFER_PUBLIC_KEY=<read-only preview alternative>",
        "  ZKUBE_UPGRADE_AUTHORITY_PUBLIC_KEY=<read-only preview alternative>",
        "",
        "Dry-run is the default. Sending additionally requires both:",
        "  ZKUBE_DEPLOY=1",
        "  ZKUBE_DEPLOY_APPROVAL=<printed fingerprint>",
        "",
        "The dry-run performs live read-only rent/fee/ProgramData preflight and",
        "fingerprints the frozen SBF. It never rebuilds or copies a keypair.",
        "Initial allocation includes exactly 10,240 bytes of headroom.",
        "Devnet only. Mainnet and localhost are rejected.",
        "",
      ].join("\n"),
    );
    return;
  }
  const result = await runZkubeDevnetDeployment(devnetDeploymentInputFromEnv());
  process.stdout.write(`${formatDevnetDeployment(result)}\n`);
}

void main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
