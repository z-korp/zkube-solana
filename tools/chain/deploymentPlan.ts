import { readFileSync } from "node:fs";
import {
  PublicKey, SystemProgram, SYSVAR_CLOCK_PUBKEY, SYSVAR_RENT_PUBKEY,
  Transaction, TransactionInstruction,
} from "@solana/web3.js";
import { ZKUBE_PROGRAM_ID } from "../../shared/chain.js";
import { PROGRAM_DATA_HEADER_BYTES, UPGRADEABLE_LOADER, programDataAddress,
  requireInteger, sha256 } from "./chainRelease.js";

export const DEPLOYMENT_WRITE_BYTES = 512;
export const DEPLOYMENT_HEADROOM_BYTES = 10_240;
export interface DeploymentInput {
  artifactPath: string;
  artifactSha256: string;
  artifactBytes: number;
  payer: string;
  buffer: string;
  authority: string;
  bufferRentLamports: number;
  programRentLamports: number;
  programDataRentLamports: number;
}
export interface PlannedTransaction { label: string; payer: PublicKey; transaction: Transaction; spend: number }

export function frozenArtifact(input: Pick<DeploymentInput, "artifactPath" | "artifactSha256" | "artifactBytes">): Buffer {
  const bytes = readFileSync(input.artifactPath);
  if (bytes.length !== input.artifactBytes || sha256(bytes) !== input.artifactSha256 ||
      bytes.length < 4 || !bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
    throw new Error("Frozen SBF artifact differs from the approved bytes");
  }
  return bytes;
}

export function deploymentRelease(input: DeploymentInput, rpc: string) {
  const bytes = frozenArtifact(input);
  const allocationBytes = bytes.length + DEPLOYMENT_HEADROOM_BYTES;
  return { rpc, allocationBytes, upgradeAuthority: input.authority,
    programDataSha256: sha256(Buffer.concat([bytes, Buffer.alloc(DEPLOYMENT_HEADROOM_BYTES)])) };
}

const account = (pubkey: PublicKey, isWritable: boolean, isSigner = false) => ({ pubkey, isWritable, isSigner });
const loader = (data: Buffer, keys: TransactionInstruction["keys"]) =>
  new TransactionInstruction({ programId: UPGRADEABLE_LOADER, data, keys });

/** A buffer holding the artifact: created and initialized, then written 512 bytes at a time. */
function bufferTransactions(artifact: Buffer, payer: PublicKey, buffer: PublicKey, authority: PublicKey,
  bufferRentLamports: number): PlannedTransaction[] {
  const plans: PlannedTransaction[] = [{ label: "Create and initialize program buffer", payer,
    spend: bufferRentLamports,
    transaction: new Transaction().add(SystemProgram.createAccount({ fromPubkey: payer,
      newAccountPubkey: buffer, lamports: bufferRentLamports, space: 37 + artifact.length,
      programId: UPGRADEABLE_LOADER }), loader(Buffer.alloc(4), [account(buffer, true), account(authority, false)])) }];
  for (let offset = 0; offset < artifact.length; offset += DEPLOYMENT_WRITE_BYTES) {
    const bytes = artifact.subarray(offset, offset + DEPLOYMENT_WRITE_BYTES);
    const data = Buffer.alloc(16 + bytes.length);
    data.writeUInt32LE(1); data.writeUInt32LE(offset, 4); data.writeBigUInt64LE(BigInt(bytes.length), 8);
    bytes.copy(data, 16);
    plans.push({ label: `Write program bytes ${offset}..${offset + bytes.length}`, payer, spend: 0,
      transaction: new Transaction().add(loader(data, [account(buffer, true), account(authority, false, true)])) });
  }
  return plans;
}

/** Encodings and account order follow the loader's InitializeBuffer, Write and DeployWithMaxDataLen instructions. */
export function deploymentTransactions(input: DeploymentInput): PlannedTransaction[] {
  const artifact = frozenArtifact(input);
  for (const [name, value] of Object.entries({ bufferRent: input.bufferRentLamports,
    programRent: input.programRentLamports, programDataRent: input.programDataRentLamports })) {
    requireInteger(value, name);
  }
  const payer = new PublicKey(input.payer), buffer = new PublicKey(input.buffer), authority = new PublicKey(input.authority);
  const plans = bufferTransactions(artifact, payer, buffer, authority, input.bufferRentLamports);
  const data = Buffer.alloc(12);
  data.writeUInt32LE(2); data.writeBigUInt64LE(BigInt(artifact.length + DEPLOYMENT_HEADROOM_BYTES), 4);
  plans.push({ label: "Deploy frozen program", payer,
    spend: requireInteger(input.programRentLamports + input.programDataRentLamports, "deployment rent"),
    transaction: new Transaction().add(SystemProgram.createAccount({ fromPubkey: payer,
      newAccountPubkey: ZKUBE_PROGRAM_ID, lamports: input.programRentLamports, space: 36,
      programId: UPGRADEABLE_LOADER }), loader(data, [account(payer, true, true), account(programDataAddress(), true),
      account(ZKUBE_PROGRAM_ID, true), account(buffer, true), account(SYSVAR_RENT_PUBKEY, false),
      account(SYSVAR_CLOCK_PUBKEY, false), account(SystemProgram.programId, false), account(authority, false, true)])) });
  return plans;
}

/**
 * An upgrade in place of the deployed program: the same program address, the
 * same ProgramData and upgrade authority, new bytes. `deployed` is what it
 * replaces, as read when it was planned; nothing else may be upgraded.
 */
export interface UpgradeInput {
  artifactPath: string;
  artifactSha256: string;
  artifactBytes: number;
  payer: string;
  buffer: string;
  authority: string;
  bufferRentLamports: number;
  deployed: { programDataSha256: string; allocationBytes: number };
}

/** What ProgramData holds once the upgrade has landed: the artifact, then zeros to the allocation it keeps. */
export function upgradeRelease(input: UpgradeInput, rpc: string) {
  const bytes = frozenArtifact(input);
  const allocationBytes = requireInteger(input.deployed.allocationBytes, "ProgramData allocation");
  if (bytes.length > allocationBytes) {
    throw new Error(`Program needs ${bytes.length - allocationBytes} more bytes than its ProgramData holds; extend it first`);
  }
  return { rpc, allocationBytes, upgradeAuthority: input.authority,
    programDataSha256: sha256(Buffer.concat([bytes, Buffer.alloc(allocationBytes - bytes.length)])) };
}

/** The buffer as for a deployment, then the loader's Upgrade, which returns the buffer's lamports to the payer. */
export function upgradeTransactions(input: UpgradeInput): PlannedTransaction[] {
  const artifact = frozenArtifact(input);
  requireInteger(input.bufferRentLamports, "bufferRent");
  const payer = new PublicKey(input.payer), buffer = new PublicKey(input.buffer), authority = new PublicKey(input.authority);
  const plans = bufferTransactions(artifact, payer, buffer, authority, input.bufferRentLamports);
  const data = Buffer.alloc(4); data.writeUInt32LE(3);
  plans.push({ label: "Upgrade the program in place", payer, spend: 0,
    transaction: new Transaction().add(loader(data, [account(programDataAddress(), true), account(ZKUBE_PROGRAM_ID, true),
      account(buffer, true), account(payer, true), account(SYSVAR_RENT_PUBKEY, false),
      account(SYSVAR_CLOCK_PUBKEY, false), account(authority, false, true)])) });
  return plans;
}

export function deploymentRentSpaces(artifactBytes: number): number[] {
  return [37 + artifactBytes, 36, PROGRAM_DATA_HEADER_BYTES + artifactBytes + DEPLOYMENT_HEADROOM_BYTES];
}
