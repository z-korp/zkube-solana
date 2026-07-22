import {
  PublicKey,
  Transaction,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";

import { MAX_EMBLEM_ID } from "@/config/emblems";
import {
  campaignTotalStars,
  decodePlayerStateAccount,
  type PlayerStateView,
} from "./campaignClient.js";
import { derivePlayerStatePda } from "./pdas.js";
import { zkubeProgram, type TransactionPlan } from "./runPlan.js";
import type { WalletLike } from "./sessionWallet.js";

export type { CompetitionRecord, PlayerStateView } from "./campaignClient.js";

/** Compact leaderboard emblem projection: owner + stored emblem + total stars. */
export interface PlayerEmblemView {
  address: PublicKey;
  featuredEmblem: number;
  totalStars: number;
}

const PLAYER_STATE_CACHE_MS = 60_000;
const emblemCache = new Map<
  string,
  { view: PlayerStateView | null; expiresAt: number }
>();

/**
 * Single authoritative PlayerState read for the connected player. Uncached so
 * the competitive-profile / emblem / settlement hooks always reflect the latest
 * committed state; the batch leaderboard fetch below is the cached path.
 */
export async function fetchPlayerStateView(args: {
  connection: Connection;
  wallet: WalletLike;
  owner: PublicKey;
}): Promise<PlayerStateView | null> {
  const program = zkubeProgram(args.connection, args.wallet);
  const address = derivePlayerStatePda(args.owner);
  const info = await args.connection.getAccountInfo(address, "confirmed");
  if (!info) return null;
  return decodePlayerStateAccount(program, address, args.owner, info);
}

/**
 * Batch emblem/star projection for a list of leaderboard wallets. Mirrors
 * playerLabelClient.fetchPlayerLabels: one getMultipleAccountsInfo across the
 * PlayerState PDAs with a short per-owner cache, so a board renders emblems
 * without one account read per row. A malformed or missing account simply
 * yields no emblem entry — it never fabricates progression.
 */
export async function fetchPlayerEmblems(args: {
  connection: Connection;
  wallet: WalletLike;
  owners: readonly PublicKey[];
}): Promise<PlayerEmblemView[]> {
  const program = zkubeProgram(args.connection, args.wallet);
  const uniqueOwners = uniquePublicKeys(args.owners);
  if (uniqueOwners.length === 0) return [];
  const now = Date.now();
  const emblems: PlayerEmblemView[] = [];
  const ownersToFetch = uniqueOwners.filter((owner) => {
    const entry = emblemCache.get(cacheKey(args.connection, owner));
    if (!entry || entry.expiresAt <= now) return true;
    if (entry.view) emblems.push(toEmblemView(entry.view));
    return false;
  });
  if (ownersToFetch.length === 0) return emblems;

  const addresses = ownersToFetch.map((owner) => derivePlayerStatePda(owner));
  const infos = await args.connection.getMultipleAccountsInfo(
    addresses,
    "confirmed",
  );
  for (let index = 0; index < ownersToFetch.length; index += 1) {
    const owner = ownersToFetch[index]!;
    const info = infos[index];
    let view: PlayerStateView | null = null;
    if (info) {
      try {
        view = decodePlayerStateAccount(program, addresses[index]!, owner, info);
        emblems.push(toEmblemView(view));
      } catch {
        // Untrusted RPC: a malformed account never overrides wallet identity.
      }
    }
    emblemCache.set(cacheKey(args.connection, owner), {
      view,
      expiresAt: Date.now() + PLAYER_STATE_CACHE_MS,
    });
  }
  return emblems;
}

export function invalidatePlayerEmblems(owner: PublicKey): void {
  const suffix = `:${owner.toBase58()}`;
  for (const key of emblemCache.keys()) {
    if (key.endsWith(suffix)) emblemCache.delete(key);
  }
}

export function validateEmblemId(emblemId: number): number {
  if (!Number.isInteger(emblemId) || emblemId < 0 || emblemId > MAX_EMBLEM_ID) {
    throw new Error(`Emblem id must be between 0 and ${MAX_EMBLEM_ID}`);
  }
  return emblemId;
}

/**
 * Build the owner-authorized setFeaturedEmblem transaction. This is the only
 * emblem write path. It mirrors playerLabelClient.buildSetPlayerLabelPlan: the
 * owner authority and its optional device session token gate the write, and the
 * device session signer is the fee-paying actor. The instruction touches only
 * the player's own PlayerState PDA.
 */
export async function buildSetFeaturedEmblemPlan(args: {
  connection: Connection;
  wallet: WalletLike;
  ownerAuthority: PublicKey;
  sessionToken: PublicKey;
  emblemId: number;
}): Promise<TransactionPlan> {
  const emblemId = validateEmblemId(args.emblemId);
  const actor = args.wallet.publicKey;
  const instruction = await zkubeProgram(args.connection, args.wallet)
    .methods.setFeaturedEmblem(emblemId)
    .accountsPartial({
      playerState: derivePlayerStatePda(args.ownerAuthority),
      ownerAuthority: args.ownerAuthority,
      sessionToken: args.sessionToken,
      actor,
    })
    .instruction();
  return plan("Set featured emblem", args.connection, actor, instruction);
}

function toEmblemView(view: PlayerStateView): PlayerEmblemView {
  return {
    address: view.owner,
    featuredEmblem: view.featuredEmblem,
    totalStars: campaignTotalStars(view.campaignStars),
  };
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

function cacheKey(connection: Connection, owner: PublicKey): string {
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
