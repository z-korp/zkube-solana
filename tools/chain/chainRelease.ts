import { createHash } from "node:crypto";
import { BorshAccountsCoder, convertIdlToCamelCase } from "@anchor-lang/core";
import { Connection, PublicKey } from "@solana/web3.js";
import { IDL } from "./idl/index.js";
import { SOLANA_DEVNET_GENESIS_HASH, ZKUBE_PROGRAM_ID } from "../../shared/chain.js";
import { PROTOCOL_ACCOUNT_VERSION } from "../../services/src/protocolVersions.generated.js";

export const UPGRADEABLE_LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
export const PROGRAM_DATA_HEADER_BYTES = 45;
export const OPERATOR_RESERVE_LAMPORTS = 100_000_000;
export const programDataAddress = (): PublicKey => PublicKey.findProgramAddressSync(
  [ZKUBE_PROGRAM_ID.toBuffer()], UPGRADEABLE_LOADER)[0];
export const accountCoder = new BorshAccountsCoder(convertIdlToCamelCase(IDL));

export interface ReleaseBinding {
  rpc: string;
  programDataSha256: string;
  allocationBytes: number;
  upgradeAuthority: string;
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function requireHash(value: string, name: string): string {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(`${name} must be a SHA-256 hash`);
  return value;
}

export function requireInteger(value: number, name: string, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new Error(`${name} is out of range`);
  return value;
}

export function devnetEndpoint(rpc: string): string {
  const url = new URL(rpc);
  if (url.protocol !== "https:" || /mainnet|localhost|127\.0\.0\.1|localnet/i.test(rpc)) {
    throw new Error("Operator commands require an HTTPS Devnet endpoint");
  }
  return url.toString().replace(/\/$/, "");
}

/** How many times one call is retried after the endpoint answers 429. */
export const RATE_LIMIT_RETRIES = 8;

/**
 * A shared Devnet endpoint answers 429 Too Many Requests when it is busy, and
 * a deployment makes thousands of calls. One such answer must not end the run:
 * the call waits (the endpoint's Retry-After, else a backoff doubling from one
 * second to thirty) and is made again, at most RATE_LIMIT_RETRIES times. Every
 * call goes through here, so a resent transaction is the same signed bytes and
 * the same signature; nothing is re-signed.
 */
export function rateLimitedFetch(
  base: typeof fetch = fetch,
  sleep: (milliseconds: number) => Promise<void> = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds)),
): typeof fetch {
  return async (input, init) => {
    for (let attempt = 0; ; attempt++) {
      const response = await base(input, init);
      if (response.status !== 429 || attempt === RATE_LIMIT_RETRIES) return response;
      const after = Number(response.headers.get("retry-after"));
      await sleep(Number.isFinite(after) && after > 0 ? Math.min(after, 60) * 1_000 : Math.min(1_000 * 2 ** attempt, 30_000));
    }
  };
}

export function devnetConnection(rpc: string, transport: typeof fetch = rateLimitedFetch()): Connection {
  return new Connection(devnetEndpoint(rpc), { commitment: "confirmed", fetch: transport, disableRetryOnRateLimit: true });
}

export async function assertDevnetRelease(connection: Connection, release: ReleaseBinding,
  initialDeployment = false,
): Promise<void> {
  requireHash(release.programDataSha256, "ProgramData hash");
  requireInteger(release.allocationBytes, "ProgramData allocation");
  new PublicKey(release.upgradeAuthority);
  if (await connection.getGenesisHash() !== SOLANA_DEVNET_GENESIS_HASH) {
    throw new Error("Operator commands require the Devnet genesis");
  }
  const [program, data] = await connection.getMultipleAccountsInfo(
    [ZKUBE_PROGRAM_ID, programDataAddress()], "confirmed");
  if (initialDeployment && !program && !data) return;
  if (!program || !data || !program.owner.equals(UPGRADEABLE_LOADER) || !program.executable ||
      program.data.length !== 36 || program.data.readUInt32LE(0) !== 2 ||
      !new PublicKey(program.data.subarray(4, 36)).equals(programDataAddress()) ||
      !data.owner.equals(UPGRADEABLE_LOADER) || data.executable ||
      data.data.length !== PROGRAM_DATA_HEADER_BYTES + release.allocationBytes ||
      data.data.readUInt32LE(0) !== 3 || data.data[12] !== 1 ||
      new PublicKey(data.data.subarray(13, 45)).toBase58() !== release.upgradeAuthority ||
      sha256(data.data.subarray(PROGRAM_DATA_HEADER_BYTES)) !== release.programDataSha256) {
    throw new Error("ProgramData identity, bytes, allocation or authority differs from the release");
  }
}

export async function readAccount(connection: Connection, name: string, address: PublicKey) {
  const info = await connection.getAccountInfo(address, "confirmed");
  if (!info || info.executable || !info.owner.equals(ZKUBE_PROGRAM_ID) ||
      info.data.length !== accountCoder.size(name)) {
    throw new Error(`${name} owner or size is invalid`);
  }
  const value = accountCoder.decode(name, info.data);
  if (value.version !== PROTOCOL_ACCOUNT_VERSION) throw new Error(`${name} version is invalid`);
  return { info, value };
}

export async function chainTime(connection: Connection): Promise<number> {
  const timestamp = await connection.getBlockTime(await connection.getSlot("confirmed"));
  if (timestamp === null) throw new Error("Devnet clock is unavailable");
  return requireInteger(timestamp, "Devnet clock");
}
