import {
  PublicKey,
  SystemProgram,
  Transaction,
  type AccountInfo,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";

import { ZKUBE_PROGRAM_ID } from "./constants";
import {
  derivePlayerIdentityPda,
  derivePlayerStatePda,
  deriveProtocolConfigPda,
  deriveUsernameClaimPda,
} from "./pdas";
import { zkubeProgram, type TransactionPlan } from "./runPlan";
import type { WalletLike } from "./sessionWallet";

export const USERNAME_RENAME_STARS = 100n;
export const USERNAME_RENAME_COOLDOWN_SECONDS = 30 * 86_400;
const IDENTITY_CACHE_MS = 60_000;
const identityCache = new Map<
  string,
  { identity: PlayerIdentityView; expiresAt: number }
>();

export interface PlayerIdentityView {
  address: PublicKey;
  owner: PublicKey;
  displayName: string;
  normalizedName: string;
  renameCount: number;
  registeredAt: number;
  lastRenamedAt: number;
  moderated: boolean;
  moderationReason: number;
}

interface RawPlayerIdentity {
  version: number;
  owner: PublicKey;
  displayName: number[];
  normalizedName: number[];
  nameLen: number;
  renameCount: number;
  registeredAt: { toString(): string };
  lastRenamedAt: { toString(): string };
  moderated: boolean;
  moderationReason: number;
  bump: number;
}

interface RawUsernameClaim {
  version: number;
  owner: PublicKey;
  playerIdentity: PublicKey;
  normalizedName: number[];
  nameLen: number;
  status: number;
  bump: number;
}

export function normalizeUsername(displayName: string): string {
  if (!/^[A-Za-z][A-Za-z0-9_]{2,15}$/.test(displayName)) {
    throw new Error(
      "Username must be 3-16 characters, start with a letter, and use only letters, numbers, or underscore",
    );
  }
  return displayName.toLowerCase();
}

export async function fetchPlayerIdentity(args: {
  connection: Connection;
  wallet: WalletLike;
  owner: PublicKey;
}): Promise<PlayerIdentityView | null> {
  const [entry] = await fetchPlayerIdentities({
    connection: args.connection,
    wallet: args.wallet,
    owners: [args.owner],
    includeModerated: true,
  });
  return entry ?? null;
}

export async function fetchPlayerIdentities(args: {
  connection: Connection;
  wallet: WalletLike;
  owners: readonly PublicKey[];
  includeModerated?: boolean;
}): Promise<PlayerIdentityView[]> {
  const program = zkubeProgram(args.connection, args.wallet);
  const uniqueOwners = uniquePublicKeys(args.owners);
  if (uniqueOwners.length === 0) return [];
  const now = Date.now();
  const cached: PlayerIdentityView[] = [];
  const ownersToFetch = uniqueOwners.filter((owner) => {
    const entry = identityCache.get(identityCacheKey(args.connection, owner));
    if (!entry || entry.expiresAt <= now) return true;
    cached.push(entry.identity);
    return false;
  });
  if (ownersToFetch.length === 0) {
    return cached.filter(
      (identity) => args.includeModerated || !identity.moderated,
    );
  }
  const identityAddresses = ownersToFetch.map((owner) =>
    derivePlayerIdentityPda(owner),
  );
  const identityInfos = await args.connection.getMultipleAccountsInfo(
    identityAddresses,
    "confirmed",
  );
  const candidates: PlayerIdentityView[] = [];
  for (let index = 0; index < ownersToFetch.length; index += 1) {
    const info = identityInfos[index];
    if (!info) continue;
    try {
      candidates.push(
        decodeIdentity(
          program,
          identityAddresses[index]!,
          ownersToFetch[index]!,
          info,
        ),
      );
    } catch {
      // Invalid optional metadata never overrides the authoritative wallet.
    }
  }
  if (candidates.length === 0) {
    return cached.filter(
      (identity) => args.includeModerated || !identity.moderated,
    );
  }
  const claimAddresses = candidates.map((identity) =>
    deriveUsernameClaimPda(identity.normalizedName),
  );
  const claimInfos = await args.connection.getMultipleAccountsInfo(
    claimAddresses,
    "confirmed",
  );
  const fresh = candidates.filter((identity, index) => {
    const info = claimInfos[index];
    if (!info) return false;
    try {
      const claim = decodeClaim(
        program,
        claimAddresses[index]!,
        identity,
        info,
      );
      if (identity.moderated !== (claim.status === 1)) return false;
      identityCache.set(identityCacheKey(args.connection, identity.owner), {
        identity,
        expiresAt: Date.now() + IDENTITY_CACHE_MS,
      });
      return true;
    } catch {
      return false;
    }
  });
  return [...cached, ...fresh].filter(
    (identity) => args.includeModerated || !identity.moderated,
  );
}

export function invalidatePlayerIdentity(owner: PublicKey): void {
  const suffix = `:${owner.toBase58()}`;
  for (const key of identityCache.keys()) {
    if (key.endsWith(suffix)) identityCache.delete(key);
  }
}

export async function buildRegisterUsernamePlan(args: {
  connection: Connection;
  wallet: WalletLike;
  displayName: string;
}): Promise<TransactionPlan> {
  const normalized = normalizeUsername(args.displayName);
  await requireUsernameAvailable(args.connection, normalized);
  const owner = args.wallet.publicKey;
  const instruction = await zkubeProgram(args.connection, args.wallet)
    .methods.registerUsername({ display: args.displayName, normalized })
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      playerState: derivePlayerStatePda(owner),
      playerIdentity: derivePlayerIdentityPda(owner),
      usernameClaim: deriveUsernameClaimPda(normalized),
      owner,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  return plan("Register public username", args.connection, owner, instruction);
}

export async function buildRenameUsernamePlan(args: {
  connection: Connection;
  wallet: WalletLike;
  identity: PlayerIdentityView;
  displayName: string;
}): Promise<TransactionPlan> {
  const owner = args.wallet.publicKey;
  if (!args.identity.owner.equals(owner)) {
    throw new Error("Username belongs to a different wallet");
  }
  const normalized = normalizeUsername(args.displayName);
  if (normalized === args.identity.normalizedName) {
    throw new Error("Choose a different username");
  }
  await requireUsernameAvailable(args.connection, normalized);
  const methodArgs = {
    oldNormalized: args.identity.normalizedName,
    display: args.displayName,
    normalized,
  };
  const program = zkubeProgram(args.connection, args.wallet);
  const instruction = args.identity.moderated
    ? await program.methods
        .replaceModeratedUsername(methodArgs)
        .accountsPartial({
          protocol: deriveProtocolConfigPda(),
          playerState: derivePlayerStatePda(owner),
          playerIdentity: args.identity.address,
          blockedUsernameClaim: deriveUsernameClaimPda(
            args.identity.normalizedName,
          ),
          newUsernameClaim: deriveUsernameClaimPda(normalized),
          owner,
          systemProgram: SystemProgram.programId,
        })
        .instruction()
    : await program.methods
        .renameUsername(methodArgs)
        .accountsPartial({
          protocol: deriveProtocolConfigPda(),
          playerState: derivePlayerStatePda(owner),
          playerIdentity: args.identity.address,
          oldUsernameClaim: deriveUsernameClaimPda(
            args.identity.normalizedName,
          ),
          newUsernameClaim: deriveUsernameClaimPda(normalized),
          owner,
          systemProgram: SystemProgram.programId,
        })
        .instruction();
  return plan(
    args.identity.moderated
      ? "Replace moderated username"
      : "Rename public username",
    args.connection,
    owner,
    instruction,
  );
}

export async function buildModerateUsernamePlan(args: {
  connection: Connection;
  authority: WalletLike;
  identity: PlayerIdentityView;
  reasonCode: number;
}): Promise<TransactionPlan> {
  if (
    !Number.isInteger(args.reasonCode) ||
    args.reasonCode < 0 ||
    args.reasonCode > 255
  ) {
    throw new Error("reasonCode must be a u8");
  }
  const instruction = await zkubeProgram(args.connection, args.authority)
    .methods.moderateUsername({
      normalized: args.identity.normalizedName,
      reasonCode: args.reasonCode,
    })
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      playerIdentity: args.identity.address,
      usernameClaim: deriveUsernameClaimPda(args.identity.normalizedName),
      authority: args.authority.publicKey,
    })
    .instruction();
  return plan(
    "Moderate public username",
    args.connection,
    args.authority.publicKey,
    instruction,
  );
}

export async function buildRestoreUsernamePlan(args: {
  connection: Connection;
  authority: WalletLike;
  identity: PlayerIdentityView;
}): Promise<TransactionPlan> {
  const instruction = await zkubeProgram(args.connection, args.authority)
    .methods.restoreUsername(args.identity.normalizedName)
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      playerIdentity: args.identity.address,
      usernameClaim: deriveUsernameClaimPda(args.identity.normalizedName),
      authority: args.authority.publicKey,
    })
    .instruction();
  return plan(
    "Restore public username",
    args.connection,
    args.authority.publicKey,
    instruction,
  );
}

function decodeIdentity(
  program: ReturnType<typeof zkubeProgram>,
  address: PublicKey,
  expectedOwner: PublicKey,
  info: AccountInfo<Buffer>,
): PlayerIdentityView {
  assertProgramAccount(
    info,
    program.account.playerIdentity.size,
    "PlayerIdentity",
  );
  const raw = program.coder.accounts.decode(
    "playerIdentity",
    info.data,
  ) as unknown as RawPlayerIdentity;
  const len = Number(raw.nameLen);
  const displayName = decodeFixedAscii(raw.displayName, len);
  const normalizedName = decodeFixedAscii(raw.normalizedName, len);
  const registeredAt = Number(raw.registeredAt.toString());
  const lastRenamedAt = Number(raw.lastRenamedAt.toString());
  if (
    Number(raw.version) !== 1 ||
    !raw.owner.equals(expectedOwner) ||
    !address.equals(derivePlayerIdentityPda(expectedOwner)) ||
    normalizeUsername(displayName) !== normalizedName ||
    !Number.isInteger(Number(raw.renameCount)) ||
    Number(raw.renameCount) < 0 ||
    !Number.isSafeInteger(registeredAt) ||
    registeredAt < 0 ||
    !Number.isSafeInteger(lastRenamedAt) ||
    lastRenamedAt < registeredAt
  ) {
    throw new Error("PlayerIdentity relationship is invalid");
  }
  return {
    address,
    owner: raw.owner,
    displayName,
    normalizedName,
    renameCount: Number(raw.renameCount),
    registeredAt,
    lastRenamedAt,
    moderated: Boolean(raw.moderated),
    moderationReason: Number(raw.moderationReason),
  };
}

function decodeClaim(
  program: ReturnType<typeof zkubeProgram>,
  address: PublicKey,
  identity: PlayerIdentityView,
  info: AccountInfo<Buffer>,
): RawUsernameClaim {
  assertProgramAccount(
    info,
    program.account.usernameClaim.size,
    "UsernameClaim",
  );
  const raw = program.coder.accounts.decode(
    "usernameClaim",
    info.data,
  ) as unknown as RawUsernameClaim;
  const normalized = decodeFixedAscii(raw.normalizedName, Number(raw.nameLen));
  if (
    Number(raw.version) !== 1 ||
    !raw.owner.equals(identity.owner) ||
    !raw.playerIdentity.equals(identity.address) ||
    normalized !== identity.normalizedName ||
    !address.equals(deriveUsernameClaimPda(normalized)) ||
    (Number(raw.status) !== 0 && Number(raw.status) !== 1)
  ) {
    throw new Error("UsernameClaim relationship is invalid");
  }
  return raw;
}

function decodeFixedAscii(value: readonly number[], length: number): string {
  if (
    !Number.isInteger(length) ||
    length < 3 ||
    length > 16 ||
    value.length !== 16
  ) {
    throw new Error("Username account length is invalid");
  }
  const bytes = Uint8Array.from(value.slice(0, length));
  if (value.slice(length).some((byte) => byte !== 0)) {
    throw new Error("Username account padding is invalid");
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
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

async function requireUsernameAvailable(
  connection: Connection,
  normalized: string,
): Promise<void> {
  if (
    await connection.getAccountInfo(
      deriveUsernameClaimPda(normalized),
      "confirmed",
    )
  ) {
    throw new Error("That username is already registered or blocked");
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

function identityCacheKey(connection: Connection, owner: PublicKey): string {
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
