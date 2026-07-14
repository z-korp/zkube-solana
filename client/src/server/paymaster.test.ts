// @vitest-environment node

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ComputeBudgetProgram,
  Keypair,
  type Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { createTopUpEscrowInstruction } from "@magicblock-labs/ephemeral-rollups-sdk";
import { describe, expect, it, vi } from "vitest";
import { IDL } from "../chain/idl";
import { ZKUBE_PROGRAM_ID } from "../chain/constants";
import {
  DEFAULT_ACTION_ESCROW_TOP_UP_LAMPORTS,
  MAGIC_ACTION_ESCROW_INDEX,
  buildTopUpMagicActionEscrowInstruction,
  deriveMagicActionEscrowPda,
} from "../chain/magicAction";
import {
  buildCreateSessionV2Instruction,
  SESSION_KEYS_PROGRAM_ID,
  SESSION_TOKEN_V2_ACCOUNT_BYTES,
  SESSION_TOKEN_V2_DISCRIMINATOR,
  deriveSessionTokenV2Pda,
} from "../chain/sessionV2";
import {
  SPONSORED_GAME_DISCRIMINATORS,
  PAYMASTER_SESSION_MAX_SECONDS,
  SOLANA_DEVNET_GENESIS_HASH,
  handlePaymasterRequest,
  paymasterKeypairFromEnv,
  validatePaymasterTransaction,
} from "./paymaster";

describe("paymaster policy", () => {
  it("binds the server-only signer to the public deployment identity", () => {
    const paymaster = Keypair.generate();
    const encoded = JSON.stringify(Array.from(paymaster.secretKey));
    expect(
      paymasterKeypairFromEnv({
        PAYMASTER_SECRET_KEY: encoded,
        ZKUBE_PAYMASTER_PUBLIC_KEY: paymaster.publicKey.toBase58(),
      }).publicKey.equals(paymaster.publicKey),
    ).toBe(true);
    expect(() =>
      paymasterKeypairFromEnv({
        PAYMASTER_SECRET_KEY: encoded,
        ZKUBE_PAYMASTER_PUBLIC_KEY: Keypair.generate().publicKey.toBase58(),
      }),
    ).toThrow("does not match ZKUBE_PAYMASTER_PUBLIC_KEY");
  });

  it("loads an ignored keypair path only for development", () => {
    const directory = mkdtempSync(join(tmpdir(), "zkube-paymaster-"));
    try {
      const paymaster = Keypair.generate();
      const path = join(directory, "paymaster.json");
      writeFileSync(path, JSON.stringify(Array.from(paymaster.secretKey)), {
        mode: 0o600,
      });
      expect(
        paymasterKeypairFromEnv({
          PAYMASTER_KEYPAIR_PATH: path,
          ZKUBE_PAYMASTER_PUBLIC_KEY: paymaster.publicKey.toBase58(),
          NODE_ENV: "development",
        }).publicKey.equals(paymaster.publicKey),
      ).toBe(true);
      expect(() =>
        paymasterKeypairFromEnv({
          PAYMASTER_KEYPAIR_PATH: path,
          NODE_ENV: "production",
        }),
      ).toThrow("disabled in production");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("emits category-only stateless telemetry without affecting the response", async () => {
    const telemetry = vi.fn();
    const result = await handlePaymasterRequest(
      "POST",
      {},
      {
        keypair: Keypair.generate(),
        connection: {} as Connection,
        now: () => 1_000,
        requestId: () => "request-1",
        telemetry,
      },
    );
    expect(result).toEqual({
      status: 400,
      body: { error: "missing transaction" },
    });
    expect(telemetry).toHaveBeenCalledWith({
      schemaVersion: 1,
      event: "paymaster_request",
      traceId: "request-1",
      layer: "solana-base",
      method: "POST",
      status: 400,
      outcome: "payload_missing",
      durationMs: 0,
    });
    expect(JSON.stringify(telemetry.mock.calls[0])).not.toContain(
      "transaction",
    );

    const identity = await handlePaymasterRequest("GET", null, {
      keypair: Keypair.generate(),
      connection: {} as Connection,
      telemetry: () => {
        throw new Error("log sink unavailable");
      },
    });
    expect(identity.status).toBe(200);
  });

  it("pins every sponsored discriminator to the generated Anchor IDL", () => {
    for (const [name, discriminator] of Object.entries(
      SPONSORED_GAME_DISCRIMINATORS,
    )) {
      const anchorName = name.replace(
        /[A-Z]/g,
        (letter) => `_${letter.toLowerCase()}`,
      );
      const instruction = IDL.instructions.find(
        (candidate) => candidate.name === anchorName,
      );
      expect(instruction?.discriminator, name).toEqual(discriminator);
    }
  });

  it("accepts a player-signed allowlisted zkube instruction", () => {
    const paymaster = Keypair.generate();
    const owner = Keypair.generate();
    const transaction = transactionWith(
      paymaster.publicKey,
      owner,
      initializePlayerInstruction(paymaster, owner),
    );
    expect(
      validatePaymasterTransaction(transaction, paymaster.publicKey),
    ).toBeNull();
  });

  it("rejects arbitrary game and raw system instructions", () => {
    const paymaster = Keypair.generate();
    const owner = Keypair.generate();
    const game = transactionWith(
      paymaster.publicKey,
      owner,
      new TransactionInstruction({
        programId: ZKUBE_PROGRAM_ID,
        keys: [{ pubkey: owner.publicKey, isSigner: true, isWritable: false }],
        data: Buffer.alloc(8, 42),
      }),
    );
    expect(validatePaymasterTransaction(game, paymaster.publicKey)).toBe(
      "zkube instruction is not sponsored",
    );

    const transfer = transactionWith(
      paymaster.publicKey,
      owner,
      SystemProgram.transfer({
        fromPubkey: owner.publicKey,
        toPubkey: Keypair.generate().publicKey,
        lamports: 1,
      }),
    );
    expect(
      validatePaymasterTransaction(transfer, paymaster.publicKey),
    ).toContain("is not sponsored");
  });

  it("rejects compute-unit limit instructions", () => {
    const paymaster = Keypair.generate();
    const owner = Keypair.generate();
    const transaction = transactionWithMany(
      paymaster.publicKey,
      [owner],
      [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
        initializePlayerInstruction(paymaster, owner),
      ],
    );

    expect(validatePaymasterTransaction(transaction, paymaster.publicKey)).toBe(
      "Compute Budget instructions are not sponsored",
    );
  });

  it("rejects compute-unit price instructions", () => {
    const paymaster = Keypair.generate();
    const owner = Keypair.generate();
    const transaction = transactionWithMany(
      paymaster.publicKey,
      [owner],
      [
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
        initializePlayerInstruction(paymaster, owner),
      ],
    );

    expect(validatePaymasterTransaction(transaction, paymaster.publicKey)).toBe(
      "Compute Budget instructions are not sponsored",
    );
  });

  it("rejects a transaction whose player signature is missing", () => {
    const paymaster = Keypair.generate();
    const owner = Keypair.generate();
    const message = new TransactionMessage({
      payerKey: paymaster.publicKey,
      recentBlockhash: "11111111111111111111111111111111",
      instructions: [
        new TransactionInstruction({
          programId: ZKUBE_PROGRAM_ID,
          keys: [
            { pubkey: owner.publicKey, isSigner: true, isWritable: false },
          ],
          data: Buffer.from(SPONSORED_GAME_DISCRIMINATORS.initializePlayer),
        }),
      ],
    }).compileToV0Message();
    const transaction = new VersionedTransaction(message);
    expect(
      validatePaymasterTransaction(transaction, paymaster.publicKey),
    ).toContain("has not signed");

    const corrupted = transactionWith(
      paymaster.publicKey,
      owner,
      initializePlayerInstruction(paymaster, owner),
    );
    corrupted.signatures[1]![0] ^= 0xff;
    expect(
      validatePaymasterTransaction(corrupted, paymaster.publicKey),
    ).toContain("invalid signature");
  });

  it("accepts only a separate bounded SessionTokenV2 enablement", () => {
    const paymaster = Keypair.generate();
    const owner = Keypair.generate();
    const session = Keypair.generate();
    const nowUnix = Math.floor(Date.now() / 1_000);
    const transaction = transactionWithMany(
      paymaster.publicKey,
      [owner, session],
      [
        buildCreateSessionV2Instruction({
          authority: owner.publicKey,
          sessionSigner: session.publicKey,
          feePayer: paymaster.publicKey,
          topUp: false,
          validUntil: nowUnix + PAYMASTER_SESSION_MAX_SECONDS,
        }),
      ],
    );
    expect(
      validatePaymasterTransaction(transaction, paymaster.publicKey),
    ).toBeNull();

    const combined = transactionWithMany(
      paymaster.publicKey,
      [owner, session],
      [
        buildCreateSessionV2Instruction({
          authority: owner.publicKey,
          sessionSigner: session.publicKey,
          feePayer: paymaster.publicKey,
          topUp: false,
          validUntil: nowUnix + PAYMASTER_SESSION_MAX_SECONDS,
        }),
        initializePlayerInstruction(paymaster, owner),
      ],
    );
    expect(validatePaymasterTransaction(combined, paymaster.publicKey)).toContain(
      "separate owner-approved",
    );

    const topUpSession = transactionWithMany(
      paymaster.publicKey,
      [owner, session],
      [
        buildCreateSessionV2Instruction({
          authority: owner.publicKey,
          sessionSigner: session.publicKey,
          feePayer: paymaster.publicKey,
          topUp: true,
          validUntil: nowUnix + PAYMASTER_SESSION_MAX_SECONDS,
          lamports: 1,
        }),
      ],
    );
    expect(
      validatePaymasterTransaction(topUpSession, paymaster.publicKey),
    ).toContain("without a SOL top-up");

    const longLivedSession = transactionWithMany(
      paymaster.publicKey,
      [owner, session],
      [
        buildCreateSessionV2Instruction({
          authority: owner.publicKey,
          sessionSigner: session.publicKey,
          feePayer: paymaster.publicKey,
          topUp: false,
          validUntil: nowUnix + PAYMASTER_SESSION_MAX_SECONDS + 1,
        }),
      ],
    );
    expect(
      validatePaymasterTransaction(
        longLivedSession,
        paymaster.publicKey,
        nowUnix,
      ),
    ).toContain("at most seven days");
  });

  it("rejects oversized or cross-authority Magic Action escrow top-ups", () => {
    const paymaster = Keypair.generate();
    const owner = Keypair.generate();
    const otherOwner = Keypair.generate();
    const session = Keypair.generate();
    const sessionInstruction = buildCreateSessionV2Instruction({
      authority: owner.publicKey,
      sessionSigner: session.publicKey,
      feePayer: paymaster.publicKey,
      topUp: false,
      validUntil:
        Math.floor(Date.now() / 1_000) + PAYMASTER_SESSION_MAX_SECONDS,
    });
    const oversized = createTopUpEscrowInstruction(
      deriveMagicActionEscrowPda(owner.publicKey),
      owner.publicKey,
      paymaster.publicKey,
      DEFAULT_ACTION_ESCROW_TOP_UP_LAMPORTS + 1,
      MAGIC_ACTION_ESCROW_INDEX,
    );
    expect(
      validatePaymasterTransaction(
        transactionWithMany(
          paymaster.publicKey,
          [owner, session],
          [sessionInstruction, oversized],
        ),
        paymaster.publicKey,
      ),
    ).toContain("outside the sponsored limit");

    const crossAuthority = buildTopUpMagicActionEscrowInstruction({
      authority: otherOwner.publicKey,
      payer: paymaster.publicKey,
    });
    expect(
      validatePaymasterTransaction(
        transactionWithMany(
          paymaster.publicKey,
          [owner, session],
          [sessionInstruction, crossAuthority],
        ),
        paymaster.publicKey,
      ),
    ).toContain("exactly one player authority");
  });

  it("verifies live scoped-session fields before relay signing", async () => {
    const paymaster = Keypair.generate();
    const owner = Keypair.generate();
    const actor = Keypair.generate();
    const nowUnix = 1_800_000_000;
    const sessionToken = deriveSessionTokenV2Pda({
      authority: owner.publicKey,
      sessionSigner: actor.publicKey,
    }).sessionToken;
    const transaction = transactionWithMany(
      paymaster.publicKey,
      [actor],
      [sessionActionInstruction(owner.publicKey, actor.publicKey, sessionToken)],
    );
    const connection = relayConnection([
      sessionAccountInfo({
        authority: owner.publicKey,
        actor: actor.publicKey,
        paymaster: paymaster.publicKey,
        validUntil: nowUnix + 600,
      }),
    ]);

    const result = await handlePaymasterRequest(
      "POST",
      { transaction: Buffer.from(transaction.serialize()).toString("base64") },
      { keypair: paymaster, connection, now: () => nowUnix * 1_000 },
    );

    expect(result.status).toBe(200);
    expect(connection.getMultipleAccountsInfo).toHaveBeenCalledWith(
      [sessionToken],
      "confirmed",
    );
  });

  it("rejects expired, cross-owner, wrong-actor, wrong-target, and malformed live sessions", async () => {
    const paymaster = Keypair.generate();
    const owner = Keypair.generate();
    const actor = Keypair.generate();
    const nowUnix = 1_800_000_000;
    const sessionToken = deriveSessionTokenV2Pda({
      authority: owner.publicKey,
      sessionSigner: actor.publicKey,
    }).sessionToken;
    const transaction = transactionWithMany(
      paymaster.publicKey,
      [actor],
      [sessionActionInstruction(owner.publicKey, actor.publicKey, sessionToken)],
    );
    const cases = [
      sessionAccountInfo({ authority: owner.publicKey, actor: actor.publicKey, paymaster: paymaster.publicKey, validUntil: nowUnix }),
      sessionAccountInfo({ authority: Keypair.generate().publicKey, actor: actor.publicKey, paymaster: paymaster.publicKey, validUntil: nowUnix + 600 }),
      sessionAccountInfo({ authority: owner.publicKey, actor: Keypair.generate().publicKey, paymaster: paymaster.publicKey, validUntil: nowUnix + 600 }),
      sessionAccountInfo({ authority: owner.publicKey, actor: actor.publicKey, paymaster: paymaster.publicKey, validUntil: nowUnix + 600, target: Keypair.generate().publicKey }),
      { ...sessionAccountInfo({ authority: owner.publicKey, actor: actor.publicKey, paymaster: paymaster.publicKey, validUntil: nowUnix + 600 }), data: Buffer.alloc(3) },
    ];

    for (const info of cases) {
      const result = await handlePaymasterRequest(
        "POST",
        { transaction: Buffer.from(transaction.serialize()).toString("base64") },
        {
          keypair: paymaster,
          connection: relayConnection([info]),
          now: () => nowUnix * 1_000,
        },
      );
      expect(result.status).toBe(403);
    }
  });

  it("never lets a session sign a Star purchase or expand into a transfer", () => {
    const paymaster = Keypair.generate();
    const owner = Keypair.generate();
    const actor = Keypair.generate();
    const sessionToken = deriveSessionTokenV2Pda({
      authority: owner.publicKey,
      sessionSigner: actor.publicKey,
    }).sessionToken;
    const purchase = new TransactionInstruction({
      programId: ZKUBE_PROGRAM_ID,
      keys: Array.from({ length: 11 }, (_, index) => ({
        pubkey:
          index === 0
            ? actor.publicKey
            : index === 10
              ? owner.publicKey
              : Keypair.generate().publicKey,
        isSigner: index === 0,
        isWritable: index < 10,
      })),
      data: Buffer.from(SPONSORED_GAME_DISCRIMINATORS.purchaseStars),
    });
    expect(
      validatePaymasterTransaction(
        transactionWithMany(paymaster.publicKey, [actor], [purchase]),
        paymaster.publicKey,
      ),
    ).toContain("owner must be");

    const expanded = transactionWithMany(
      paymaster.publicKey,
      [actor],
      [
        sessionActionInstruction(owner.publicKey, actor.publicKey, sessionToken),
        SystemProgram.transfer({
          fromPubkey: actor.publicKey,
          toPubkey: Keypair.generate().publicKey,
          lamports: 1,
        }),
      ],
    );
    expect(validatePaymasterTransaction(expanded, paymaster.publicKey)).toContain(
      "is not sponsored",
    );

    const ownerPurchase = purchaseStarsInstruction(owner.publicKey);
    expect(
      validatePaymasterTransaction(
        transactionWithMany(paymaster.publicKey, [owner], [ownerPurchase]),
        paymaster.publicKey,
      ),
    ).toBeNull();
    expect(
      validatePaymasterTransaction(
        transactionWithMany(
          paymaster.publicKey,
          [owner],
          [ownerPurchase, ownerPurchase],
        ),
        paymaster.publicKey,
      ),
    ).toContain("one owner-approved purchase");
    expect(
      validatePaymasterTransaction(
        transactionWithMany(
          paymaster.publicKey,
          [owner],
          [initializePlayerInstruction(paymaster, owner), ownerPurchase],
        ),
        paymaster.publicKey,
      ),
    ).toBeNull();
    expect(
      validatePaymasterTransaction(
        transactionWithMany(
          paymaster.publicKey,
          [owner],
          [
            ownerPurchase,
            sessionActionInstruction(
              owner.publicKey,
              owner.publicKey,
              ZKUBE_PROGRAM_ID,
            ),
          ],
        ),
        paymaster.publicKey,
      ),
    ).toContain("one owner-approved purchase");
  });

  it("verifies the cluster, adds only the paymaster signature, simulates, and submits", async () => {
    const paymaster = Keypair.generate();
    const owner = Keypair.generate();
    const transaction = transactionWith(
      paymaster.publicKey,
      owner,
      initializePlayerInstruction(paymaster, owner),
    );
    const ownerSignature = Uint8Array.from(transaction.signatures[1]!);
    const simulateTransaction = vi.fn().mockImplementation(async (unsigned) => {
      expect(Array.from(unsigned.signatures[0])).toEqual(Array(64).fill(0));
      return { value: { err: null } };
    });
    const sendRawTransaction = vi.fn().mockImplementation(async (raw) => {
      const signed = VersionedTransaction.deserialize(raw);
      expect(Array.from(signed.signatures[0])).not.toEqual(Array(64).fill(0));
      expect(signed.signatures[1]).toEqual(ownerSignature);
      return "devnet-signature";
    });
    const connection = {
      getGenesisHash: vi.fn().mockResolvedValue(SOLANA_DEVNET_GENESIS_HASH),
      simulateTransaction,
      sendRawTransaction,
    } as unknown as Connection;
    const result = await handlePaymasterRequest(
      "POST",
      { transaction: Buffer.from(transaction.serialize()).toString("base64") },
      { keypair: paymaster, connection, now: () => 1_800_000_000_000 },
    );
    expect(result).toEqual({
      status: 200,
      body: { signature: "devnet-signature" },
      telemetry: {
        operation: "initializePlayer",
        signature: "devnet-signature",
      },
    });
    expect(simulateTransaction).toHaveBeenCalledOnce();
    expect(sendRawTransaction).toHaveBeenCalledOnce();
  });

  it("refuses to sign when the RPC genesis hash is not devnet", async () => {
    const paymaster = Keypair.generate();
    const owner = Keypair.generate();
    const transaction = transactionWith(
      paymaster.publicKey,
      owner,
      initializePlayerInstruction(paymaster, owner),
    );
    const connection = {
      getGenesisHash: vi.fn().mockResolvedValue("mainnet-or-testnet"),
      simulateTransaction: vi.fn(),
    } as unknown as Connection;
    const result = await handlePaymasterRequest(
      "POST",
      { transaction: Buffer.from(transaction.serialize()).toString("base64") },
      { keypair: paymaster, connection, now: () => 1_800_000_000_000 },
    );
    expect(result.status).toBe(503);
    expect(connection.simulateTransaction).not.toHaveBeenCalled();
  });
});

function transactionWith(
  paymaster: PublicKey,
  owner: Keypair,
  instruction: TransactionInstruction,
): VersionedTransaction {
  return transactionWithMany(paymaster, [owner], [instruction]);
}

function transactionWithMany(
  paymaster: PublicKey,
  signers: Keypair[],
  instructions: TransactionInstruction[],
): VersionedTransaction {
  const owner = signers[0];
  if (!owner) throw new Error("test transaction requires an owner signer");
  const message = new TransactionMessage({
    payerKey: paymaster,
    recentBlockhash: "11111111111111111111111111111111",
    instructions,
  }).compileToV0Message();
  const transaction = new VersionedTransaction(message);
  transaction.sign(signers);
  return transaction;
}

function initializePlayerInstruction(
  paymaster: Keypair,
  owner: Keypair,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: ZKUBE_PROGRAM_ID,
    keys: [
      {
        pubkey: Keypair.generate().publicKey,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: Keypair.generate().publicKey,
        isSigner: false,
        isWritable: true,
      },
      { pubkey: paymaster.publicKey, isSigner: true, isWritable: true },
      { pubkey: owner.publicKey, isSigner: false, isWritable: false },
      { pubkey: ZKUBE_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: owner.publicKey, isSigner: true, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(SPONSORED_GAME_DISCRIMINATORS.initializePlayer),
  });
}

function sessionActionInstruction(
  owner: PublicKey,
  actor: PublicKey,
  sessionToken: PublicKey,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: ZKUBE_PROGRAM_ID,
    keys: [
      ...Array.from({ length: 5 }, () => ({
        pubkey: Keypair.generate().publicKey,
        isSigner: false,
        isWritable: true,
      })),
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: sessionToken, isSigner: false, isWritable: false },
      { pubkey: actor, isSigner: true, isWritable: false },
    ],
    data: Buffer.from(SPONSORED_GAME_DISCRIMINATORS.unlockZone),
  });
}

function purchaseStarsInstruction(owner: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: ZKUBE_PROGRAM_ID,
    keys: [
      ...Array.from({ length: 10 }, () => ({
        pubkey: Keypair.generate().publicKey,
        isSigner: false,
        isWritable: true,
      })),
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data: Buffer.from(SPONSORED_GAME_DISCRIMINATORS.purchaseStars),
  });
}

function sessionAccountInfo(args: {
  authority: PublicKey;
  actor: PublicKey;
  paymaster: PublicKey;
  validUntil: number;
  target?: PublicKey;
}) {
  const data = Buffer.alloc(SESSION_TOKEN_V2_ACCOUNT_BYTES);
  Buffer.from(SESSION_TOKEN_V2_DISCRIMINATOR).copy(data, 0);
  args.authority.toBuffer().copy(data, 8);
  (args.target ?? ZKUBE_PROGRAM_ID).toBuffer().copy(data, 40);
  args.actor.toBuffer().copy(data, 72);
  args.paymaster.toBuffer().copy(data, 104);
  data.writeBigInt64LE(BigInt(args.validUntil), 136);
  return {
    data,
    owner: SESSION_KEYS_PROGRAM_ID,
    executable: false,
    lamports: 1,
    rentEpoch: 0,
  };
}

function relayConnection(infos: unknown[]): Connection {
  return {
    getGenesisHash: vi.fn().mockResolvedValue(SOLANA_DEVNET_GENESIS_HASH),
    getMultipleAccountsInfo: vi.fn().mockResolvedValue(infos),
    simulateTransaction: vi.fn().mockResolvedValue({ value: { err: null } }),
    sendRawTransaction: vi.fn().mockResolvedValue("devnet-signature"),
  } as unknown as Connection;
}
