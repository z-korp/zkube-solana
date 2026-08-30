// @vitest-environment node

import { Schema } from "effect";
import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import { IdentityState, SessionState } from "../views";
import {
  projectSolanaIdentityState,
  projectSolanaSessionState,
} from "./SolanaIdentitySessionLive";

describe("Solana Identity and Session projections", () => {
  it("solana_backend_projects_every_view_field", () => {
    const owner = Keypair.generate().publicKey.toBase58();
    const identity = projectSolanaIdentityState({
      address: owner,
      label: "Seeker_7",
      wallet: {
        id: "wallet-standard:test",
        name: "Test Wallet",
        platform: "browser",
      },
    });
    const session = projectSolanaSessionState({
      validUntil: 2_000_000,
      floatLamports: 5_000_000,
      nowUnix: 1_000_000,
    });

    expect(Schema.decodeUnknownSync(IdentityState)(identity)).toEqual(identity);
    expect(Schema.decodeUnknownSync(SessionState)(session)).toEqual(session);
    expect(Object.keys(identity).sort()).toEqual(
      ["address", "label", "status", "wallet"].sort(),
    );
    expect(Object.keys(session).sort()).toEqual(
      ["expiresAt", "floatLamports", "status"].sort(),
    );
  });

  it("projects expiring and expired session boundaries", () => {
    expect(
      projectSolanaSessionState({
        validUntil: 86_401,
        floatLamports: 1,
        nowUnix: 1,
      }).status,
    ).toBe("expiring");
    expect(
      projectSolanaSessionState({
        validUntil: 60,
        floatLamports: 0,
        nowUnix: 0,
      }).status,
    ).toBe("expired");
  });
});
