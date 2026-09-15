import { readFileSync, writeFileSync } from "node:fs";
import { BorshAccountsCoder, convertIdlToCamelCase } from "@anchor-lang/core";
import { expect, test, vi } from "vitest";
import { IDL } from "../../src/backend/solana/idl";
import { KREDIT_PACK_SIZES } from "../../src/config/kreditPacks";
import { PublicKey } from "@solana/web3.js";
import { derivePlayerStatePda, deriveCreditVaultPda, deriveOperatorRevenueVaultPda } from "../../src/backend/solana/pdas";
import { generateMoneyEconomyFixtures, generatedMoneyEconomyData, moneyEconomyFixturePath, moneyEconomyDataPath } from "./money-economy-fixtures";

test("finite purchases bind actual TS plans and profile reads without entry or prize awards", async () => {
  const network = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("No network in money purchase fixtures"); });
  try {
    const value = await generateMoneyEconomyFixtures();
    expect(await generateMoneyEconomyFixtures()).toEqual(value);
    const coder = new BorshAccountsCoder(convertIdlToCamelCase(IDL));
    const playerAddress = derivePlayerStatePda(new PublicKey(value.inputs.owner)).toBase58();
    const creditAddress = deriveCreditVaultPda().toBase58(), revenueAddress = deriveOperatorRevenueVaultPda().toBase58();
    for (const pack of KREDIT_PACK_SIZES) {
      const row = value.scenarios.find(row => row.id === "kredit-buy-" + pack)!;
      expect(BigInt(row.expectedAfter.kredits) - BigInt(row.expectedBefore.kredits)).toBe(BigInt(pack));
      expect({ ...row.expectedAfter, kredits: row.expectedBefore.kredits }).toEqual(row.expectedBefore);
      expect(BigInt(row.prizeReserveAdded) + BigInt(row.operatorShareAdded)).toBe(BigInt(row.priceLamports));
      const decoded = (name: string, address: string, after: boolean) => coder.decode(name, Buffer.from((after ? row.after : row.before).find(value => value.address === address)!.data, "base64"));
      const playerBefore = decoded("playerState", playerAddress, false), playerAfter = decoded("playerState", playerAddress, true);
      expect(playerAfter.kreditBalance.sub(playerBefore.kreditBalance).toString()).toBe(String(pack));
      expect(playerAfter.lifetimePaidEntries.toString()).toBe(playerBefore.lifetimePaidEntries.toString());
      expect(playerAfter.campaignStars).toEqual(playerBefore.campaignStars);
      expect(decoded("creditVault", creditAddress, true).purchasedPrizeLamports.sub(decoded("creditVault", creditAddress, false).purchasedPrizeLamports).toString()).toBe(row.prizeReserveAdded);
      expect(decoded("operatorRevenueVault", revenueAddress, true).grossOperatorShare.sub(decoded("operatorRevenueVault", revenueAddress, false).grossOperatorShare).toString()).toBe(row.operatorShareAdded);
      for (const before of row.before.filter(value => ![playerAddress, creditAddress, revenueAddress].includes(value.address)))
        expect(row.after.find(after => after.address === before.address)).toEqual(before);
    }
    for (const id of ["kredit-owner-decline", "kredit-fee-shortage", "kredit-pending-failure"])
      expect(value.scenarios.find(row => row.id === id)!.expectedAfter).toEqual(value.scenarios.find(row => row.id === id)!.expectedBefore);
    expect(network).not.toHaveBeenCalled();
    const json = JSON.stringify(value, null, 2) + "\n", data = generatedMoneyEconomyData(value);
    if (process.env.ZKUBE_WRITE_UNITY_FIXTURES === "1") { writeFileSync(moneyEconomyFixturePath, json); writeFileSync(moneyEconomyDataPath, data); }
    expect(readFileSync(moneyEconomyFixturePath, "utf8")).toBe(json);
    expect(readFileSync(moneyEconomyDataPath, "utf8")).toBe(data);
  } finally { network.mockRestore(); }
});
