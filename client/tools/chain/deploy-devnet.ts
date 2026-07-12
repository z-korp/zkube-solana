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
        "Required for the default upgrade of deployed 5NfTo5...:",
        "  ZKUBE_DEPLOYER_KEYPAIR=<funded Devnet fee-payer path>",
        "  ZKUBE_UPGRADE_AUTHORITY_KEYPAIR=<dedicated zKube authority path>",
        "",
        "Optional:",
        "  ZKUBE_BASE_RPC=https://rpc.magicblock.app/devnet",
        "  ZKUBE_ANCHOR_WORKSPACE=../solana",
        "  ZKUBE_PROGRAM_ARTIFACT=../solana/target/deploy/solana.so",
        "  ZKUBE_DEPLOY_MODE=upgrade (default) | initial",
        "  ZKUBE_PROGRAM_BUFFER_KEYPAIR=<resumable buffer keypair path>",
        "  ZKUBE_PROGRAM_KEYPAIR=<required only for initial deployment>",
        "",
        "Dry-run is the default. Sending additionally requires both:",
        "  ZKUBE_DEPLOY=1",
        "  ZKUBE_DEPLOY_APPROVAL=<printed fingerprint>",
        "",
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
