// What a paid run costs a device is partly other people's numbers: the
// cluster's rent rate, and the delegation program's funding of its two
// accounts and its session fee, which are compiled into that program and
// change with its upgrades. The program states them as constants; this check
// measures them again from the cluster and a real run, reading public state
// only, and names every figure that no longer holds.
import { PublicKey, type Connection } from "@solana/web3.js";
import { ZKUBE_PROGRAM_ID } from "../../shared/chain.js";
import { ACTIVE_RUN_RENT_LAMPORTS, ARENA_PLAYER_RENT_LAMPORTS, CLUSTER_RENT_LAMPORTS_PER_BYTE,
  DELEGATION_FUNDING_LAMPORTS, DELEGATION_SESSION_FEE_LAMPORTS, FIRST_ENTRY_ACCOUNT_SPACES,
} from "../../services/src/protocolVersions.generated.js";

export const DELEGATION_PROGRAM_ID = new PublicKey("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");
const UPGRADEABLE_LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const ACCOUNT_STORAGE_OVERHEAD = 128;

/** A confirmed transaction as the RPC's jsonParsed encoding gives it, as far as the check reads it. */
export interface RecordedTransaction {
  slot: number;
  transaction: { signatures: string[]; message: { accountKeys: { pubkey: unknown; signer: boolean }[] } };
  meta: { err: unknown; fee: number; preBalances: number[]; postBalances: number[]; logMessages?: string[] | null;
    innerInstructions?: { instructions: object[] }[] | null } | null;
}
export interface RecordedRun {
  rentLamportsPerByte: number;
  delegationDeploySlot: number;
  entry: RecordedTransaction;
  undelegation: RecordedTransaction;
  consume: RecordedTransaction;
}
export interface Figure { figure: string; stated: number; measured: number | string; holds: boolean }

const address = (key: unknown) => typeof key === "string" ? key : (key as PublicKey).toBase58();
const names = (transaction: RecordedTransaction) => (transaction.meta?.logMessages ?? [])
  .flatMap(line => / Instruction: (\w+)$/.exec(line)?.[1] ?? []);
function balances(transaction: RecordedTransaction) {
  const meta = transaction.meta!;
  return new Map(transaction.transaction.message.accountKeys.map((key, index) =>
    [address(key.pubkey), { before: meta.preBalances[index]!, after: meta.postBalances[index]! }]));
}
/** Every account a transaction's inner instructions create: who owns it, its size and what it was given. */
function created(transaction: RecordedTransaction) {
  return (transaction.meta?.innerInstructions ?? []).flatMap(inner => inner.instructions).flatMap(instruction => {
    const parsed = (instruction as { program?: string; parsed?: { type?: string; info?: Record<string, unknown> } });
    if (parsed.program !== "system" || parsed.parsed?.type !== "createAccount") return [];
    const info = parsed.parsed.info!;
    return [{ address: address(info.newAccount), owner: address(info.owner), space: Number(info.space), lamports: Number(info.lamports) }];
  });
}

/** Every stated figure beside what one real run shows. Pure: the transactions are given. */
export function measureRun(run: RecordedRun): Figure[] {
  const figures: Figure[] = [];
  const state = (figure: string, stated: number, measured: number | string) =>
    figures.push({ figure, stated, measured, holds: stated === measured });
  for (const [name, transaction] of Object.entries({ entry: run.entry, undelegation: run.undelegation, consume: run.consume })) {
    if (!transaction.meta || transaction.meta.err) throw new Error(`The recorded ${name} did not succeed`);
  }
  // A run from before the delegation program's last upgrade says nothing about what it charges now.
  if (run.entry.slot <= run.delegationDeploySlot) {
    throw new Error(`No run has been measured since the delegation program was deployed at slot ${run.delegationDeploySlot}`);
  }
  const spaces = FIRST_ENTRY_ACCOUNT_SPACES, program = ZKUBE_PROGRAM_ID.toBase58(), delegation = DELEGATION_PROGRAM_ID.toBase58();
  state("rent, lamports a byte", CLUSTER_RENT_LAMPORTS_PER_BYTE, run.rentLamportsPerByte);

  const accounts = created(run.entry);
  const ours = accounts.filter(account => account.owner === program), theirs = accounts.filter(account => account.owner === delegation);
  const one = (found: typeof accounts, what: string) => found.length === 1 ? found[0]! : `${found.length} ${what} accounts`;
  const lamports = (found: ReturnType<typeof one>) => typeof found === "string" ? found : found.lamports;
  const activeRun = one(ours.filter(account => account.space === spaces.activeRun && account.lamports > 0), "run");
  state("run rent", ACTIVE_RUN_RENT_LAMPORTS, lamports(activeRun));
  // The buffer is the run's size, ours, and holds nothing.
  state("delegation buffer lamports", 0, lamports(one(ours.filter(account =>
    account.space === spaces.delegationBuffer && account.lamports === 0), "buffer")));
  const player = ours.filter(account => account.space === spaces.arenaPlayer);
  if (player.length) state("daily player rent", ARENA_PLAYER_RENT_LAMPORTS, lamports(one(player, "daily player")));
  const record = one(theirs.filter(account => account.space === spaces.delegationRecord), "delegation record");
  const metadata = one(theirs.filter(account => account.space === spaces.delegationMetadata), "delegation metadata");
  state("delegation accounts", 2, theirs.length);
  const funding = typeof record === "string" ? record : typeof metadata === "string" ? metadata : record.lamports + metadata.lamports;
  state("delegation funding", DELEGATION_FUNDING_LAMPORTS, funding);

  // The same run, followed through its undelegation and its consume by its accounts.
  const device = address(run.entry.transaction.message.accountKeys[0]!.pubkey);
  const [entered, undelegated, consumed] = [run.entry, run.undelegation, run.consume].map(balances) as
    [ReturnType<typeof balances>, ReturnType<typeof balances>, ReturnType<typeof balances>];
  const moved = (ledger: ReturnType<typeof balances>, key: string) => (ledger.get(key)?.after ?? 0) - (ledger.get(key)?.before ?? 0);
  if (typeof record !== "string" && typeof metadata !== "string" && typeof activeRun !== "string") {
    const closed = [record, metadata].map(account => undelegated.get(account.address));
    const sameRun = closed.every(account => account?.after === 0) && consumed.get(activeRun.address)?.after === 0;
    if (!sameRun) throw new Error("The recorded entry, undelegation and consume are not one run");
    const held = closed.reduce((sum, account) => sum + account!.before, 0);
    state("delegation session fee", DELEGATION_SESSION_FEE_LAMPORTS, held - moved(undelegated, device));
    // Nothing else is charged: once settled the device is short of the fee and its own transaction fees.
    const playerRent = player.length === 1 ? player[0]!.lamports : 0;
    const spent = -(moved(entered, device) + moved(undelegated, device) + moved(consumed, device)) - playerRent;
    // Someone else may have sent the consume; then its fee was not the device's.
    const consumeFee = address(run.consume.transaction.message.accountKeys[0]!.pubkey) === device ? run.consume.meta!.fee : 0;
    state("run cost besides its transaction fees", DELEGATION_SESSION_FEE_LAMPORTS, spent - run.entry.meta!.fee - consumeFee);
  }
  return figures;
}

/** Throws naming every figure that no longer holds. */
export function requireRunCosts(run: RecordedRun): Figure[] {
  const figures = measureRun(run);
  const stale = figures.filter(figure => !figure.holds);
  if (stale.length) {
    throw new Error("Run cost figures no longer match the cluster: " + stale.map(figure =>
      `${figure.figure} is stated ${figure.stated} and measured ${figure.measured}`).join("; ") +
      ". Correct them in programs/solana/src/state/arcade.rs and regenerate.");
  }
  return figures;
}

const succeeded = (transaction: RecordedTransaction | null): transaction is RecordedTransaction =>
  !!transaction?.meta && !transaction.meta.err;

/** The cluster's rent rate, the delegation program's deploy slot and the latest settled zKube run. */
export async function readLatestRun(connection: Connection, depth = 100): Promise<RecordedRun> {
  const floor = await connection.getMinimumBalanceForRentExemption(0, "confirmed");
  const rentLamportsPerByte = floor / ACCOUNT_STORAGE_OVERHEAD;
  if (await connection.getMinimumBalanceForRentExemption(100, "confirmed") !== (100 + ACCOUNT_STORAGE_OVERHEAD) * rentLamportsPerByte) {
    throw new Error("The cluster's rent is no longer a flat rate per byte");
  }
  const [programData] = PublicKey.findProgramAddressSync([DELEGATION_PROGRAM_ID.toBuffer()], UPGRADEABLE_LOADER);
  const header = await connection.getAccountInfo(programData, { commitment: "confirmed", dataSlice: { offset: 4, length: 8 } });
  if (!header) throw new Error("The delegation program's data account is missing");
  const delegationDeploySlot = Number(header.data.readBigUInt64LE(0));
  const read = async (signature: string) => await connection.getParsedTransaction(signature,
    { commitment: "confirmed", maxSupportedTransactionVersion: 0 }) as unknown as RecordedTransaction | null;
  // Newest first: the latest consume names its run, and the run's own history holds the rest.
  for (const { signature, err } of await connection.getSignaturesForAddress(ZKUBE_PROGRAM_ID, { limit: depth }, "confirmed")) {
    if (err) continue;
    const consume = await read(signature);
    if (!succeeded(consume) || !names(consume).includes("ConsumeArenaRun")) continue;
    const run = [...balances(consume)].find(([, balance]) => balance.before > 0 && balance.after === 0)?.[0];
    if (!run) continue;
    let entry: RecordedTransaction | undefined, undelegation: RecordedTransaction | undefined;
    for (const earlier of await connection.getSignaturesForAddress(new PublicKey(run), { limit: 50 }, "confirmed")) {
      if (earlier.err || earlier.signature === signature) continue;
      const transaction = await read(earlier.signature);
      if (!succeeded(transaction)) continue;
      if (names(transaction).includes("ProcessUndelegation")) undelegation ??= transaction;
      if (names(transaction).includes("DelegateActiveRun")) { entry = transaction; break; }
    }
    if (entry && undelegation) return { rentLamportsPerByte, delegationDeploySlot, entry, undelegation, consume };
  }
  throw new Error(`No settled run was found in the program's last ${depth} transactions`);
}
