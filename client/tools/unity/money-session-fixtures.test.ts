import { readFileSync, writeFileSync } from "node:fs";
import { expect, test, vi } from "vitest";
import { VersionedTransaction } from "@solana/web3.js";
import { resolve } from "node:path";
import { repositoryRoot } from "./solana-fixtures";
import { generatedMoneySessionData, generateMoneySessionFixtures, moneySessionDataPath, moneySessionFixturePath } from "./money-session-fixtures";
test("finite session evidence uses canonical signed plans and actual session inspection", async () => {
  const network = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("No network in synthetic evidence producer"); });
  try {
    const fixture = await generateMoneySessionFixtures();
    const overview = JSON.parse(readFileSync(resolve(repositoryRoot, "fixtures/unity-money-overview-v1.json"), "utf8"));
    const profile = overview.scenarios.find((row: { id: string }) => row.id === "owner-overview").baseAccounts[3];
    const json = JSON.stringify(fixture, null, 2) + "\n", data = generatedMoneySessionData(fixture);
    expect(JSON.stringify(await generateMoneySessionFixtures(), null, 2) + "\n").toBe(json);
    expect(fixture.scenarios.map(row => row.id)).toEqual(["session-enable-success", "session-enable-pending-failure", "session-refill-success", "session-current",
      "session-disable-pending-success", "session-disable-zero", "session-owner-decline", "session-fee-shortage", "session-renew-expired"]);
    for (const row of fixture.scenarios) {
      expect(row.before.find(account => account.address === profile.address)).toEqual(profile);
      expect(row.after.find(account => account.address === profile.address)).toEqual(profile);
      if (row.transaction) {
        const tx = VersionedTransaction.deserialize(Buffer.from(row.transaction.signed, "base64"));
        expect(Buffer.from(tx.message.serialize()).toString("base64")).toBe(row.transaction.message);
        expect(tx.signatures.every(signature => signature.some(byte => byte !== 0))).toBe(true);
      }
      if (row.expectedAfter && !row.ownerDeclines && !row.failure && row.id !== "session-fee-shortage") expect(row.expectedAfter.funding).toBe("ready");
    }
    expect(fixture.scenarios.find(row => row.id === "session-refill-success")!.expectedBefore!.action).toBe("refill");
    expect(fixture.scenarios.find(row => row.id === "session-renew-expired")!.expectedBefore!.action).toBe("renew");
    expect(fixture.scenarios.find(row => row.id === "session-disable-zero")!.transaction).toBeNull();
    if (process.env.ZKUBE_WRITE_UNITY_FIXTURES === "1") { writeFileSync(moneySessionFixturePath, json); writeFileSync(moneySessionDataPath, data); }
    expect(readFileSync(moneySessionFixturePath, "utf8")).toBe(json); expect(readFileSync(moneySessionDataPath, "utf8")).toBe(data);
    expect(network).not.toHaveBeenCalled();
  } finally { network.mockRestore(); }
});
