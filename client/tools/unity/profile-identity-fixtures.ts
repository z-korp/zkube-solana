/** Authored identity labels and TS presentation checked against the program oracle. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BorshAccountsCoder, convertIdlToCamelCase } from "@anchor-lang/core";
import { IDL } from "@/backend/solana/idl";
import { EMBLEM_DESCRIPTORS, resolveAutoEmblemId, resolveEmblemStates, type EmblemZoneInput } from "@/config/emblems";
import { LADDER_TIERS } from "@/config/ladderTiers";
const repositoryRoot = process.env.ZKUBE_SOURCE_ROOT ?? fileURLToPath(new URL("../../../", import.meta.url));

export const profileIdentityFixturePath = process.env.ZKUBE_PROFILE_IDENTITY_FIXTURE ?? resolve(repositoryRoot, "fixtures/unity-profile-identity-v1.json");
export const profileIdentityCatalogPath = process.env.ZKUBE_PROFILE_IDENTITY_CATALOG ?? resolve(repositoryRoot, "unity/Assets/ZKube/Integration/App/ProfileIdentityCatalog.g.cs");
export const profileEligibilityPath = process.env.ZKUBE_PROFILE_ELIGIBILITY_FIXTURE ?? resolve(repositoryRoot, "fixtures/unity-profile-eligibility-v1.json");

export async function profileIdentityFixtures() {
  const oracleBytes = readFileSync(profileEligibilityPath);
  const oracle: { schema: number; cases: { id: string; packedStars: number[]; zones: EmblemZoneInput[]; emblemUnlocked: boolean[] }[] } = JSON.parse(oracleBytes.toString());
  if (oracle.schema !== 1) throw new Error("Unknown program profile eligibility oracle");
  const products = JSON.parse(readFileSync(resolve(repositoryRoot, "fixtures/unity-product-reads-v1.json"), "utf8"));
  const source = products.accounts.player;
  const coder = new BorshAccountsCoder(convertIdlToCamelCase(IDL));
  return {
    schema: 1,
    oracleSha256: createHash("sha256").update(oracleBytes).digest("hex"),
    emblems: EMBLEM_DESCRIPTORS.map(({ id, kind, zoneId, name }) => ({ id, kind, realm: zoneId ?? 0, name })),
    tiers: LADDER_TIERS.map((tier, id) => ({ id, ...tier })),
    cases: await Promise.all(oracle.cases.map(async row => {
      const states = resolveEmblemStates(row.zones);
      if (states.some(state => state.unlocked !== row.emblemUnlocked[state.descriptor.id]))
        throw new Error("Profile eligibility disagrees with the program: " + row.id);
      const player = coder.decode("playerState", Buffer.from(source.data, "base64"));
      player.campaignStars = row.packedStars;
      player.featuredEmblem = 0;
      const encoded = Buffer.alloc(coder.size("playerState"));
      (await coder.encode("playerState", player)).copy(encoded);
      return { id: row.id, player: { ...source, data: encoded.toString("base64") }, automatic: resolveAutoEmblemId(row.zones),
        unlocked: states.filter(state => state.unlocked).map(state => state.descriptor.id),
        gold: states.filter(state => state.gold).map(state => state.descriptor.id) };
    })),
  };
}

export function generatedProfileIdentityCatalog(value: Awaited<ReturnType<typeof profileIdentityFixtures>>) {
  const kinds = { auto: "Automatic", guardian: "Guardian", realm: "Realm", world: "World" };
  return "// Generated from TS emblem descriptors and ladder labels. Do not edit.\n" +
    "namespace ZKube.Integration.App\n{\n    public static class ProfileIdentityCatalog\n    {\n" +
    "        public static readonly System.Collections.Generic.IReadOnlyList<ProfileEmblemDefinition> Emblems = System.Array.AsReadOnly(new[] {\n" +
    value.emblems.map(row => `            new ProfileEmblemDefinition(${row.id}, ProfileEmblemKind.${kinds[row.kind]}, ${row.realm}, ${JSON.stringify(row.name)})`).join(",\n") + "\n        });\n" +
    "        public static readonly System.Collections.Generic.IReadOnlyList<ProfileTierDefinition> Tiers = System.Array.AsReadOnly(new[] {\n" +
    value.tiers.map(row => `            new ProfileTierDefinition(${row.id}, ${JSON.stringify(row.name)}, ${JSON.stringify(row.color)})`).join(",\n") + "\n        });\n    }\n}\n";
}
