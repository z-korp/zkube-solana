// @vitest-environment node

import { Connection, Keypair } from "@solana/web3.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deriveRunAddresses } from "./pdas";
import { resolvePersistedRun } from "./resumeRun";
import { loadRunSession, saveRunSession } from "./runSessionStore";
import { deriveSessionTokenV2Pda } from "./sessionV2";
import { SessionWallet } from "./sessionWallet";
import { DELEGATION_PROGRAM_ID, ZKUBE_PROGRAM_ID } from "./constants";

describe("persisted run resolution", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { localStorage: new MemoryStorage() },
    });
  });

  it("discovers the durable active run on a different device", async () => {
    const owner = Keypair.generate();
    const deviceSigner = Keypair.generate();
    const sessionToken = deriveSessionTokenV2Pda({
      authority: owner.publicKey,
      sessionSigner: deviceSigner.publicKey,
    }).sessionToken;
    const deviceSession = {
      owner: owner.publicKey,
      signer: deviceSigner,
      sessionToken,
      validUntil: Math.floor(Date.now() / 1_000) + 3_600,
      createdAt: Math.floor(Date.now() / 1_000),
    };
    const baseConnection = {
      getAccountInfo: vi.fn().mockResolvedValue({ data: new Uint8Array([1]) }),
    } as unknown as Connection;
    const erConnection = {
      getAccountInfo: vi.fn().mockResolvedValue({ owner: ZKUBE_PROGRAM_ID }),
    } as unknown as Connection;
    const getStatus = vi.fn().mockResolvedValue({
      isDelegated: true,
      fqdn: "https://er.example/",
      delegationRecord: { owner: ZKUBE_PROGRAM_ID.toBase58() },
    });
    const fetchRun = vi.fn().mockResolvedValue({
      owner: owner.publicKey,
      runId: 12n,
      mode: "daily",
      lifecycle: "playing",
      score: 4,
      actionCounter: 2,
      moves: 2,
      grid: new Array(80).fill(0),
      nextRow: new Array(8).fill(0),
      pendingVrfCounter: 0,
    });

    const result = await resolvePersistedRun({
      owner: owner.publicKey,
      wallet: new SessionWallet(owner),
      baseConnection,
      deviceSession,
      dependencies: {
        fetchActiveRunId: vi.fn().mockResolvedValue(12n),
        getStatus,
        makeErConnection: () => erConnection,
        fetchRun,
      },
    });

    expect(result.phase).toBe("delegated");
    expect(result.phase === "delegated" && result.marker.runId).toBe(12n);
    expect(result.phase === "delegated" && result.marker.mode).toBe("daily");
    expect(result.phase === "delegated" && result.sessionAuthorized).toBe(true);
    expect(loadRunSession(owner.publicKey)?.session.publicKey.equals(deviceSigner.publicKey))
      .toBe(true);
  });

  it("discovers a prepared base run without a browser marker", async () => {
    const owner = Keypair.generate();
    const deviceSigner = Keypair.generate();
    const sessionToken = deriveSessionTokenV2Pda({
      authority: owner.publicKey,
      sessionSigner: deviceSigner.publicKey,
    }).sessionToken;
    const deviceSession = {
      owner: owner.publicKey,
      signer: deviceSigner,
      sessionToken,
      validUntil: Math.floor(Date.now() / 1_000) + 3_600,
      createdAt: Math.floor(Date.now() / 1_000),
    };
    const prepared = {
      owner: owner.publicKey,
      runId: 1n,
      mode: "campaign",
      lifecycle: "prepared",
      mapId: 1,
      level: 1,
      score: 0,
      actionCounter: 0,
      moves: 0,
      grid: new Array(80).fill(0),
      nextRow: new Array(8).fill(0),
      pendingVrfCounter: 0,
    };
    const baseConnection = {
      getAccountInfo: vi.fn().mockImplementation(async (address) => ({
        owner: address.equals(sessionToken)
          ? Keypair.generate().publicKey
          : ZKUBE_PROGRAM_ID,
        data: new Uint8Array([1]),
      })),
    } as unknown as Connection;
    const fetchRun = vi.fn().mockResolvedValue(prepared);

    const result = await resolvePersistedRun({
      owner: owner.publicKey,
      wallet: new SessionWallet(owner),
      baseConnection,
      deviceSession,
      dependencies: {
        fetchActiveRunId: vi.fn().mockResolvedValue(1n),
        getStatus: vi.fn().mockResolvedValue({ isDelegated: false }),
        fetchRun,
        fetchReceipt: vi.fn().mockResolvedValue(null),
      },
    });

    expect(result.phase).toBe("base");
    expect(result.phase === "base" && result.activeRun.lifecycle).toBe(
      "prepared",
    );
    expect(result.phase === "base" && result.sessionAuthorized).toBe(true);
    expect(loadRunSession(owner.publicKey)?.runId).toBe(1n);
  });

  it("re-resolves the ER and verifies the active run identity", async () => {
    const owner = Keypair.generate();
    const session = Keypair.generate();
    const marker = persist(owner, session, 9n);
    const baseConnection = {
      getAccountInfo: vi.fn().mockResolvedValue({ data: new Uint8Array([1]) }),
    } as unknown as Connection;
    const erConnection = {
      getAccountInfo: vi.fn().mockResolvedValue({ owner: ZKUBE_PROGRAM_ID }),
    } as unknown as Connection;
    const result = await resolvePersistedRun({
      owner: owner.publicKey,
      wallet: new SessionWallet(owner),
      baseConnection,
      dependencies: {
        getStatus: vi.fn().mockResolvedValue({
          isDelegated: true,
          fqdn: "https://er.example/",
        }),
        makeErConnection: () => erConnection,
        fetchRun: vi.fn().mockResolvedValue({
          owner: owner.publicKey,
          runId: 9n,
          lifecycle: "playing",
          score: 10,
          actionCounter: 1,
          moves: 1,
          grid: new Array(80).fill(0),
          nextRow: new Array(8).fill(0),
          pendingVrfCounter: 0,
        }),
      },
    });
    expect(result.phase).toBe("delegated");
    expect(
      result.phase === "delegated" &&
        result.marker.addresses.activeRun.equals(marker.addresses.activeRun),
    ).toBe(true);
    expect(result.phase === "delegated" && result.sessionAuthorized).toBe(true);
  });

  it("reattaches a near-expiry run but requires proactive session rotation", async () => {
    const owner = Keypair.generate();
    const session = Keypair.generate();
    const now = Math.floor(Date.now() / 1_000);
    const marker = persist(owner, session, 10n, now + 60);
    const baseConnection = {
      getAccountInfo: vi.fn().mockResolvedValue({ data: new Uint8Array([1]) }),
    } as unknown as Connection;
    const erConnection = {
      getAccountInfo: vi.fn().mockResolvedValue({ owner: ZKUBE_PROGRAM_ID }),
    } as unknown as Connection;

    const result = await resolvePersistedRun({
      owner: owner.publicKey,
      wallet: new SessionWallet(owner),
      baseConnection,
      dependencies: {
        getStatus: vi.fn().mockResolvedValue({
          isDelegated: true,
          fqdn: "https://er.example/",
        }),
        makeErConnection: () => erConnection,
        fetchRun: vi.fn().mockResolvedValue({
          owner: owner.publicKey,
          runId: 10n,
          lifecycle: "playing",
          score: 0,
          actionCounter: 0,
          moves: 0,
          grid: new Array(80).fill(0),
          nextRow: new Array(8).fill(0),
          pendingVrfCounter: 0,
        }),
      },
    });

    expect(result.phase).toBe("delegated");
    expect(result.phase === "delegated" && result.sessionAuthorized).toBe(
      false,
    );
    expect(
      result.phase === "delegated" &&
        result.marker.addresses.activeRun.equals(marker.addresses.activeRun),
    ).toBe(true);
    expect(baseConnection.getAccountInfo).not.toHaveBeenCalled();
  });

  it("reattaches a delegated run whose on-chain session token is missing", async () => {
    const owner = Keypair.generate();
    const session = Keypair.generate();
    persist(owner, session, 11n);
    const baseConnection = {
      getAccountInfo: vi.fn().mockResolvedValue(null),
    } as unknown as Connection;
    const erConnection = {
      getAccountInfo: vi.fn().mockResolvedValue({ owner: ZKUBE_PROGRAM_ID }),
    } as unknown as Connection;

    const result = await resolvePersistedRun({
      owner: owner.publicKey,
      wallet: new SessionWallet(owner),
      baseConnection,
      dependencies: {
        getStatus: vi.fn().mockResolvedValue({
          isDelegated: true,
          fqdn: "https://er.example/",
        }),
        makeErConnection: () => erConnection,
        fetchRun: vi.fn().mockResolvedValue({
          owner: owner.publicKey,
          runId: 11n,
          lifecycle: "playing",
          score: 0,
          actionCounter: 0,
          moves: 0,
          grid: new Array(80).fill(0),
          nextRow: new Array(8).fill(0),
          pendingVrfCounter: 0,
        }),
      },
    });

    expect(result.phase).toBe("delegated");
    expect(result.phase === "delegated" && result.sessionAuthorized).toBe(
      false,
    );
    expect(baseConnection.getAccountInfo).toHaveBeenCalledOnce();
  });

  it("falls back to a consumed base receipt after undelegation", async () => {
    const owner = Keypair.generate();
    const session = Keypair.generate();
    persist(owner, session, 4n);
    const baseConnection = {
      getAccountInfo: vi.fn().mockResolvedValue(null),
    } as unknown as Connection;
    const result = await resolvePersistedRun({
      owner: owner.publicKey,
      wallet: new SessionWallet(owner),
      baseConnection,
      dependencies: {
        getStatus: vi.fn().mockResolvedValue({ isDelegated: false }),
        fetchReceipt: vi.fn().mockResolvedValue({
          owner: owner.publicKey,
          runId: 4n,
          mode: "campaign",
          mapId: 2,
          level: 7,
          score: 100,
          moves: 5,
          levelStars: 3,
          campaignXpAwarded: 30,
          completed: true,
          consumed: true,
        }),
      },
    });
    expect(result.phase).toBe("settled");
    expect(result.phase === "settled" && result.sessionAuthorized).toBe(false);
  });

  it("rejects a delegated account that does not match the persisted epoch", async () => {
    const owner = Keypair.generate();
    const session = Keypair.generate();
    persist(owner, session, 2n);
    const result = await resolvePersistedRun({
      owner: owner.publicKey,
      wallet: new SessionWallet(owner),
      baseConnection: {
        getAccountInfo: vi.fn().mockResolvedValue({}),
      } as unknown as Connection,
      dependencies: {
        getStatus: vi
          .fn()
          .mockResolvedValue({ isDelegated: true, fqdn: "https://er.example" }),
        makeErConnection: () =>
          ({
            getAccountInfo: vi
              .fn()
              .mockResolvedValue({ owner: ZKUBE_PROGRAM_ID }),
          }) as unknown as Connection,
        fetchRun: vi.fn().mockResolvedValue({
          owner: owner.publicKey,
          runId: 3n,
          lifecycle: "playing",
          score: 0,
          actionCounter: 0,
          moves: 0,
          grid: [],
          nextRow: null,
          pendingVrfCounter: 0,
        }),
      },
    });
    expect(result.phase).toBe("missing");
  });

  it("rejects a Router endpoint serving an account owned by another program", async () => {
    const owner = Keypair.generate();
    const session = Keypair.generate();
    persist(owner, session, 5n);
    await expect(
      resolvePersistedRun({
        owner: owner.publicKey,
        wallet: new SessionWallet(owner),
        baseConnection: {
          getAccountInfo: vi.fn().mockResolvedValue({}),
        } as unknown as Connection,
        dependencies: {
          getStatus: vi.fn().mockResolvedValue({
            isDelegated: true,
            fqdn: "https://er.example",
            delegationRecord: {
              authority: Keypair.generate().publicKey.toBase58(),
              owner: ZKUBE_PROGRAM_ID.toBase58(),
              delegationSlot: 1,
              lamports: 1,
            },
          }),
          makeErConnection: () =>
            ({
              getAccountInfo: vi.fn().mockResolvedValue({
                owner: Keypair.generate().publicKey,
              }),
            }) as unknown as Connection,
        },
      }),
    ).rejects.toThrow("is not owned by zKube");
  });

  it("stays 'resolving' when the router delegated but the ER has not cloned yet", async () => {
    const owner = Keypair.generate();
    const session = Keypair.generate();
    persist(owner, session, 5n);
    const result = await resolvePersistedRun({
      owner: owner.publicKey,
      wallet: new SessionWallet(owner),
      baseConnection: {
        getAccountInfo: vi.fn().mockResolvedValue({ data: new Uint8Array([1]) }),
      } as unknown as Connection,
      dependencies: {
        getStatus: vi
          .fn()
          .mockResolvedValue({ isDelegated: true, fqdn: "https://er.example/" }),
        makeErConnection: () =>
          ({
            getAccountInfo: vi.fn().mockResolvedValue(null),
          }) as unknown as Connection,
      },
    });
    expect(result.phase).toBe("resolving");
  });

  it("stays 'resolving' when the base account is owned by the delegation program", async () => {
    const owner = Keypair.generate();
    const session = Keypair.generate();
    persist(owner, session, 6n);
    const result = await resolvePersistedRun({
      owner: owner.publicKey,
      wallet: new SessionWallet(owner),
      baseConnection: {
        getAccountInfo: vi
          .fn()
          .mockResolvedValue({ owner: DELEGATION_PROGRAM_ID }),
      } as unknown as Connection,
      dependencies: {
        getStatus: vi.fn().mockResolvedValue({ isDelegated: false }),
        fetchReceipt: vi.fn().mockResolvedValue(null),
        fetchRun: vi.fn().mockResolvedValue(null),
      },
    });
    expect(result.phase).toBe("resolving");
  });
});

function persist(
  owner: Keypair,
  session: Keypair,
  runId: bigint,
  validUntil = Math.floor(Date.now() / 1_000) + 3_600,
) {
  const marker = {
    owner: owner.publicKey,
    runId,
    mode: "campaign" as const,
    session,
    sessionToken: deriveSessionTokenV2Pda({
      authority: owner.publicKey,
      sessionSigner: session.publicKey,
    }).sessionToken,
    addresses: deriveRunAddresses(owner.publicKey, runId),
    validUntil,
    createdAt: Math.floor(Date.now() / 1_000),
  };
  saveRunSession(marker);
  return marker;
}

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}
