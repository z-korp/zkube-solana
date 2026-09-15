import {readFileSync, writeFileSync, existsSync, mkdirSync} from "node:fs";
import {dirname} from "node:path";
import {test, expect, vi} from "vitest";
import {BorshAccountsCoder, convertIdlToCamelCase} from "@anchor-lang/core";
import {IDL} from "../../src/backend/solana/idl";
import {VersionedTransaction} from "@solana/web3.js";
import {generateMoneyProfileFixtures, generatedMoneyProfileData, moneyProfileFixturePath, moneyProfileDataPath} from "./money-profile-fixtures";

test("finite profile writes retain progression and economics and use the device", async () => {
 const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(() => {throw new Error("No network in profile fixtures");});
 try {
  const fixture = await generateMoneyProfileFixtures();
  expect(await generateMoneyProfileFixtures()).toEqual(fixture);
  expect(fixture.scenarios).toHaveLength(10);
  const coder = new BorshAccountsCoder(convertIdlToCamelCase(IDL));
  for (const row of fixture.scenarios) {
   const tx = VersionedTransaction.deserialize(Buffer.from(row.transaction.signed, "base64"));
   expect(tx.message.header.numRequiredSignatures).toBe(1);
   expect(tx.message.staticAccountKeys[0].toBase58()).toBe(row.transaction.feePayer);
   expect(row.transaction.ownerRequired).toBe(false);
   expect(row.expectedAfter.kreditBalance).toBe(row.expectedBefore.kreditBalance);
   expect(row.expectedAfter.ladderPoints).toBe(row.expectedBefore.ladderPoints);
   for (const before of row.before) {
    const after = row.after.find((value: {address: string}) => value.address === before.address);
    expect(after).toBeDefined();
    if (before.data === after.data) {expect(after).toEqual(before); continue;}
    const left = coder.decode("playerState", Buffer.from(before.data, "base64"));
    const right = coder.decode("playerState", Buffer.from(after.data, "base64"));
    right.featuredEmblem = left.featuredEmblem; right.featuredFrameTier = left.featuredFrameTier;
    expect(right).toEqual(left);
    expect(after.lamports).toBe(before.lamports);
   }
   if (row.variant === "missing-session" || row.failure) expect(row.after).toEqual(row.before);
   else {
    expect(row.expectedAfter.featuredEmblem).toBe(row.variant === "superseded" ? 10 : row.emblem);
    expect(row.expectedAfter.featuredFrameTier).toBe(row.variant === "superseded" ? 4 : row.frame);
   }
  }
  for (const [path, content] of [[moneyProfileFixturePath, JSON.stringify(fixture, null, 2) + "\n"], [moneyProfileDataPath, generatedMoneyProfileData(fixture)]]) {
   if (process.env.ZKUBE_WRITE_UNITY_FIXTURES === "1") {mkdirSync(dirname(path), {recursive: true}); writeFileSync(path, content);}
   expect(existsSync(path)).toBe(true);
   expect(readFileSync(path, "utf8")).toBe(content);
  }
  expect(fetch).not.toHaveBeenCalled();
 } finally {fetch.mockRestore();}
});
