import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { BorshAccountsCoder, convertIdlToCamelCase } from "@anchor-lang/core";
import { PublicKey, type Connection } from "@solana/web3.js";
import { IDL } from "../../src/backend/solana/idl/index";
import { fetchCampaignView, CAMPAIGN_STAR_BYTES } from "../../src/backend/solana/content/campaignClient";
import { generateMapData } from "../../src/hooks/useMapData";
import { canInspectCampaignNode } from "../../src/ui/components/map/mapLogic";
import { initializeZkubeCoreSync } from "../../src/core/zkubeCore";
import { repositoryRoot } from "./solana-fixtures";
import { getZoneGuardian } from "../../src/config/bossCharacters";
import { ZONE_NAMES } from "../../src/config/profileData";

export const campaignBrowseFixturePath = process.env.ZKUBE_CAMPAIGN_BROWSE_FIXTURE_PATH ?? resolve(repositoryRoot, "fixtures/unity-campaign-browse-v1.json");
interface Envelope { address: string; owner: string; executable: boolean; data: string }
export async function generateCampaignBrowseFixtures() {
  initializeZkubeCoreSync(readFileSync(resolve(repositoryRoot, "client/src/core/generated/zkube_core_bg.wasm")));
  const source = JSON.parse(readFileSync(resolve(repositoryRoot, "fixtures/unity-product-reads-v1.json"), "utf8"));
  const coder = new BorshAccountsCoder(convertIdlToCamelCase(IDL));
  const owner = new PublicKey(source.inputs.owner);
  const wallet = { publicKey: owner, signTransaction: async () => { throw new Error("No signing"); }, signAllTransactions: async () => { throw new Error("No signing"); } };
  const decode = (name: string, row: Envelope) => coder.decode<Record<string, unknown>>(name, Buffer.from(row.data, "base64"));
  async function change(name: string, row: Envelope, mutate: (fields: Record<string, unknown>) => void) {
    const fields = decode(name, row); mutate(fields);
    const bytes = Buffer.alloc(coder.size(name)); (await coder.encode(name, fields)).copy(bytes);
    return { ...row, data: bytes.toString("base64") };
  }
  const noStars = await change("playerState", source.accounts.player, fields => { fields.campaignStars = new Array(CAMPAIGN_STAR_BYTES).fill(0); });
  const cases = [];
  for (const variant of [
    { id: "attested-progression", player: source.accounts.player as Envelope | null, saved: null as { realm: number; level: number } | null },
    { id: "new-player", player: null, saved: null },
    { id: "first-trial", player: noStars, saved: null },
    { id: "saved-local-trial", player: noStars, saved: { realm: 1, level: 1 } },
  ]) {
    const accounts = variant.player ? [variant.player] : [];
    const get = (key: PublicKey) => { const row = accounts.find(value => value.address === key.toBase58()); return row ? {
      owner: new PublicKey(row.owner), executable: row.executable, data: Buffer.from(row.data, "base64"), lamports: 1, rentEpoch: 0 } : null; };
    const connection = { rpcEndpoint: "https://base.invalid/", getAccountInfo: async (key: PublicKey) => get(key) } as unknown as Connection;
    const actual = await fetchCampaignView({ connection, wallet });
    if (!actual) throw new Error("Compiled Campaign catalog is unavailable");
    const saved = variant.saved;
    const activeRealm = saved?.realm ?? null, activeLevel = saved?.level ?? null;
    const expected = actual.maps.map(map => {
      const nodes = generateMapData({ map: { ...map, locked: map.unlocked ? null : "stars" }, activeStoryNode: saved ? { zoneId: activeRealm!, level: activeLevel! } : null });
      return { mapId: map.mapId, themeId: map.themeId, realmName: ZONE_NAMES[map.mapId], guardianName: getZoneGuardian(map.mapId).name,
        enabled: map.enabled, unlocked: map.unlocked, currentIndex: nodes.currentNodeIndex,
        levels: nodes.nodes.map(node => {
          const rules = map.levels[node.nodeInZone];
          if (!rules) throw new Error("Campaign rule snapshot is absent");
          return { level: node.contractLevel, stars: map.levelStars[node.nodeInZone], state: node.state,
          canInspect: canInspectCampaignNode(node.state, map.mapId, node.contractLevel, activeRealm, activeLevel),
          savedRules: activeRealm === map.mapId && activeLevel === node.contractLevel,
          guardian: rules.guardian, startingRows: rules.startingRows,
          rules: node.levelConfig }; }) };
    });
    cases.push({ id: variant.id, accounts, playerAddress: source.accounts.player.address, saved: variant.saved, expected });
  }
  const paths = ["fixtures/unity-product-reads-v1.json", "client/src/hooks/useMapData.ts", "client/src/hooks/useGameLevel.tsx", "client/src/core/runProjection.ts", "client/src/backend/solana/content/campaignClient.ts", "client/src/config/bossCharacters.ts", "client/src/config/profileData.ts"];
  return { schemaVersion: 1, owner: owner.toBase58(), cases, provenance: [
    ...paths.map(path => ({ path, sha256: createHash("sha256").update(readFileSync(resolve(repositoryRoot, path))).digest("hex") })),
    ...["../../src/ui/components/map/mapLogic.ts", "../../src/ui/pages/MapPage.tsx", "./campaign-browse-fixtures.ts"].map(path => ({
      path: path.startsWith("../../src/") ? "client/src/" + path.substring(10) : "client/tools/unity/campaign-browse-fixtures.ts",
      sha256: createHash("sha256").update(readFileSync(new URL(path, import.meta.url))).digest("hex") })),
  ] };
}
export const campaignBrowseJson = (value: unknown) => JSON.stringify(value, (_, field) => typeof field === "bigint" ? field.toString() : field, 2) + "\n";
