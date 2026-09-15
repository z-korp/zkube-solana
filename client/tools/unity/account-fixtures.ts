import { readFileSync } from "node:fs";
import { BorshAccountsCoder, convertIdlToCamelCase, type IdlType } from "@anchor-lang/core";
import BN from "bn.js";
import { Keypair, PublicKey, type Connection } from "@solana/web3.js";
import { IDL } from "../../src/backend/solana/idl";
import { ZKUBE_PROGRAM_ID } from "../../src/backend/solana/constants";
import { decodeActiveRunAccount, zkubeProgram } from "../../src/backend/solana/runs/runPlan";
import { decodePlayerStateAccount } from "../../src/backend/solana/content/campaignClient";
import { derivePlayerStatePda, deriveRunAddresses } from "../../src/backend/solana/pdas";
import { SessionWallet } from "../../src/backend/solana/session/sessionWallet";
import { PLAYER_STATE_ACCOUNT_VERSION, PROTOCOL_ACCOUNT_VERSION, DAILY_MAX_MOVES } from "../../src/core/protocolVersions.generated";
import { canonicalCampaignMap, CAMPAIGN_CONTENT_VERSION } from "../../src/core/campaignCatalog";
import { coreApplyRunVrf, coreBuildRunConfig, coreInitializeRun,
  coreRunSummary, coreRequestRunReroll, coreFinishRun, initializeZkubeCoreSync } from "../../src/core/zkubeCore";

export async function generateAccountFixtures(ownerKey: Keypair, deviceKey: Keypair, nowUnix: number, includeRecoveryStates = false) {
  initializeZkubeCoreSync(readFileSync(new URL("../../src/core/generated/zkube_core_bg.wasm", import.meta.url)));
  const idl = convertIdlToCamelCase(IDL);
  const coder = new BorshAccountsCoder(idl);
  const rawCoder = new BorshAccountsCoder(IDL);
  const owner = ownerKey.publicKey;
  const program = zkubeProgram({ rpcEndpoint: "https://base.invalid" } as Connection, new SessionWallet(ownerKey));
  const definitions = new Map<string, (typeof idl.types)[number]["type"]>(idl.types.map(type => [type.name, type.type]));
  function zero(type: IdlType): unknown {
    if (typeof type === "string") {
      if (type === "pubkey") return PublicKey.default;
      if (type === "bool") return false;
      if (["u64", "i64", "u128", "i128"].includes(type)) return new BN(0);
      return 0;
    }
    if ("array" in type) return Array.from({ length: Number(type.array[1]) }, () => zero(type.array[0]));
    if ("option" in type) return null;
    if ("defined" in type) {
      const definition = definitions.get(type.defined.name);
      if (definition?.kind === "struct") return Object.fromEntries((definition.fields ?? []).map(field => {
        if (!("name" in field)) throw new Error("Tuple structs unsupported in fixed fixture");
        return [field.name, zero(field.type)];
      }));
      if (definition?.kind === "enum") return { [definition.variants[0].name]: {} };
    }
    throw new Error("Unsupported fixture IDL field: " + JSON.stringify(type));
  }
  async function encoded(name: string, fields: Record<string, unknown>) {
    const output = await coder.encode(name, fields);
    const padded = Buffer.alloc(coder.size(name)); output.copy(padded);
    return padded;
  }
  const accounts: object[] = [];
  const profile = zero({ defined: { name: "playerState" } }) as Record<string, unknown>;
  Object.assign(profile, { version: PLAYER_STATE_ACCOUNT_VERSION, owner, nextRunId: new BN("9007199254740995"),
    activeRunId: new BN("9007199254740993"),
    kreditBalance: new BN(25), ladderPoints: new BN("9007199254740993"), highestLadderTier: 3,
    featuredFrameTier: 2, entryStreakDays: 42, lastEntryDayId: Math.floor(nowUnix / 86400),
    campaignStars: Array.from({ length: 25 }, (_, index) => index === 0 ? 255 : 0) });
  for (const mutation of ["valid", "wrong-owner", "wrong-address", "executable", "short", "discriminator", "reserved", "version", "frame"] as const) {
    const changed = { ...profile };
    if (mutation === "reserved") changed.reserved = [1, ...new Array(17).fill(0)];
    if (mutation === "version") changed.version = 255;
    if (mutation === "frame") changed.featuredFrameTier = 4;
    const data = await encoded("playerState", changed);
    if (mutation === "discriminator") data[0] ^= 1;
    const envelope = { owner: mutation === "wrong-owner" ? owner : ZKUBE_PROGRAM_ID, executable: mutation === "executable",
      data: mutation === "short" ? data.subarray(0, data.length - 1) : data, lamports: 1, rentEpoch: 0 };
    const address = mutation === "wrong-address" ? owner : derivePlayerStatePda(owner);
    let error: string | null = null;
    try { decodePlayerStateAccount(program, address, owner, envelope); } catch (cause) { error = (cause as Error).message; }
    accounts.push({ id: "player-" + mutation, kind: "PlayerState", address: address.toBase58(),
      owner: envelope.owner.toBase58(), executable: envelope.executable, data: envelope.data.toString("base64"),
      expectedAuthority: owner.toBase58(), decoded: error ? null : rawCoder.decode("PlayerState", data), error });
  }

  for (const mode of ["daily"] as const) {
    const realm = canonicalCampaignMap(CAMPAIGN_CONTENT_VERSION, 1);
    const rules = { ...realm.levels[0], pointsRequired: 0,
      guardian: realm.mapRules.guardian, startingRows: realm.mapRules.startingRows };
    const rulesHash = new Uint8Array(32).fill(4), initialReplay = new Uint8Array(32).fill(6);
    const config = coreBuildRunConfig({ mode, rulesHash, initialReplay,
      maxMoves: DAILY_MAX_MOVES,
      bonusType: rules.guardian.bonus, trigger: rules.guardian.trigger, triggerThreshold: rules.guardian.threshold,
      startingHeight: rules.startingRows, fixedTier: rules.difficulty, pointsRequired: rules.pointsRequired,
      primary: { kind: 0, value: 0, requiredCount: 0 }, secondary: { kind: 0, value: 0, requiredCount: 0 }, objective: { kind: 1, value: 2, requiredCount: 0 } });
    const initial = coreInitializeRun(config);
    const playing = coreApplyRunVrf({ config, state: initial, requestCounter: 1, vrfOutput: new Uint8Array(32).fill(8) });
    const reroll = coreRequestRunReroll(config, playing, 0);
    const rerolled = coreApplyRunVrf({ config, state: reroll, requestCounter: 2, vrfOutput: new Uint8Array(32).fill(9) });
    const finished = coreFinishRun(config, rerolled, "abandon");
    for (const [phase, state] of [["prepared", initial], ["playing", playing], ...(includeRecoveryStates ? [["awaitingVrf", reroll], ["rerolled", rerolled], ["finished", finished]] as const : [])] as const) {
      const summary = coreRunSummary(state);
      const active = zero({ defined: { name: "activeRun" } }) as Record<string, unknown>;
      Object.assign(active, summary, { version: PROTOCOL_ACCOUNT_VERSION, owner, rentPayer: deviceKey.publicKey, runId: new BN("9007199254740993"),
        mode: { [mode]: {} }, lifecycle: { [phase === "rerolled" ? "playing" : phase]: {} }, mapId: 1, rules: { guardian: rules.guardian, startingRows: rules.startingRows },
        rulesHash: [...rulesHash], replayHash: summary.replayHash, objectiveTotal: new BN(summary.objectiveTotal.toString()),
        deadlineAt: new BN(nowUnix + 86340), finishedAt: new BN(phase === "finished" ? nowUnix : 0), finishReason: phase === "finished" ? { abandon: {} } : null,
        nextRow: summary.nextRow ?? new Array(8).fill(0), hasNextRow: summary.nextRow != null,
        dailyTheme: { kind: 1, value: 2 }, vrfRequestCounter: phase === "prepared" ? 0 : phase === "playing" ? 1 : 2,
        pendingVrfCounter: phase === "awaitingVrf" ? 2 : 0 });
      const data = await encoded("activeRun", active);
      const view = decodeActiveRunAccount(data, ZKUBE_PROGRAM_ID);
      if (!view.runToken) throw new Error("Missing authoritative run token");
      accounts.push({ id: `active-${mode}-${phase}`, kind: "ActiveRun",
        address: deriveRunAddresses(owner, 9007199254740993n).activeRun.toBase58(), owner: ZKUBE_PROGRAM_ID.toBase58(),
        executable: false, data: data.toString("base64"), expectedAuthority: owner.toBase58(),
        decoded: rawCoder.decode("ActiveRun", data), error: null,
        token: { config: Buffer.from(view.runToken.config).toString("base64"), state: Buffer.from(view.runToken.state).toString("base64") } });
      if (phase === "playing") {
        const invalid = { ...active, grid: [255, ...summary.grid.slice(1)] };
        const malformed = await encoded("activeRun", invalid);
        let nativeError: string | null = null;
        try { decodeActiveRunAccount(malformed, ZKUBE_PROGRAM_ID); } catch (cause) { nativeError = (cause as Error).message; }
        if (!nativeError) throw new Error("Malformed core grid was accepted");
        accounts.push({ id: "active-malformed-grid", kind: "ActiveRun",
          address: deriveRunAddresses(owner, 9007199254740993n).activeRun.toBase58(), owner: ZKUBE_PROGRAM_ID.toBase58(),
          executable: false, data: malformed.toString("base64"), expectedAuthority: owner.toBase58(),
          decoded: rawCoder.decode("ActiveRun", malformed), error: null, nativeError });
      }
    }
  }
  return accounts;
}
