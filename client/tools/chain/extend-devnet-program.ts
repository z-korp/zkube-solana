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
        "The extension and subsequent upgrade remain separately fingerprinted operations,",
        "but one exact release-bundle approval may authorize both.",
        "To approve both writes once as a release bundle, first run this dry-run,",
        "then plan the deployment with ZKUBE_EXPECTED_CURRENT_SBF_SHA256 set to",
        "the printed post-extension hash. Present both fingerprints together;",
        "the extension runner will still stop the bundle if live state drifts.",
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
