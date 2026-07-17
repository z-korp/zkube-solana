import {
  PublicKey,
  SystemProgram,
  Transaction,
  type AccountInfo,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";

import { ZKUBE_PROGRAM_ID } from "./constants.js";
import {
  derivePlayerFundingPda,
  derivePlayerLabelPda,
  derivePlayerStatePda,
  deriveProtocolConfigPda,
} from "./pdas.js";
import { zkubeProgram, type TransactionPlan } from "./runPlan.js";
import type { WalletLike } from "./sessionWallet.js";

const PLAYER_LABEL_CACHE_MS = 60_000;
const labelCache = new Map<
  string,
  { label: PlayerLabelView | null; expiresAt: number }
>();

export interface PlayerLabelView {
  address: PublicKey;
  owner: PublicKey;
  displayName: string;
}

interface RawPlayerLabel {
  version: number;
  owner: PublicKey;
  displayName: number[];
  nameLen: number;
  bump: number;
}

export function validatePlayerLabel(displayName: string): string {
  if (!/^[A-Za-z][A-Za-z0-9_]{2,15}$/.test(displayName)) {
    throw new Error(
      "Player label must be 3-16 characters, start with a letter, and use only letters, numbers, or underscore",
    );
  }
  return displayName;
}

export async function fetchPlayerLabel(args: {
  connection: Connection;
  wallet: WalletLike;
  owner: PublicKey;
}): Promise<PlayerLabelView | null> {
  const labels = await fetchPlayerLabels({
    connection: args.connection,
    wallet: args.wallet,
    owners: [args.owner],
  });
  return labels[0] ?? null;
}

export async function fetchPlayerLabels(args: {
  connection: Connection;
  wallet: WalletLike;
  owners: readonly PublicKey[];
}): Promise<PlayerLabelView[]> {
  const program = zkubeProgram(args.connection, args.wallet);
  const uniqueOwners = uniquePublicKeys(args.owners);
  if (uniqueOwners.length === 0) return [];
  const now = Date.now();
  const labels: PlayerLabelView[] = [];
  const ownersToFetch = uniqueOwners.filter((owner) => {
    const entry = labelCache.get(labelCacheKey(args.connection, owner));
    if (!entry || entry.expiresAt <= now) return true;
    if (entry.label) labels.push(entry.label);
    return false;
  });
  if (ownersToFetch.length === 0) return labels;

  const addresses = ownersToFetch.map((owner) => derivePlayerLabelPda(owner));
  const infos = await args.connection.getMultipleAccountsInfo(
    addresses,
    "confirmed",
  );
  for (let index = 0; index < ownersToFetch.length; index += 1) {
    const owner = ownersToFetch[index]!;
    const info = infos[index];
    let label: PlayerLabelView | null = null;
    if (info) {
      try {
        label = decodePlayerLabel(program, addresses[index]!, owner, info);
        labels.push(label);
      } catch {
        // Optional metadata never overrides or weakens the wallet identity.
      }
    }
    labelCache.set(labelCacheKey(args.connection, owner), {
      label,
      expiresAt: Date.now() + PLAYER_LABEL_CACHE_MS,
    });
  }
  return labels;
}

export function invalidatePlayerLabel(owner: PublicKey): void {
  const suffix = `:${owner.toBase58()}`;
  for (const key of labelCache.keys()) {
    if (key.endsWith(suffix)) labelCache.delete(key);
  }
}

export async function buildFundedCreatePlayerLabelPlan(args: {
  connection: Connection;
  wallet: WalletLike;
  ownerAuthority: PublicKey;
  sessionToken: PublicKey;
  displayName: string;
}): Promise<TransactionPlan> {
  const display = validatePlayerLabel(args.displayName);
  const actor = args.wallet.publicKey;
  const instruction = await zkubeProgram(args.connection, args.wallet)
    .methods.fundedCreatePlayerLabel({ display })
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      playerState: derivePlayerStatePda(args.ownerAuthority),
      playerLabel: derivePlayerLabelPda(args.ownerAuthority),
      playerFunding: derivePlayerFundingPda(args.ownerAuthority),
      ownerAuthority: args.ownerAuthority,
      sessionToken: args.sessionToken,
      actor,
      systemProgram: SystemProgram.programId,
      zkubeProgram: ZKUBE_PROGRAM_ID,
    })
    .instruction();
  return plan(
    "Create cosmetic player label",
    args.connection,
    actor,
    instruction,
  );
}

export async function buildSetPlayerLabelPlan(args: {
  connection: Connection;
  wallet: WalletLike;
  ownerAuthority: PublicKey;
  sessionToken: PublicKey;
  displayName: string;
}): Promise<TransactionPlan> {
  const display = validatePlayerLabel(args.displayName);
  const actor = args.wallet.publicKey;
  const instruction = await zkubeProgram(args.connection, args.wallet)
    .methods.setPlayerLabel({ display })
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      playerState: derivePlayerStatePda(args.ownerAuthority),
      playerLabel: derivePlayerLabelPda(args.ownerAuthority),
      ownerAuthority: args.ownerAuthority,
      sessionToken: args.sessionToken,
      actor,
    })
    .instruction();
  return plan(
    "Update cosmetic player label",
    args.connection,
    actor,
    instruction,
  );
}

function decodePlayerLabel(
  program: ReturnType<typeof zkubeProgram>,
  address: PublicKey,
  expectedOwner: PublicKey,
  info: AccountInfo<Buffer>,
): PlayerLabelView {
  assertProgramAccount(info, program.account.playerLabel.size, "PlayerLabel");
  const raw = program.coder.accounts.decode(
    "playerLabel",
    info.data,
  ) as unknown as RawPlayerLabel;
  const displayName = decodeFixedAscii(raw.displayName, Number(raw.nameLen));
  if (
    Number(raw.version) !== 1 ||
    !raw.owner.equals(expectedOwner) ||
    !address.equals(derivePlayerLabelPda(expectedOwner)) ||
    validatePlayerLabel(displayName) !== displayName
  ) {
    throw new Error("PlayerLabel relationship is invalid");
  }
  return { address, owner: raw.owner, displayName };
}

function decodeFixedAscii(value: readonly number[], length: number): string {
  if (
    !Number.isInteger(length) ||
    length < 3 ||
    length > 16 ||
    value.length !== 16
  ) {
    throw new Error("PlayerLabel account length is invalid");
  }
  if (value.slice(length).some((byte) => byte !== 0)) {
    throw new Error("PlayerLabel account padding is invalid");
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(
    Uint8Array.from(value.slice(0, length)),
  );
}

function assertProgramAccount(
  info: AccountInfo<Buffer>,
  expectedSize: number,
  label: string,
): void {
  if (
    !info.owner.equals(ZKUBE_PROGRAM_ID) ||
    info.executable ||
    info.data.length !== expectedSize
  ) {
    throw new Error(`${label} account is invalid`);
  }
}

function uniquePublicKeys(values: readonly PublicKey[]): PublicKey[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toBase58();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function labelCacheKey(connection: Connection, owner: PublicKey): string {
  return `${connection.rpcEndpoint}:${owner.toBase58()}`;
}

function plan(
  label: string,
  connection: Connection,
  feePayer: PublicKey,
  instruction: TransactionInstruction,
): TransactionPlan {
  return {
    layer: "solana-base",
    label,
    connection,
    transaction: new Transaction().add(instruction),
    feePayer,
    signers: [],
  };
}
