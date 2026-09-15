import { readFileSync, writeFileSync } from "node:fs";
import { expect, test, vi } from "vitest";
import { VersionedTransaction, PublicKey } from "@solana/web3.js";
import { BorshAccountsCoder, convertIdlToCamelCase } from "@anchor-lang/core";
import { IDL } from "../../src/backend/solana/idl";
import { deriveArenaBoardPda, deriveArenaDailyPda, derivePlayerStatePda } from "../../src/backend/solana/pdas";
import { generateMoneyClaimFixtures, generatedMoneyClaimData, moneyClaimFixturePath, moneyClaimDataPath } from "./money-claim-fixtures";
import { DAILY_REWARD_CLAIM_WINDOW_SECONDS } from "../../src/core/protocolVersions.generated";
import { generateEconomyFixtures } from "./economy-fixtures";
import { resolve } from "node:path";

test("finite claims use the device signer, independent windows and native payout/point values", async () => {
  const network = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("No network in claim fixtures"); });
  try {
    // Keep the existing executor regression on a protocol-valid finalized Daily.
    const economy = await generateEconomyFixtures();
    expect(await generateEconomyFixtures()).toEqual(economy);
    if (process.env.ZKUBE_ECONOMY_FIXTURE_PATH) {
      const bytes = JSON.stringify(economy, null, 2) + "\n";
      if (process.env.ZKUBE_WRITE_UNITY_FIXTURES === "1") writeFileSync(resolve(process.env.ZKUBE_ECONOMY_FIXTURE_PATH), bytes);
      expect(readFileSync(resolve(process.env.ZKUBE_ECONOMY_FIXTURE_PATH), "utf8")).toBe(bytes);
    }
    const value = await generateMoneyClaimFixtures(); expect(await generateMoneyClaimFixtures()).toEqual(value);
    const coder = new BorshAccountsCoder(convertIdlToCamelCase(IDL));
    expect(value.scenarios).toHaveLength(18);
    for (const row of value.scenarios) {
      const transaction = VersionedTransaction.deserialize(Buffer.from(row.transaction.signed, "base64"));
      expect(transaction.message.header.numRequiredSignatures).toBe(1);
      expect(transaction.message.staticAccountKeys[0]!.toBase58()).toBe(row.transaction.feePayer);
      expect(row.transaction.feePayer).not.toBe(value.inputs.owner);
      expect(row.transaction.ownerRequired).toBe(false);
      expect(row.points).toBe(row.kind === "score" ? 170 : 135);
      expect(BigInt(row.amountLamports)).toBeGreaterThan(0n);
      const succeeds = (row.variant === "sealed" || row.variant === "deadline") && !row.failure;
      const address = derivePlayerStatePda(new PublicKey(value.inputs.owner)).toBase58();
      const field = (rows: Array<{ address: string; data: string }>) => coder.decode("playerState", Buffer.from(rows.find(item => item.address === address)!.data, "base64"));
      const before = field(row.before), after = field(row.after);
      expect(after.kreditBalance.toString()).toBe(before.kreditBalance.toString());
      expect(after.campaignStars).toEqual(before.campaignStars);
      expect(after.lifetimePaidEntries.toString()).toBe(before.lifetimePaidEntries.toString());
      expect(after.entryStreakDays).toBe(before.entryStreakDays);
      expect(after.ladderPoints.sub(before.ladderPoints).toNumber()).toBe(succeeds ? row.points : 0);
      const peer = deriveArenaBoardPda(deriveArenaDailyPda(row.day), row.kind === "score" ? "theme" : "score").toBase58();
      expect(row.after.find((item: { address: string }) => item.address === peer)).toEqual(row.before.find((item: { address: string }) => item.address === peer));
      const target = deriveArenaBoardPda(deriveArenaDailyPda(row.day), row.kind).toBase58();
      const header = (address: string) => coder.decode("arenaBoard", Buffer.from(row.before.find((item: { address: string }) => item.address === address).data, "base64"));
      const expiry = header(target).sealedAt.toNumber() + DAILY_REWARD_CLAIM_WINDOW_SECONDS;
      expect(header(peer).sealedAt.toNumber() + DAILY_REWARD_CLAIM_WINDOW_SECONDS).toBeGreaterThan(value.inputs.now);
      if (row.variant === "deadline") expect(expiry).toBe(value.inputs.now);
      if (row.variant === "expired") expect(expiry).toBe(value.inputs.now - 1);
      if (row.variant === "unsealed") expect(header(target).sealed).toBe(false);
      if (succeeds) expect(BigInt(row.expectedAfter.ownerLamports) - BigInt(row.expectedBefore.ownerLamports)).toBe(BigInt(row.amountLamports));
      else expect(row.after).toEqual(row.before);
      // Day age does not close a recently sealed reward's independent window.
      expect(Math.floor(value.inputs.now / 86400) - row.day).toBeGreaterThan(30);
    }
    expect(network).not.toHaveBeenCalled();
    const json = JSON.stringify(value, null, 2) + "\n", data = generatedMoneyClaimData(value);
    if (process.env.ZKUBE_WRITE_UNITY_FIXTURES === "1") { writeFileSync(moneyClaimFixturePath, json); writeFileSync(moneyClaimDataPath, data); }
    expect(readFileSync(moneyClaimFixturePath, "utf8")).toBe(json);
    expect(readFileSync(moneyClaimDataPath, "utf8")).toBe(data);
  } finally { network.mockRestore(); }
});
