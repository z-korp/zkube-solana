import { Connection } from "@solana/web3.js";
import { ZKUBE_PROGRAM_ID } from "../../src/solana/constants";
import {
  evaluateOperationalReadiness,
  fetchDailyOperationalSnapshots,
} from "../../src/solana/reboot/monitoring";
import { evaluateTreasuryReadiness } from "../../src/solana/reboot/readiness";
import { fetchTreasuryView } from "../../src/solana/reboot/treasuryClient";

interface Options {
  rpc: string;
  expectedGenesis: string | null;
  lookbackDays: number;
  minPaymasterLamports: bigint | null;
  claimWarningSeconds: number;
}

async function main(): Promise<void> {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    process.stdout.write([
      "Usage: pnpm chain:readiness -- --rpc <URL> [options]",
      "",
      "Options:",
      "  --expected-genesis <HASH|none>        Required for non-local RPCs",
      "  --lookback-days <1..366>              Daily account window (default: 120)",
      "  --min-paymaster-lamports <u64>        Optional low-SOL warning threshold",
      "  --claim-warning-hours <0..2160>       Claim deadline warning (default: 72)",
      "",
      "Environment fallback:",
      "  ZKUBE_READ_RPC_URL",
      "  ZKUBE_EXPECTED_GENESIS_HASH",
      "  ZKUBE_LOOKBACK_DAYS",
      "  ZKUBE_MIN_PAYMASTER_LAMPORTS",
      "  ZKUBE_CLAIM_WARNING_HOURS",
      "",
      "Read-only: no signer, simulation, or transaction path exists.",
      "",
    ].join("\n"));
    return;
  }
  const options = parseOptions(process.argv.slice(2), process.env);
  const connection = new Connection(options.rpc, "confirmed");
  const genesisHash = await connection.getGenesisHash();
  if (options.expectedGenesis !== null && genesisHash !== options.expectedGenesis) {
    throw new Error("RPC genesis hash does not match --expected-genesis");
  }
  const programInfo = await connection.getAccountInfo(ZKUBE_PROGRAM_ID, "confirmed");
  if (!programInfo?.executable) throw new Error("configured zKube program is missing or not executable");
  const treasury = await fetchTreasuryView(connection);
  if (!treasury) throw new Error("zKube protocol, treasury ledger, or yield policy is not initialized");
  const readiness = evaluateTreasuryReadiness(treasury);
  const nowUnix = Math.floor(Date.now() / 1_000);
  const [paymasterLamports, daily] = await Promise.all([
    connection.getBalance(treasury.paymaster, "confirmed"),
    fetchDailyOperationalSnapshots({
      connection,
      treasury,
      nowUnix,
      lookbackDays: options.lookbackDays,
    }),
  ]);
  if (!Number.isSafeInteger(paymasterLamports) || paymasterLamports < 0) {
    throw new Error("paymaster SOL balance is not a safe integer");
  }
  const operations = evaluateOperationalReadiness({
    nowUnix,
    paymasterSolLamports: BigInt(paymasterLamports),
    daily,
    thresholds: {
      minPaymasterLamports: options.minPaymasterLamports,
      claimWarningSeconds: options.claimWarningSeconds,
    },
  });
  const report = {
    generatedAt: new Date().toISOString(),
    rpc: sanitizedEndpoint(options.rpc),
    genesisHash,
    programId: ZKUBE_PROGRAM_ID.toBase58(),
    protocol: {
      authority: treasury.authority.toBase58(),
      pendingAuthority: treasury.pendingAuthority.toBase58(),
      paymaster: treasury.paymaster.toBase58(),
      paused: treasury.paused,
    },
    readiness,
    operations,
  };
  process.stdout.write(`${JSON.stringify(report, bigintJson, 2)}\n`);
  if (!readiness.ok || !operations.ok) process.exitCode = 2;
  else if ([...readiness.alerts, ...operations.alerts]
    .some((entry) => entry.severity === "warning")) process.exitCode = 1;
}

export function parseOptions(
  argv: string[],
  env: Record<string, string | undefined>,
): Options {
  const rpc = option(argv, "--rpc") ?? env.ZKUBE_READ_RPC_URL;
  if (!rpc) throw new Error("--rpc or ZKUBE_READ_RPC_URL is required");
  const parsed = new URL(rpc);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !(local && parsed.protocol === "http:")) {
    throw new Error("RPC must use HTTPS except for localhost");
  }
  const rawExpected = option(argv, "--expected-genesis") ?? env.ZKUBE_EXPECTED_GENESIS_HASH;
  if (!rawExpected && !local) {
    throw new Error("--expected-genesis is required for non-local RPCs");
  }
  const expectedGenesis = !rawExpected || rawExpected === "none" ? null : rawExpected;
  const lookbackDays = boundedInteger(
    option(argv, "--lookback-days") ?? env.ZKUBE_LOOKBACK_DAYS ?? "120",
    1,
    366,
    "--lookback-days",
  );
  const claimWarningHours = boundedInteger(
    option(argv, "--claim-warning-hours") ?? env.ZKUBE_CLAIM_WARNING_HOURS ?? "72",
    0,
    2_160,
    "--claim-warning-hours",
  );
  const rawMinimum = option(argv, "--min-paymaster-lamports")
    ?? env.ZKUBE_MIN_PAYMASTER_LAMPORTS;
  const minPaymasterLamports = rawMinimum === undefined
    ? null
    : boundedU64(rawMinimum, "--min-paymaster-lamports");
  return {
    rpc: parsed.toString(),
    expectedGenesis,
    lookbackDays,
    minPaymasterLamports,
    claimWarningSeconds: claimWarningHours * 3_600,
  };
}

function option(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function boundedInteger(value: string, minimum: number, maximum: number, label: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`${label} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function boundedU64(value: string, label: string): bigint {
  if (!/^\d+$/.test(value)) throw new Error(`${label} must be an unsigned integer`);
  const parsed = BigInt(value);
  if (parsed > (1n << 64n) - 1n) throw new Error(`${label} exceeds u64`);
  return parsed;
}

function sanitizedEndpoint(value: string): string {
  const endpoint = new URL(value);
  endpoint.username = "";
  endpoint.password = "";
  endpoint.search = "";
  endpoint.hash = "";
  return endpoint.toString();
}

function bigintJson(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
});
