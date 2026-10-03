import { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import { SOLANA_DEVNET_GENESIS_HASH } from "../../shared/chain.js";
import { devnetConnection, rateLimitedFetch, RATE_LIMIT_RETRIES } from "./chainRelease.js";
import { executeTransaction, type PublicTransaction, type TransactionReceipt } from "./operatorTransaction.js";

const blockhash = new PublicKey(new Uint8Array(32).fill(7)).toBase58();
const results: Record<string, (params: unknown[]) => unknown> = {
  getGenesisHash: () => SOLANA_DEVNET_GENESIS_HASH,
  getMultipleAccounts: () => ({ context: { slot: 1 }, value: [null] }),
  getLatestBlockhash: () => ({ context: { slot: 1 }, value: { blockhash, lastValidBlockHeight: 100 } }),
  getFeeForMessage: () => ({ context: { slot: 1 }, value: 5000 }),
  getBalance: () => ({ context: { slot: 1 }, value: 10_000_000_000 }),
  simulateTransaction: () => ({ context: { slot: 1 }, value: { err: null, logs: [], unitsConsumed: 1,
    accounts: [{ lamports: 9_999_995_000, data: ["", "base64"], owner: SystemProgram.programId.toBase58(),
      executable: false, rentEpoch: 0, space: 0 }] } }),
  getSignatureStatuses: (params) => ({ context: { slot: 1 }, value: (params[0] as string[]).map(() =>
    ({ slot: 1, confirmations: null, err: null, confirmationStatus: "confirmed", status: { Ok: null } })) }),
  isBlockhashValid: () => ({ context: { slot: 1 }, value: true }),
  getBlockHeight: () => 20,
};

/** A Devnet endpoint that answers 429, with a Retry-After, to the first `busy` calls of each method. */
function endpoint(busy: (method: string) => number, signature?: () => string) {
  const seen = new Map<string, number>();
  const calls: string[] = [];
  const transport = (async (_url: unknown, init?: { body?: unknown }) => {
    const request = JSON.parse(String(init?.body)) as { id: string; method: string; params: unknown[] };
    const count = (seen.get(request.method) ?? 0) + 1;
    seen.set(request.method, count); calls.push(request.method);
    if (count <= busy(request.method)) return new Response("busy", { status: 429, headers: { "retry-after": "2" } });
    const result = request.method === "sendTransaction" ? signature!() : results[request.method]!(request.params);
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }), { status: 200 });
  }) as typeof fetch;
  const waits: number[] = [];
  const connection = devnetConnection("https://api.devnet.solana.com",
    rateLimitedFetch(transport, async (milliseconds) => { waits.push(milliseconds); }));
  return { connection, calls, waits };
}

describe("operator RPC rate limits", () => {
  it("every_operator_rpc_call_waits_out_a_429_and_is_made_again", async () => {
    const { connection, calls, waits } = endpoint(() => 1, () => "1".repeat(64));
    const payer = Keypair.generate();
    const message = new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: blockhash, instructions: [] })
      .compileToV0Message();
    const transaction = new VersionedTransaction(message); transaction.sign([payer]);
    expect(await connection.getGenesisHash()).toBe(SOLANA_DEVNET_GENESIS_HASH);
    await connection.getMultipleAccountsInfo([payer.publicKey]);
    expect((await connection.getLatestBlockhash()).blockhash).toBe(blockhash);
    expect((await connection.getFeeForMessage(message)).value).toBe(5000);
    expect(await connection.getBalance(payer.publicKey)).toBe(10_000_000_000);
    expect((await connection.simulateTransaction(transaction)).value.err).toBeNull();
    expect(await connection.sendRawTransaction(transaction.serialize())).toBe("1".repeat(64));
    expect((await connection.getSignatureStatus("1".repeat(64))).value?.confirmationStatus).toBe("confirmed");
    expect((await connection.isBlockhashValid(blockhash)).value).toBe(true);
    expect(await connection.getBlockHeight()).toBe(20);
    const methods = ["getGenesisHash", "getMultipleAccounts", "getLatestBlockhash", "getFeeForMessage", "getBalance",
      "simulateTransaction", "sendTransaction", "getSignatureStatuses", "isBlockhashValid", "getBlockHeight"];
    // Each call was answered 429 once, waited the endpoint's Retry-After, and was made again.
    expect(calls).toEqual(methods.flatMap((method) => [method, method]));
    expect(waits).toEqual(methods.map(() => 2_000));
  });

  it("a_run_continues_through_429s_and_signs_once", async () => {
    let raw = "";
    const { connection, waits } = endpoint(() => 1, () => {
      const sent = VersionedTransaction.deserialize(Buffer.from(raw, "base64"));
      return base58(sent.signatures[0]!);
    });
    const payer = Keypair.generate();
    const plan = transferPlan(payer.publicKey);
    // Confirmation reads the signature's status through the same transport.
    vi.spyOn(connection, "confirmTransaction").mockImplementation((async ({ signature }: { signature: string }) =>
      ({ context: { slot: 1 }, value: { err: (await connection.getSignatureStatus(signature)).value!.err } })) as never);
    const loadSigner = vi.fn(() => payer);
    const persisted: TransactionReceipt[] = [];
    const sendRaw = connection.sendRawTransaction.bind(connection);
    vi.spyOn(connection, "sendRawTransaction").mockImplementation(async (bytes, options) => {
      raw = Buffer.from(bytes as Uint8Array).toString("base64"); return sendRaw(bytes, options);
    });
    const receipt = await executeTransaction({ connection, plan, loadSigner, persist: (value) => persisted.push(value) });
    expect(receipt.state).toBe("confirmed");
    expect(loadSigner).toHaveBeenCalledTimes(1);
    expect(waits.length).toBeGreaterThanOrEqual(5);
  });

  it("a_run_gives_up_after_the_bound_and_keeps_its_signed_receipt_without_signing_again", async () => {
    // The endpoint is busy for every send, for longer than the bound.
    const { connection, calls, waits } = endpoint((method) => method === "sendTransaction" ? Number.MAX_SAFE_INTEGER : 0);
    const payer = Keypair.generate();
    const loadSigner = vi.fn(() => payer);
    const persisted: TransactionReceipt[] = [];
    await expect(executeTransaction({ connection, plan: transferPlan(payer.publicKey), loadSigner,
      persist: (value) => persisted.push(value) })).rejects.toThrow();
    expect(calls.filter((method) => method === "sendTransaction")).toHaveLength(RATE_LIMIT_RETRIES + 1);
    expect(waits.filter((wait) => wait === 2_000)).toHaveLength(RATE_LIMIT_RETRIES);
    expect(loadSigner).toHaveBeenCalledTimes(1);
    // The signed bytes are kept as a pending receipt: resuming relays them, never signs anew.
    expect(persisted.map((receipt) => receipt.state)).toEqual(["pending"]);
  });

  it("without_retry_after_the_wait_doubles_from_one_second_to_thirty", async () => {
    const waits: number[] = [];
    let answered = 0;
    const transport = (async () => {
      answered++;
      return new Response("busy", { status: 429 });
    }) as unknown as typeof fetch;
    const response = await rateLimitedFetch(transport, async (milliseconds) => { waits.push(milliseconds); })("https://x", {});
    expect(response.status).toBe(429);
    expect(answered).toBe(RATE_LIMIT_RETRIES + 1);
    expect(waits).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000]);
  });
});

function transferPlan(payer: PublicKey): PublicTransaction {
  const instruction = SystemProgram.transfer({ fromPubkey: payer, toPubkey: Keypair.generate().publicKey, lamports: 1 });
  return { label: "Bounded transfer", payer: payer.toBase58(), maximumFeeLamports: 5000, maximumSpendLamports: 5001,
    reserveLamports: 100_000_000, instructions: [{ program: instruction.programId.toBase58(),
      data: Buffer.from(instruction.data).toString("base64"),
      accounts: instruction.keys.map((key) => ({ address: key.pubkey.toBase58(), signer: key.isSigner, writable: key.isWritable })) }] };
}

function base58(bytes: Uint8Array): string {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = BigInt("0x" + Buffer.from(bytes).toString("hex"));
  let text = "";
  while (value > 0n) { text = alphabet[Number(value % 58n)] + text; value /= 58n; }
  for (const byte of bytes) { if (byte !== 0) break; text = "1" + text; }
  return text;
}
