import {
  formatPrizeTopUpResult,
  parsePrizeTopUpCliArgs,
  runPrizeTopUpCommand,
} from "../../src/chain/prizeTopUpRunner";

function help(): string {
  return [
    "zKube Devnet manual prize-pool top-up",
    "",
    "Plan and simulate without loading a signer:",
    "  NO_DNA=1 pnpm chain:devnet:top-up -- plan \\",
    "    --top-up daily:current:1SOL \\",
    "    --top-up weekly:current:3SOL",
    "",
    "Amounts must use an explicit SOL or lamports suffix. Cadence may be",
    "current, following, or an exact numeric cadence ID. Multiple top-ups",
    "are combined into one atomic transaction.",
    "",
    "Execute only after the printed bundle receives exact approval:",
    "  ZKUBE_PRIZE_TOP_UP_APPROVAL=<printed 64-hex fingerprint> \\",
    "  ZKUBE_PROTOCOL_AUTHORITY_KEYPAIR=<pinned authority path> \\",
    "  NO_DNA=1 pnpm chain:devnet:top-up -- execute --bundle <printed bundle path>",
    "",
    "Optional plan flags:",
    "  --bundle <fresh public bundle path>",
    "  --manifest <approved Devnet deployment manifest>",
    "  --rpc <HTTPS Devnet RPC>",
    "  --reserve-lamports <post-transaction authority reserve>",
    "",
    "The command validates Devnet genesis, ProgramData, the protocol authority,",
    "canonical current/following PDAs, account owner/size/discriminator and",
    "ledger custody. It refuses Mainnet. Execution persists the signed receipt",
    "before relay and verifies the exact seeded balances after confirmation.",
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    process.stdout.write(help());
    return;
  }
  const options = parsePrizeTopUpCliArgs(process.argv.slice(2));
  const result = await runPrizeTopUpCommand(options);
  process.stdout.write(`${formatPrizeTopUpResult(result)}\n`);
}

void main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
