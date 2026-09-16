import { runSuspension } from "./suspensionRunner.js";

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log([
      "zKube Devnet suspension: set-suspension [plan|execute]",
      "Plan requires SOLANA_DEVNET_RPC_URL, ZKUBE_PROTOCOL_AUTHORITY,",
      "ZKUBE_DEPLOYED_SBF_SHA256 and ZKUBE_SUSPENSION_UNTIL_DAY.",
      "ZKUBE_SUSPENSION_BUNDLE selects the public bundle under build/.",
      "Execute requires ZKUBE_APPROVAL=<printed fingerprint> and",
      "ZKUBE_PROTOCOL_AUTHORITY_KEYPAIR. No signer loads before approval.",
    ].join("\n"));
    return;
  }
  console.log(JSON.stringify(await runSuspension(process.argv[2] ?? "plan", process.env), null, 2));
}

void main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
