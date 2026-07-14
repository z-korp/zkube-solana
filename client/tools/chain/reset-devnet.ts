import {
  devnetResetInputFromEnv,
  formatDevnetReset,
  runDevnetReset,
} from "../../src/chain/devnetReset";

async function main(): Promise<void> {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    process.stdout.write(
      [
        "zKube legacy Devnet reset planner",
        "",
        "Dry-run is the default and performs unsigned Devnet simulations.",
        "Sending additionally requires both:",
        "  ZKUBE_RESET_SEND=1",
        "  ZKUBE_RESET_APPROVAL=<printed fingerprint>",
        "",
        "Optional:",
        "  ZKUBE_BASE_RPC=https://rpc.magicblock.app/devnet",
        "  ZKUBE_RESET_FUNDER_KEYPAIR=<funded Devnet payer path>",
        "  ZKUBE_RESET_AUTHORITY_KEYPAIR=<legacy governance authority path>",
        "  ZKUBE_RESET_CANDIDATE_OUT=../artifacts/devnet-reset.candidate.json",
        "  ZKUBE_RESET_PROOF_OUT=../artifacts/devnet-reset.proof.json",
        "",
        "Devnet only. Mainnet, testnet, and localhost are rejected.",
        "",
      ].join("\n"),
    );
    return;
  }
  const result = await runDevnetReset(devnetResetInputFromEnv());
  process.stdout.write(`${formatDevnetReset(result)}\n`);
}

void main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
