import {
  formatProgramExtension,
  programExtensionInputFromEnv,
  runProgramExtension,
} from "../../src/chain/programExtension";

async function main(): Promise<void> {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    process.stdout.write(
      [
        "zKube Devnet ProgramData extension planner",
        "",
        "Required for an executable extension preview:",
        "  ZKUBE_DEPLOYER_KEYPAIR=<funded Devnet payer path>",
        "For a public, non-executable preview:",
        "  ZKUBE_EXTENSION_PAYER_PUBLIC_KEY=<funded Devnet payer address>",
        "",
        "The current Devnet feature set uses legacy ExtendProgram: the payer is",
        "the only signer and the deployed upgrade authority is preserved.",
        "",
        "Dry-run is the default. Sending additionally requires both:",
        "  ZKUBE_EXTEND_PROGRAM=1",
        "  ZKUBE_EXTEND_APPROVAL=<printed fingerprint>",
        "",
        "The extension and subsequent program upgrade require separate approvals.",
        "Devnet only. Mainnet and localhost are rejected.",
        "",
      ].join("\n"),
    );
    return;
  }
  const input = await programExtensionInputFromEnv();
  const result = await runProgramExtension(input);
  process.stdout.write(`${formatProgramExtension(result)}\n`);
}

void main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
