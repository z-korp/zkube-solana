import { CATALOG_VERSION } from "../../src/core/protocolVersions.generated";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import BN from "bn.js";
import { BorshAccountsCoder, BorshCoder, convertIdlToCamelCase } from "@anchor-lang/core";
import { Keypair, PublicKey, type Connection } from "@solana/web3.js";
import { IDL } from "../../src/backend/solana/idl/index";
import { SessionWallet } from "../../src/backend/solana/session/sessionWallet";
import { ZKUBE_PROGRAM_ID } from "../../src/backend/solana/constants";
import * as pdas from "../../src/backend/solana/pdas";
import { fetchCampaignView, campaignTotalStars, decodePlayerStateAccount, CAMPAIGN_STAR_BYTES } from "../../src/backend/solana/content/campaignClient";
import { fetchDailyView, fetchDailyBoardAccount, fetchUnclaimedRewards, parseDailyStatus } from "../../src/backend/solana/content/dailyClient";
import { projectSolanaBoards } from "../../src/backend/solana/content/SolanaContentBoardsLive";
import { resolveSpectatedRun } from "../../src/backend/solana/runs/spectateRun";
import { zkubeProgram } from "../../src/backend/solana/runs/runPlan";
import { dailyContentFromPairIndex, dailyIsScheduled } from "../../src/core/dailyRules";
import { coreDailyPairIndex, coreLadderTier, coreDailyBoardPools, coreRankPayoutPlan, initializeZkubeCoreSync } from "../../src/core/zkubeCore";
import { ARENA_BOARD_CAPACITY } from "../../src/backend/solana/content/dailyClient";
import { DAILY_REWARD_CLAIM_WINDOW_SECONDS, DAILY_MAX_MOVES, ARCADE_ACCOUNT_VERSION } from "../../src/core/protocolVersions.generated";
import { repositoryRoot } from "./solana-fixtures";
export { canonicalJson } from "./solana-fixtures";

export const productReadFixturePath = resolve(repositoryRoot, "fixtures/unity-product-reads-v1.json");
type Envelope = { address: string; owner: string; executable: boolean; data: string };
export async function generateProductReadFixtures() {
  initializeZkubeCoreSync(readFileSync(resolve(repositoryRoot, "client/src/core/generated/zkube_core_bg.wasm")));
  const plans = JSON.parse(readFileSync(resolve(repositoryRoot, "fixtures/unity-plans-v1.json"), "utf8"));
  const solana = JSON.parse(readFileSync(resolve(repositoryRoot, "fixtures/unity-solana-v1.json"), "utf8"));
  const runs = JSON.parse(readFileSync(resolve(repositoryRoot, "fixtures/unity-run-client-v1.json"), "utf8"));
  const now: number = plans.inputs.now, day: number = plans.inputs.day;
  const owner = new PublicKey(plans.inputs.owner), wallet = new SessionWallet(Keypair.fromSeed(new Uint8Array(32).fill(1)));
  const coder = new BorshAccountsCoder(convertIdlToCamelCase(IDL));
  const envelopes = new Map<string, Envelope>();
  const put = (value: Envelope) => { envelopes.set(value.address, value); return value; };
  const info = (address: PublicKey) => { const row = envelopes.get(address.toBase58()); return row ? {
    owner: new PublicKey(row.owner), executable: row.executable, data: Buffer.from(row.data, "base64"), lamports: 1, rentEpoch: 0 } : null; };
  const connection = { rpcEndpoint: "https://base.invalid/", getAccountInfo: async(address: PublicKey) => info(address),
    getAccountInfoAndContext: async(address: PublicKey) => ({context:{slot:100},value:info(address)}),
    getMultipleAccountsInfo: async(addresses: PublicKey[]) => addresses.map(info) } as unknown as Connection;
  async function encode(name: string, address: PublicKey, fields: Record<string, unknown>): Promise<Envelope> {
    const bytes = Buffer.alloc(coder.size(name)); (await coder.encode(name,fields)).copy(bytes);
    return {address:address.toBase58(),owner:ZKUBE_PROGRAM_ID.toBase58(),executable:false,data:bytes.toString("base64")};
  }
  for(const name of ["protocol","arcade","credit","daily","following"]) put(plans.accounts[name]);
  const sourcePlayer = solana.accounts.find((row: { id: string }) => row.id === "player-valid");
  const playerFields = coder.decode<Record<string,unknown>>("playerState",Buffer.from(sourcePlayer.data,"base64"));
  // One fully perfected realm, the next realm unlocked, and a later cleared
  // boss exercise the documented direct-previous-boss unlock rule.
  const stars = new Array(CAMPAIGN_STAR_BYTES).fill(0); stars[0]=255;stars[1]=255;stars[2]=15;stars[7]=16;
  playerFields.campaignStars = stars;
  const player = put(await encode("playerState",pdas.derivePlayerStatePda(owner),playerFields));
  const campaign = await fetchCampaignView({connection,wallet});
  if(!campaign)throw new Error("Actual TS Campaign fetch rejected fixture");
  const profile = decodePlayerStateAccount(zkubeProgram(connection,wallet),pdas.derivePlayerStatePda(owner),owner,info(pdas.derivePlayerStatePda(owner))!);
  const pair=dailyContentFromPairIndex(day,await coreDailyPairIndex(day));
  const dailyFields=coder.decode<Record<string,unknown>>("arenaDaily",Buffer.from(plans.accounts.daily.data,"base64"));
  // Publication comes intact from the shared producer; this fixture adds only
  // the particular ledger needed for its payout and balance scenarios.
  Object.assign(dailyFields,{ledger:{seededLamports:new BN(500000000),entryLamports:new BN(20000000),rolloverInLamports:new BN(7000000),payoutLamports:new BN(1000000),rolloverOutLamports:new BN(2000000)}});
  const daily=put(await encode("arenaDaily",pdas.deriveArenaDailyPda(day),dailyFields));
  const view=await fetchDailyView({connection,wallet,dayId:day});
  if(!view)throw new Error("Actual TS Daily fetch rejected fixture");
  const arcadeFields=coder.decode<Record<string,unknown>>("arcadeConfig",Buffer.from(plans.accounts.arcade.data,"base64"));
  const protocolFields=coder.decode<Record<string,unknown>>("protocolConfig",Buffer.from(plans.accounts.protocol.data,"base64"));
  const suspendedArcade=await encode("arcadeConfig",pdas.deriveArcadeConfigPda(),{...arcadeFields,suspendedUntilDay:day+1});
  const pausedProtocol=await encode("protocolConfig",pdas.deriveProtocolConfigPda(),{...protocolFields,paused:true});
  const statusCases=[];
  for(const status of ["funding","finalized"] as const) statusCases.push({id:status,now,expected:parseDailyStatus({[status]:{}}),
    daily:await encode("arenaDaily",pdas.deriveArenaDailyPda(day),{...dailyFields,status:{[status]:{}}})});
  const freeze=(dailyFields.runsCloseAt as BN).toNumber();
  statusCases.push({id:"frozen",now:freeze,expected:projectSolanaBoards({daily:view,accounts:[null,null],owner,nowUnix:freeze})[0]!.status,daily});
  const blankBest={player:owner,score:0,objectiveTotal:new BN(0),finalizedAt:new BN(0),replayHash:new Array(32).fill(0)};
  const arenaPlayerFields={version:ARCADE_ACCOUNT_VERSION,challenge:pdas.deriveArenaDailyPda(day),player:owner,rentPayer:owner,
    paidEntries:3,resolvedEntries:1,activePaidRunId:new BN(0),hasScoreBest:false,scoreBestEntry:blankBest,scoreBestRunId:new BN(0),
    hasThemeBest:false,themeBestEntry:blankBest,themeBestRunId:new BN(0),bump:0};
  const arenaPlayer=await encode("arenaPlayer",pdas.deriveArenaPlayerPda(pdas.deriveArenaDailyPda(day),owner),arenaPlayerFields);
  const invalidAccounts={
    // Preserve the original bug: all draw/rules fields are valid, while the
    // omitted publication version remains its historical encoded zero, even
    // after the planner producer is corrected to emit the current publication.
    dailyCatalogVersion:await encode("arenaDaily",pdas.deriveArenaDailyPda(day),{...dailyFields,
      catalogVersion:0}),
    dailyMoveLimit:await encode("arenaDaily",pdas.deriveArenaDailyPda(day),{...dailyFields,
      pressure:{maxMoves:DAILY_MAX_MOVES-1}}),
    dailyDraw:await encode("arenaDaily",pdas.deriveArenaDailyPda(day),{...dailyFields,
      dailyTheme:{...pair.objective,value:pair.objective.value+1}}),
    arenaOwner:await encode("arenaPlayer",new PublicKey(arenaPlayer.address),{...arenaPlayerFields,player:PublicKey.default}),
    arenaChallenge:await encode("arenaPlayer",new PublicKey(arenaPlayer.address),{...arenaPlayerFields,challenge:PublicKey.default})};
  const oldDay=day-200;
  const finalizedPool=2000000000n;
  const oldFields={...dailyFields,dayId:oldDay,status:{finalized:{}},claimsExpired:false,
    scoreQualifiedPlayers:1,themeQualifiedPlayers:1,
    ledger:{seededLamports:new BN(finalizedPool.toString()),entryLamports:new BN(0),rolloverInLamports:new BN(0),
      payoutLamports:new BN(finalizedPool.toString()),rolloverOutLamports:new BN(0)}};
  const oldDaily=put(await encode("arenaDaily",pdas.deriveArenaDailyPda(oldDay),oldFields));
  const boardCases=[];
  for(const kind of ["score","theme"] as const) for(const variant of ["sealed","expired","claimed","unsealed","empty"] as const) {
    const source=plans.boards.find((row:{kind:string;id:string})=>row.kind===kind&&!row.id.includes("missing")).envelope as Envelope;
    const original=Buffer.from(source.data,"base64"),header=coder.decode<Record<string,unknown>>("arenaBoard",original.subarray(0,coder.size("arenaBoard")));
    const isEmpty=variant==="empty",sealed=variant!=="unsealed";
    const caseDailyFields={...oldFields,scoreQualifiedPlayers:isEmpty&&kind==="score"?0:1,themeQualifiedPlayers:isEmpty?0:1};
    const pools=coreDailyBoardPools(finalizedPool,caseDailyFields.themeQualifiedPlayers);
    const scorePlan=coreRankPayoutPlan(pools.score,caseDailyFields.scoreQualifiedPlayers,ARENA_BOARD_CAPACITY);
    const themePlan=coreRankPayoutPlan(pools.theme,caseDailyFields.themeQualifiedPlayers,ARENA_BOARD_CAPACITY);
    caseDailyFields.ledger={...oldFields.ledger,payoutLamports:new BN((scorePlan.paidLamports+themePlan.paidLamports).toString()),
      rolloverOutLamports:new BN((scorePlan.rolloverLamports+themePlan.rolloverLamports).toString())};
    const caseDaily=put(await encode("arenaDaily",pdas.deriveArenaDailyPda(oldDay),caseDailyFields));
    const pool=pools[kind],qualified=kind==="score"?caseDailyFields.scoreQualifiedPlayers:caseDailyFields.themeQualifiedPlayers;
    const plan=kind==="score"?scorePlan:themePlan;
    Object.assign(header,{dayId:oldDay,arenaDaily:pdas.deriveArenaDailyPda(oldDay),kind:{[kind]:{}},sealed,
      sealedAt:new BN(!sealed?0:variant==="expired"?now-DAILY_REWARD_CLAIM_WINDOW_SECONDS-1:now-10),
      qualifiedCount:qualified,widthCount:plan.widthWinnerCount,payoutCount:plan.winnerCount,denominator:new BN(plan.denominator.toString()),
      poolLamports:new BN(pool.toString()),paidLamports:new BN(plan.paidLamports.toString()),rolloverLamports:new BN(plan.rolloverLamports.toString()),
      capacityLimited:plan.capacityLimited,cursor:sealed?plan.winnerCount:0,claimedCount:variant==="claimed"?1:0,
      claimedLamports:new BN(variant==="claimed"?plan.payouts[0]!.toString():0)});
    const encodedHeader=Buffer.alloc(coder.size("arenaBoard")); (await coder.encode("arenaBoard",header)).copy(encodedHeader);
    const entryBytes=new BorshCoder(convertIdlToCamelCase(IDL)).types.encode("arenaBoardEntry",blankBest).length;
    const bytes=Buffer.concat([encodedHeader,isEmpty?Buffer.alloc(0):original.subarray(coder.size("arenaBoard"),coder.size("arenaBoard")+entryBytes),isEmpty?Buffer.alloc(0):Buffer.from([variant==="claimed"?1:0])]);
    const board=put({address:pdas.deriveArenaBoardPda(pdas.deriveArenaDailyPda(oldDay),kind).toBase58(),owner:ZKUBE_PROGRAM_ID.toBase58(),executable:false,data:bytes.toString("base64")});
    const account=await fetchDailyBoardAccount(connection,pdas.deriveArenaDailyPda(oldDay),oldDay,kind);
    const observed=projectSolanaBoards({daily:{...view,dayId:oldDay,status:"finalized"},accounts:kind==="score"?[account,null]:[null,account],owner,nowUnix:now})[kind==="score"?0:1]!;
    // Fixed explicit identity window: the actual helper evaluates sealing expiry
    // at now, independent of its separate bounded-discovery day range.
    const rewards=await fetchUnclaimedRewards({connection,owner,currentDayId:oldDay+1,nowUnix:now});
    boardCases.push({kind,variant,envelope:board,daily:caseDaily,status:observed.status,rows:observed.rows,
      reward:rewards.find(row=>row.dayId===oldDay&&row.board===kind)??null});
    envelopes.delete(board.address);
  }
  const spectatorCases=[];
  const active=runs.cases.find((row:{id:string})=>row.id==="active-daily-playing") as Envelope;
  const activeRunId=BigInt((coder.decode<Record<string,unknown>>("activeRun",Buffer.from(active.data,"base64")).runId as BN).toString());
  put(active);
  for(const delegated of [false,true]) {
    const actual=await resolveSpectatedRun({baseConnection:connection,target:{player:owner,runId:activeRunId},
      dependencies:{getStatus:async()=>({isDelegated:delegated,...(delegated?{fqdn:"https://er.invalid/"}:{})}),makeErConnection:()=>connection}});
    spectatorCases.push({delegated,phase:actual.phase});
  }
  const hashes=["client/src/backend/solana/content/campaignClient.ts","client/src/backend/solana/content/dailyClient.ts","client/src/backend/solana/content/SolanaContentBoardsLive.ts","client/src/backend/solana/runs/spectateRun.ts","client/src/core/campaignCatalog.generated.ts","fixtures/unity-plans-v1.json","fixtures/unity-solana-v1.json","fixtures/unity-run-client-v1.json"];
  return {schemaVersion:1,inputs:{now,day,oldDay,owner:owner.toBase58()},accounts:{...plans.accounts,player,daily,oldDaily,active},
    campaign:campaign.maps.map(map=>({mapId:map.mapId,unlocked:map.unlocked,cleared:map.cleared,perfected:map.perfected,levelStars:map.levelStars})),
    profile:{totalStars:campaignTotalStars(profile.campaignStars),tier:coreLadderTier(profile.ladderPoints),points:profile.ladderPoints.toString(),highest:profile.highestLadderTier,worn:profile.featuredFrameTier},
    daily:{realm:view.mapId,objective:view.dailyTheme,pool:view.dailyPotLamports.toString(),status:view.status},boardCases,spectatorCases,
    dailyAuthority:{day,pairIndex:pair.pairIndex,catalogVersion:CATALOG_VERSION,maxMoves:DAILY_MAX_MOVES,
      realm:pair.realmMapId,objective:pair.objective},
    statusCases,suspendedArcade,pausedProtocol,scheduled:dailyIsScheduled(day,day+1),arenaPlayer,invalidAccounts,
    provenance:{...Object.fromEntries(hashes.map(path=>[path,createHash("sha256").update(readFileSync(resolve(repositoryRoot,path))).digest("hex")])),
      producer:createHash("sha256").update(readFileSync(new URL(import.meta.url))).digest("hex")}};
}
