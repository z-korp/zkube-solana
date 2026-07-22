import {
  buildZkubeLaunchPlan,
  formatZkubeLaunchPlan,
  launchPlannerInputFromEnv,
} from "../../src/chain/launchPlanner";

async function main(): Promise<void> {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    process.stdout.write(
      [
        "zKube read-only paused bootstrap and launch planner",
        "",
        "Required public release inputs:",
        "  ZKUBE_CLUSTER=devnet",
        "  VITE_PUBLIC_SOLANA_RPC_ENDPOINT=<HTTPS Devnet RPC>",
        "  VITE_PUBLIC_SOLANA_EXPECTED_GENESIS_HASH=<Devnet genesis>",
        "  ZKUBE_PROTOCOL_AUTHORITY=<authority address>",
        "  ZKUBE_TEAM_DESTINATION=<System-owned recipient>",
        "  ZKUBE_REPLAY_DOMAIN_HEX=<64 lowercase hex>",
        "  ZKUBE_LAUNCH_DAY_ID=<explicit UTC day>",
        "  ZKUBE_LAUNCH_CUTOFF_UNIX=<inside that day's entry window>",
        "  ZKUBE_DEPLOYED_PROGRAM_DATA_SHA256=<64 lowercase hex>",
        "  ZKUBE_PROGRAM_ALLOCATION_BYTES=<exact live allocation>",
        "  ZKUBE_PROGRAM_UPGRADE_AUTHORITY=<exact live authority address>",
        "  ZKUBE_KEEPER_RELEASE_FINGERPRINT=<64 lowercase hex>",
        "",
        "Optional:",
        "  ZKUBE_LAUNCH_AUTHORITY_RESERVE_LAMPORTS=100000000",
        "",
        "The planner reads Devnet, requires fresh paused bootstrap targets,",
        "derives current/following cadence PDAs, calculates live rent and fees,",
        "and prints an exact approval fingerprint. It accepts no keypair and",
        "has no sign or send path. The final manifest is generated afterward",
        "and binds this plan fingerprint, avoiding a circular hash dependency.",
        "",
      ].join("\n"),
    );
    return;
  }
  const plan = await buildZkubeLaunchPlan(launchPlannerInputFromEnv());
  process.stdout.write(`${formatZkubeLaunchPlan(plan)}\n`);
}

void main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
