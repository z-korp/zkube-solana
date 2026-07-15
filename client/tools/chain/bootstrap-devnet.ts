import {
  devnetBootstrapInputFromEnv,
  formatDevnetBootstrap,
  runDevnetBootstrap,
} from "../../src/chain/devnetBootstrap";

async function main(): Promise<void> {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    process.stdout.write(
      [
        "zKube Devnet bootstrap planner",
        "",
        "Stages are deliberately separate because each stage depends on accounts",
        "created by the prior stage and Daily publication needs its own approval:",
        "  ZKUBE_BOOTSTRAP_STAGE=custody (default) | protocol | economy",
        "    | daily-rules | maps | activation",
        "",
        "Dry-run is the default and performs unsigned Devnet simulations.",
        "Sending additionally requires both:",
        "  ZKUBE_BOOTSTRAP_SEND=1",
        "  ZKUBE_BOOTSTRAP_APPROVAL=<printed fingerprint>",
        "",
        "Optional:",
        "  ZKUBE_BASE_RPC=https://rpc.magicblock.app/devnet",
        "  ZKUBE_BOOTSTRAP_CANDIDATE_OUT=../artifacts/devnet-bootstrap.<stage>.candidate.json",
        "  ZKUBE_BOOTSTRAP_PROOF_OUT=../artifacts/devnet-bootstrap.<stage>.proof.json",
        "",
        "Devnet only. Mainnet, testnet, and localhost are rejected.",
        "",
      ].join("\n"),
    );
    return;
  }
  const result = await runDevnetBootstrap(devnetBootstrapInputFromEnv());
  process.stdout.write(`${formatDevnetBootstrap(result)}\n`);
}

void main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
