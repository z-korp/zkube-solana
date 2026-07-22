import {
  formatLaunchRunnerResult,
  runLaunchFromEnv,
} from "../../src/chain/launchRunner";

async function main(): Promise<void> {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    process.stdout.write(
      [
        "zKube Devnet launch runner",
        "",
        "Plan mode is the default and never loads a signer.",
        "Stage after exact approval:",
        "  ZKUBE_LAUNCH_MODE=stage",
        "  ZKUBE_LAUNCH_APPROVAL=<printed 64-hex fingerprint>",
        "  ZKUBE_DEPLOYER_KEYPAIR=<pinned Devnet deployer path>",
        "  ZKUBE_PROTOCOL_AUTHORITY_KEYPAIR=<pinned authority path>",
        "",
        "Resume an interrupted paused staging pass with the same variables:",
        "  ZKUBE_LAUNCH_MODE=resume",
        "",
        "Activate only after Fly reports staged_launch_ready:",
        "  ZKUBE_LAUNCH_MODE=activate",
        "  ZKUBE_LAUNCH_APPROVAL=<same approved fingerprint>",
        "  ZKUBE_KEEPER_STAGED_RELEASE_FINGERPRINT=<approved keeper fingerprint>",
        "  ZKUBE_PROTOCOL_AUTHORITY_KEYPAIR=<pinned authority path>",
        "",
        "All modes require the same public inputs as chain:devnet:launch-plan.",
        "The default public bundle path is /tmp/zkube-v4-launch-20656.json.",
        "A signed receipt is persisted before submission. Resume verifies exact",
        "approved bytes and chain status before relaying or re-signing anything.",
        "",
      ].join("\n"),
    );
    return;
  }
  const result = await runLaunchFromEnv();
  process.stdout.write(`${formatLaunchRunnerResult(result)}\n`);
}

void main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
