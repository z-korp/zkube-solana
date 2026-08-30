// @vitest-environment node

import BN from "bn.js";
import {
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  delegationMetadataPdaFromDelegatedAccount,
  delegationRecordPdaFromDelegatedAccount,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import {
  ComputeBudgetProgram,
  Keypair,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
  type Connection,
} from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";

import { DELEGATION_PROGRAM_ID, ZKUBE_PROGRAM_ID } from "./constants";
import { IDL } from "../backend/solana/idl";
import {
  deriveArcadeConfigPda,
  deriveArenaDailyPda,
  deriveArenaPlayerPda,
  deriveCreditVaultPda,
  deriveMapCatalogPda,
  derivePlayerStatePda,
  deriveProtocolConfigPda,
  deriveRunAddresses,
} from "./pdas";
import {
  combinePreparedAndDelegatePlan,
  compileWalletTransactionPlan,
  WALLET_TRANSACTION_COMPUTE_UNIT_LIMIT,
  WALLET_TRANSACTION_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS,
  withPinnedWalletComputeBudget,
  zkubeProgram,
  type TransactionPlan,
} from "./runPlan";
import { SessionWallet } from "./sessionWallet";
import { deriveSessionTokenV2Pda } from "./sessionV2";
import * as router from "./router";
import { DEVICE_SESSION_RENEWAL_ERROR_CODE } from "./deviceSessionFunding";
import { makeFakeConnection } from "@/test/mocks/connection";

describe("native SOL transaction boundaries", () => {
  it("pins a complete deterministic wallet compute budget", () => {
    const transfer = SystemProgram.transfer({
      fromPubkey: Keypair.generate().publicKey,
      toPubkey: Keypair.generate().publicKey,
      lamports: 1,
    });
    const pinned = withPinnedWalletComputeBudget([transfer]);

    expect(pinned).toHaveLength(3);
    expect(pinned[0]?.programId.equals(ComputeBudgetProgram.programId)).toBe(
      true,
    );
    expect(Buffer.from(pinned[0]!.data).readUInt8(0)).toBe(2);
    expect(Buffer.from(pinned[0]!.data).readUInt32LE(1)).toBe(
      WALLET_TRANSACTION_COMPUTE_UNIT_LIMIT,
    );
    expect(pinned[1]?.programId.equals(ComputeBudgetProgram.programId)).toBe(
      true,
    );
    expect(Buffer.from(pinned[1]!.data).readUInt8(0)).toBe(3);
    expect(Buffer.from(pinned[1]!.data).readBigUInt64LE(1)).toBe(
      BigInt(WALLET_TRANSACTION_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS),
    );
    expect(withPinnedWalletComputeBudget(pinned)).toEqual(pinned);
  });

  it("adds a missing price without duplicating an existing limit", () => {
    const limit = ComputeBudgetProgram.setComputeUnitLimit({ units: 250_000 });
    const transfer = SystemProgram.transfer({
      fromPubkey: Keypair.generate().publicKey,
      toPubkey: Keypair.generate().publicKey,
      lamports: 1,
    });
    const pinned = withPinnedWalletComputeBudget([limit, transfer]);

    expect(pinned).toHaveLength(3);
    expect(Buffer.from(pinned[0]!.data).readUInt8(0)).toBe(2);
    expect(Buffer.from(pinned[0]!.data).readUInt32LE(1)).toBe(250_000);
    expect(Buffer.from(pinned[1]!.data).readUInt8(0)).toBe(3);
  });

  it("makes the device signer the campaign run payer", async () => {
    const owner = Keypair.generate().publicKey;
    const actor = new SessionWallet(Keypair.generate());
    const sessionToken = Keypair.generate().publicKey;
    const runId = 7n;
    const run = deriveRunAddresses(owner, runId);
    const instruction = await zkubeProgram({} as Connection, actor)
      .methods.prepareCampaignRun(new BN(runId.toString()), 1, 1)
      .accountsPartial({
        protocol: deriveProtocolConfigPda(),
        playerState: derivePlayerStatePda(owner),
        mapCatalog: deriveMapCatalogPda(1, 1),
        activeRun: run.activeRun,
        payer: actor.publicKey,
        ownerAuthority: owner,
        sessionToken,
        actor: actor.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    const signers = instruction.keys.filter((key) => key.isSigner);
    expect(signers).toHaveLength(2);
    expect(signers.every(({ pubkey }) => pubkey.equals(actor.publicKey))).toBe(
      true,
    );
    expect(instruction.keys.map(({ pubkey }) => pubkey.toBase58())).toEqual(
      [
        deriveProtocolConfigPda(),
        derivePlayerStatePda(owner),
        deriveMapCatalogPda(1, 1),
        run.activeRun,
        actor.publicKey,
        owner,
        sessionToken,
        actor.publicKey,
        SystemProgram.programId,
      ].map((publicKey) => publicKey.toBase58()),
    );
  });

  it("pins every funded self-CPI wrapper to the executable zKube program", () => {
    const fundedInstructions = IDL.instructions
      .map((instruction) => instruction.name as string)
      .filter((name) => name.startsWith("funded_"));

    expect(fundedInstructions.length).toBeGreaterThan(0);

    for (const name of fundedInstructions) {
      const instruction = IDL.instructions.find(
        (candidate) => (candidate.name as string) === name,
      );
      const zkubeProgramMeta = instruction?.accounts.find((account) =>
        ["zkube_program", "owner_program"].includes(account.name as string),
      );
      expect(zkubeProgramMeta, name).toMatchObject({
        address: ZKUBE_PROGRAM_ID.toBase58(),
      });
      expect(zkubeProgramMeta, name).not.toHaveProperty("writable", true);
      expect(zkubeProgramMeta, name).not.toHaveProperty("signer", true);
    }
  });

  it("omits sealing and retired funded claim wrappers from the public ABI", () => {
    const instructionNames = new Set(
      IDL.instructions.map((instruction) => instruction.name as string),
    );
    expect(instructionNames.has("seal_run")).toBe(false);
    expect(instructionNames.has("funded_claim_quest")).toBe(false);
    expect(instructionNames.has("funded_claim_level_milestone")).toBe(false);
    expect(instructionNames.has("activate_content_release")).toBe(true);
  });

  it("funds delegation rent from the device signer", async () => {
    const owner = Keypair.generate().publicKey;
    const actor = new SessionWallet(Keypair.generate());
    const sessionToken = Keypair.generate().publicKey;
    const run = deriveRunAddresses(owner, 7n);
    const validator = Keypair.generate().publicKey;
    const buffer = delegateBufferPdaFromDelegatedAccountAndOwnerProgram(
      run.activeRun,
      ZKUBE_PROGRAM_ID,
    );
    const record = delegationRecordPdaFromDelegatedAccount(run.activeRun);
    const metadata = delegationMetadataPdaFromDelegatedAccount(run.activeRun);
    const instruction = await zkubeProgram({} as Connection, actor)
      .methods.delegateActiveRun()
      .accountsPartial({
        payer: actor.publicKey,
        ownerAuthority: owner,
        sessionToken,
        actor: actor.publicKey,
        bufferPda: buffer,
        delegationRecordPda: record,
        delegationMetadataPda: metadata,
        pda: run.activeRun,
        ownerProgram: ZKUBE_PROGRAM_ID,
        delegationProgram: DELEGATION_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts([
        { pubkey: validator, isSigner: false, isWritable: false },
      ])
      .instruction();

    const signerMetas = instruction.keys.filter(({ isSigner }) => isSigner);
    expect(signerMetas).toHaveLength(2);
    expect(signerMetas.every(({ pubkey }) => pubkey.equals(actor.publicKey)))
      .toBe(true);
    expect(instruction.keys.map(({ pubkey }) => pubkey.toBase58())).toEqual(
      [
        actor.publicKey,
        owner,
        sessionToken,
        actor.publicKey,
        buffer,
        record,
        metadata,
        run.activeRun,
        ZKUBE_PROGRAM_ID,
        DELEGATION_PROGRAM_ID,
        SystemProgram.programId,
        validator,
      ].map((publicKey) => publicKey.toBase58()),
    );
    expect(instruction.keys[0]).toMatchObject({
      isSigner: true,
      isWritable: true,
    });
    expect(instruction.keys.at(-1)).toMatchObject({
      isSigner: false,
      isWritable: false,
    });
  });

  it("preserves a real device signature through v0 serialization", async () => {
    const signer = Keypair.generate();
    const wallet = new SessionWallet(signer);
    const connection = makeFakeConnection({
      getLatestBlockhash: vi.fn().mockResolvedValue({
        blockhash: Keypair.generate().publicKey.toBase58(),
        lastValidBlockHeight: 1,
      }),
    });
    const transactionPlan: TransactionPlan = {
      layer: "solana-base",
      label: "signed fixture",
      connection,
      transaction: new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: signer.publicKey,
          toPubkey: Keypair.generate().publicKey,
          lamports: 1,
        }),
      ),
      feePayer: signer.publicKey,
      signers: [],
    };
    const signed = await compileWalletTransactionPlan({
      transactionPlan,
      wallet,
    });
    const restored = VersionedTransaction.deserialize(signed.serialize());
    const computeInstruction = signed.message.compiledInstructions[0]!;
    const priceInstruction = signed.message.compiledInstructions[1]!;
    const transferInstruction = signed.message.compiledInstructions[2]!;
    const computeProgram =
      signed.message.staticAccountKeys[computeInstruction.programIdIndex];
    const transferProgram =
      signed.message.staticAccountKeys[transferInstruction.programIdIndex];

    expect(signed.message.header.numRequiredSignatures).toBe(1);
    expect(computeProgram?.equals(ComputeBudgetProgram.programId)).toBe(true);
    expect(Buffer.from(computeInstruction.data).readUInt8(0)).toBe(2);
    expect(Buffer.from(computeInstruction.data).readUInt32LE(1)).toBe(
      WALLET_TRANSACTION_COMPUTE_UNIT_LIMIT,
    );
    expect(Buffer.from(priceInstruction.data).readUInt8(0)).toBe(3);
    expect(Buffer.from(priceInstruction.data).readBigUInt64LE(1)).toBe(
      BigInt(WALLET_TRANSACTION_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS),
    );
    expect(transferProgram?.equals(SystemProgram.programId)).toBe(true);
    expect(signed.message.compiledInstructions).toHaveLength(3);
    expect([...signed.signatures[0]!].some((byte) => byte !== 0)).toBe(true);
    expect(Buffer.from(restored.message.serialize())).toEqual(
      Buffer.from(signed.message.serialize()),
    );
    expect(Buffer.from(restored.signatures[0]!)).toEqual(
      Buffer.from(signed.signatures[0]!),
    );
  });

  it("fits atomic prepare plus delegation in one v0 packet", async () => {
    const owner = Keypair.generate().publicKey;
    const actor = new SessionWallet(Keypair.generate());
    const sessionToken = Keypair.generate().publicKey;
    const run = deriveRunAddresses(owner, 1n);
    const program = zkubeProgram({} as Connection, actor);
    const prepare = await program.methods
      .prepareCampaignRun(new BN(1), 1, 1)
      .accountsPartial({
        protocol: deriveProtocolConfigPda(),
        playerState: derivePlayerStatePda(owner),
        mapCatalog: deriveMapCatalogPda(1, 1),
        activeRun: run.activeRun,
        payer: actor.publicKey,
        ownerAuthority: owner,
        sessionToken,
        actor: actor.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    const delegate = await program.methods
      .delegateActiveRun()
      .accountsPartial({
        payer: actor.publicKey,
        ownerAuthority: owner,
        sessionToken,
        actor: actor.publicKey,
        bufferPda: delegateBufferPdaFromDelegatedAccountAndOwnerProgram(
          run.activeRun,
          ZKUBE_PROGRAM_ID,
        ),
        delegationRecordPda: delegationRecordPdaFromDelegatedAccount(
          run.activeRun,
        ),
        delegationMetadataPda: delegationMetadataPdaFromDelegatedAccount(
          run.activeRun,
        ),
        pda: run.activeRun,
        ownerProgram: ZKUBE_PROGRAM_ID,
        delegationProgram: DELEGATION_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts([
        {
          pubkey: Keypair.generate().publicKey,
          isSigner: false,
          isWritable: false,
        },
      ])
      .instruction();
    const message = new TransactionMessage({
      payerKey: actor.publicKey,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
      instructions: withPinnedWalletComputeBudget([prepare, delegate]),
    }).compileToV0Message();
    const serialized = new VersionedTransaction(message).serialize();

    expect(message.compiledInstructions).toHaveLength(4);
    expect(message.header.numRequiredSignatures).toBe(1);
    expect(serialized.byteLength).toBeLessThanOrEqual(1_232);
  });

  it("lets the device spend a Kredit, pay fees, and delegate without an owner signature", async () => {
    const owner = Keypair.generate();
    const session = Keypair.generate();
    const sessionToken = deriveSessionTokenV2Pda({
      authority: owner.publicKey,
      sessionSigner: session.publicKey,
    }).sessionToken;
    const addresses = deriveRunAddresses(owner.publicKey, 1n);
    const connection = makeFakeConnection({
      getBalance: vi.fn().mockResolvedValue(5_000_000),
      getMinimumBalanceForRentExemption: vi.fn().mockResolvedValue(890_880),
    });
    vi.spyOn(router, "getClosestValidator").mockResolvedValueOnce({
      identity: Keypair.generate().publicKey,
    });
    const currentDaily = deriveArenaDailyPda(20);
    const enterArena = await zkubeProgram(connection, new SessionWallet(session))
      .methods.enterArena(new BN(1), new BN(10_000_000), [])
      .accountsPartial({
        protocol: deriveProtocolConfigPda(),
        arcadeConfig: deriveArcadeConfigPda(),
        playerState: derivePlayerStatePda(owner.publicKey),
        currentDaily,
        arenaPlayer: deriveArenaPlayerPda(currentDaily, owner.publicKey),
        followingDaily: deriveArenaDailyPda(21),
        creditVault: deriveCreditVaultPda(),
        activeRun: addresses.activeRun,
        payer: session.publicKey,
        ownerAuthority: owner.publicKey,
        sessionToken,
        actor: session.publicKey,
        systemProgram: SystemProgram.programId,
        zkubeProgram: ZKUBE_PROGRAM_ID,
      })
      .instruction();
    const prepared = {
      runId: 1n,
      addresses,
      sessionToken,
      sessionValidUntil: 1_800_000_000,
      transactionPlan: {
        layer: "solana-base" as const,
        label: "Enter Arena · spend 1 Kredit + network fee",
        connection,
        transaction: new Transaction().add(enterArena),
        feePayer: session.publicKey,
        signers: [],
      },
    };

    const combined = await combinePreparedAndDelegatePlan({
      prepared,
      ownerAuthority: owner.publicKey,
      sessionToken,
      sessionSigner: session,
    });
    const delegate = combined.transactionPlan.transaction.instructions[1]!;

    expect(combined.transactionPlan.feePayer.equals(session.publicKey)).toBe(
      true,
    );
    expect(combined.transactionPlan.signers).toEqual([session]);
    expect(delegate.keys[1]?.pubkey.equals(owner.publicKey)).toBe(true);
    expect(delegate.keys[2]?.pubkey.equals(sessionToken)).toBe(true);
    expect(delegate.keys[3]).toMatchObject({
      pubkey: session.publicKey,
      isSigner: true,
    });

    const signed = await compileWalletTransactionPlan({
      transactionPlan: combined.transactionPlan,
      wallet: new SessionWallet(session),
    });
    const requiredSigners = signed.message.staticAccountKeys.slice(
      0,
      signed.message.header.numRequiredSignatures,
    );
    expect(requiredSigners).toEqual([session.publicKey]);
    expect(signed.message.compiledInstructions).toHaveLength(4);
    expect(signed.serialize().byteLength).toBeLessThanOrEqual(1_232);
    expect(
      signed.signatures.every((signature) =>
        [...signature].some((byte) => byte !== 0),
      ),
    ).toBe(true);
  });

  it("rejects an owner approval when the device fee-payer signature is missing", async () => {
    const owner = Keypair.generate();
    const device = Keypair.generate();
    const transactionPlan: TransactionPlan = {
      layer: "solana-base",
      label: "unsigned device fee payer",
      connection: makeFakeConnection(),
      transaction: new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: owner.publicKey,
          toPubkey: Keypair.generate().publicKey,
          lamports: 20_000_000,
        }),
      ),
      feePayer: device.publicKey,
      signers: [],
    };

    await expect(
      compileWalletTransactionPlan({
        transactionPlan,
        wallet: new SessionWallet(owner),
      }),
    ).rejects.toThrow(
      `Missing partial signature for required signer ${device.publicKey.toBase58()}`,
    );
  });
});

describe("run transaction funding preflight", () => {
  it("does not call the owner wallet when unsigned deterministic simulation fails", async () => {
    const owner = Keypair.generate();
    const device = Keypair.generate();
    const signTransaction = vi.fn();
    const simulation = vi.fn().mockResolvedValue({
      value: { err: { InstructionError: [2, { Custom: 3012 }] } },
    });
    const connection = makeFakeConnection({
      simulateTransaction: simulation,
    });
    const transactionPlan: TransactionPlan = {
      layer: "solana-base",
      label: "Prepare and delegate active run",
      connection,
      transaction: new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: owner.publicKey,
          toPubkey: Keypair.generate().publicKey,
          lamports: 20_000_000,
        }),
      ),
      feePayer: device.publicKey,
      signers: [device],
    };

    await expect(
      compileWalletTransactionPlan({
        transactionPlan,
        wallet: {
          publicKey: owner.publicKey,
          signTransaction,
          signAllTransactions: vi.fn(),
        },
      }),
    ).rejects.toThrow(
      "Preflight failed before wallet signature for Prepare and delegate active run",
    );
    expect(simulation).toHaveBeenCalledOnce();
    expect(simulation).toHaveBeenCalledWith(expect.any(VersionedTransaction), {
      sigVerify: false,
      replaceRecentBlockhash: false,
    });
    expect(signTransaction).not.toHaveBeenCalled();
  });

  it("rejects a low device signer before simulation", async () => {
    const signer = Keypair.generate();
    const simulation = vi.fn();
    const connection = makeFakeConnection({
      getLatestBlockhash: vi.fn().mockResolvedValue({
        blockhash: Keypair.generate().publicKey.toBase58(),
      }),
      getFeeForMessage: vi.fn().mockResolvedValue({ value: 5_000 }),
      getBalance: vi.fn().mockResolvedValue(900_879),
      getMinimumBalanceForRentExemption: vi.fn().mockResolvedValue(890_880),
      simulateTransaction: simulation,
    });
    const transactionPlan: TransactionPlan = {
      layer: "solana-base",
      label: "Prepare and delegate active run",
      connection,
      transaction: new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: signer.publicKey,
          toPubkey: Keypair.generate().publicKey,
          lamports: 0,
        }),
      ),
      feePayer: signer.publicKey,
      signers: [],
      postFeeRentReserveLamports: 5_000,
    };

    await expect(
      compileWalletTransactionPlan({
        transactionPlan,
        wallet: new SessionWallet(signer),
      }),
    ).rejects.toThrow(DEVICE_SESSION_RENEWAL_ERROR_CODE);
    expect(simulation).not.toHaveBeenCalled();
  });
});
