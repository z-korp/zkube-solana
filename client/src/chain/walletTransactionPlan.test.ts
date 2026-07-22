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
import { IDL } from "./idl";
import {
  deriveMapCatalogPda,
  derivePlayerFundingPda,
  derivePlayerStatePda,
  deriveProtocolConfigPda,
  deriveRunAddresses,
} from "./pdas";
import {
  compileWalletTransactionPlan,
  WALLET_TRANSACTION_COMPUTE_UNIT_LIMIT,
  withPinnedWalletComputeBudget,
  zkubeProgram,
  type TransactionPlan,
} from "./runPlan";
import { SessionWallet } from "./sessionWallet";
import { DEVICE_SESSION_RENEWAL_ERROR_CODE } from "./deviceSessionFunding";
import { makeFakeConnection } from "@/test/mocks/connection";

describe("native SOL transaction boundaries", () => {
  it("pins one deterministic wallet compute budget without duplicating one", () => {
    const transfer = SystemProgram.transfer({
      fromPubkey: Keypair.generate().publicKey,
      toPubkey: Keypair.generate().publicKey,
      lamports: 1,
    });
    const pinned = withPinnedWalletComputeBudget([transfer]);

    expect(pinned).toHaveLength(2);
    expect(pinned[0]?.programId.equals(ComputeBudgetProgram.programId)).toBe(
      true,
    );
    expect(Buffer.from(pinned[0]!.data).readUInt8(0)).toBe(2);
    expect(Buffer.from(pinned[0]!.data).readUInt32LE(1)).toBe(
      WALLET_TRANSACTION_COMPUTE_UNIT_LIMIT,
    );
    expect(withPinnedWalletComputeBudget(pinned)).toEqual(pinned);
  });

  it("exposes no generic vault signer: funded prepare is pinned to owner PDAs", async () => {
    const owner = Keypair.generate().publicKey;
    const actor = new SessionWallet(Keypair.generate());
    const sessionToken = Keypair.generate().publicKey;
    const runId = 7n;
    const run = deriveRunAddresses(owner, runId);
    const instruction = await zkubeProgram({} as Connection, actor)
      .methods.fundedPrepareCampaignRun(new BN(runId.toString()), 1, 1)
      .accountsPartial({
        protocol: deriveProtocolConfigPda(),
        playerState: derivePlayerStatePda(owner),
        mapCatalog: deriveMapCatalogPda(1, 1),
        activeRun: run.activeRun,
        playerFunding: derivePlayerFundingPda(owner),
        ownerAuthority: owner,
        sessionToken,
        actor: actor.publicKey,
        systemProgram: SystemProgram.programId,
        zkubeProgram: ZKUBE_PROGRAM_ID,
      })
      .instruction();

    const funding = instruction.keys.find((key) =>
      key.pubkey.equals(derivePlayerFundingPda(owner)),
    );
    const signers = instruction.keys.filter((key) => key.isSigner);
    const zkubeProgramMeta = instruction.keys.at(-1);
    expect(funding).toMatchObject({ isSigner: false, isWritable: true });
    expect(signers).toHaveLength(1);
    expect(signers[0]?.pubkey.equals(actor.publicKey)).toBe(true);
    expect(zkubeProgramMeta?.pubkey.equals(ZKUBE_PROGRAM_ID)).toBe(true);
    expect(zkubeProgramMeta).toMatchObject({
      isSigner: false,
      isWritable: false,
    });
    expect(instruction.keys.map(({ pubkey }) => pubkey.toBase58())).toEqual(
      [
        deriveProtocolConfigPda(),
        derivePlayerStatePda(owner),
        deriveMapCatalogPda(1, 1),
        run.activeRun,
        derivePlayerFundingPda(owner),
        owner,
        sessionToken,
        actor.publicKey,
        SystemProgram.programId,
        ZKUBE_PROGRAM_ID,
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

  it("funds delegation rent only from the canonical player PDA", async () => {
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
      .methods.fundedDelegateActiveRun()
      .accountsPartial({
        bufferPda: buffer,
        delegationRecordPda: record,
        delegationMetadataPda: metadata,
        pda: run.activeRun,
        playerFunding: derivePlayerFundingPda(owner),
        ownerAuthority: owner,
        sessionToken,
        actor: actor.publicKey,
        ownerProgram: ZKUBE_PROGRAM_ID,
        delegationProgram: DELEGATION_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts([
        { pubkey: validator, isSigner: false, isWritable: false },
      ])
      .instruction();

    expect(instruction.keys.filter(({ isSigner }) => isSigner)).toEqual([
      expect.objectContaining({ pubkey: actor.publicKey }),
    ]);
    expect(instruction.keys.map(({ pubkey }) => pubkey.toBase58())).toEqual(
      [
        buffer,
        record,
        metadata,
        run.activeRun,
        derivePlayerFundingPda(owner),
        owner,
        sessionToken,
        actor.publicKey,
        ZKUBE_PROGRAM_ID,
        DELEGATION_PROGRAM_ID,
        SystemProgram.programId,
        validator,
      ].map((publicKey) => publicKey.toBase58()),
    );
    expect(instruction.keys[4]).toMatchObject({
      isSigner: false,
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
    const transferInstruction = signed.message.compiledInstructions[1]!;
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
    expect(transferProgram?.equals(SystemProgram.programId)).toBe(true);
    expect(signed.message.compiledInstructions).toHaveLength(2);
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
      .fundedPrepareCampaignRun(new BN(1), 1, 1)
      .accountsPartial({
        protocol: deriveProtocolConfigPda(),
        playerState: derivePlayerStatePda(owner),
        mapCatalog: deriveMapCatalogPda(1, 1),
        activeRun: run.activeRun,
        playerFunding: derivePlayerFundingPda(owner),
        ownerAuthority: owner,
        sessionToken,
        actor: actor.publicKey,
        systemProgram: SystemProgram.programId,
        zkubeProgram: ZKUBE_PROGRAM_ID,
      })
      .instruction();
    const delegate = await program.methods
      .fundedDelegateActiveRun()
      .accountsPartial({
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
        playerFunding: derivePlayerFundingPda(owner),
        ownerAuthority: owner,
        sessionToken,
        actor: actor.publicKey,
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

    expect(message.compiledInstructions).toHaveLength(3);
    expect(message.header.numRequiredSignatures).toBe(1);
    expect(serialized.byteLength).toBeLessThanOrEqual(1_232);
  });
});

describe("run transaction funding preflight", () => {
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
