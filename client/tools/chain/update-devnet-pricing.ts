import {
  economyPricingReleaseInputFromEnv,
  formatEconomyPricingRelease,
  runEconomyPricingRelease,
} from "../../src/chain/economyPricingRelease";

async function main(): Promise<void> {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    process.stdout.write(
      [
        "zKube Devnet economy pricing release planner",
        "",
        "Required:",
        "  ZKUBE_PRICING_EXPECTED_SBF_SHA256=<feature release SBF hash>",
        "",
        "Optional while planning a bundle before that upgrade:",
        "  ZKUBE_PRICING_PLANNING_SBF_SHA256=<current deployed SBF hash>",
        "  ZKUBE_PRICING_FEE_PAYER_KEYPAIR=<funded Devnet payer path>",
        "  ZKUBE_PRICING_OPERATOR_KEYPAIR=<governance authority path>",
        "  ZKUBE_BASE_RPC=https://rpc.magicblock.app/devnet",
        "",
        "Dry-run is the default. Sending additionally requires both:",
        "  ZKUBE_PRICING_SEND=1",
        "  ZKUBE_PRICING_APPROVAL=<printed fingerprint>",
        "",
        "The send path requires the feature SBF hash, exact legacy revision-1",
        "account bytes, signature-verified simulation, and the printed approval.",
        "Devnet only. Mainnet and localhost are rejected.",
        "",
      ].join("\n"),
    );
    return;
  }
  const result = await runEconomyPricingRelease(
    await economyPricingReleaseInputFromEnv(),
  );
  process.stdout.write(`${formatEconomyPricingRelease(result)}\n`);
}

void main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
