import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { BorshAccountsCoder } from "@anchor-lang/core";
import { Keypair, PublicKey, TransactionMessage, VersionedTransaction, type Connection } from "@solana/web3.js";
import BN from "bn.js";
import { IDL } from "../../src/backend/solana/idl/index";
import { deriveRunAddresses } from "../../src/backend/solana/pdas";
import { ZKUBE_PROGRAM_ID } from "../../src/backend/solana/constants";
import { decodeActiveRunAccount, buildFinalizeRunPlan, buildConsumeRunRecoveryPlan, withPinnedWalletComputeBudget } from "../../src/backend/solana/runs/runPlan";
import { resolvePersistedRun } from "../../src/backend/solana/runs/resumeRun";
import { saveRunSession } from "../../src/backend/solana/runs/runSessionStore";
import { SessionWallet } from "../../src/backend/solana/session/sessionWallet";
import { validateDeviceSignerFunding } from "../../src/backend/solana/session/deviceSessionFunding";
import { deriveSessionTokenV2Pda } from "../../src/backend/solana/session/sessionV2";

import { repositoryRoot } from "./run-reconciliation-fixtures";
import { resolve } from "node:path";

export const runClientFixturePath = resolve(repositoryRoot, "fixtures/unity-run-client-v1.json");
export async function generateRunClientFixtures() {
const root = repositoryRoot;
const prior = JSON.parse(readFileSync(`${root}/fixtures/unity-run-reconciliation-v1.json`, "utf8"));
const plans = JSON.parse(readFileSync(`${root}/fixtures/unity-plans-v1.json`, "utf8"));
const ownerKey = Keypair.fromSeed(new Uint8Array(32).fill(1)), device = Keypair.fromSeed(new Uint8Array(32).fill(2));
const owner = ownerKey.publicKey, coder = new BorshAccountsCoder(IDL);
const runIds = { daily: 9007199254740993n };
const rows = [];
for (const row of prior.cases) {
  const mode = "daily";
  const fields = coder.decode("ActiveRun", Buffer.from(row.data, "base64"));
  fields.run_id = new BN(runIds[mode].toString());
  const bytes = Buffer.alloc(coder.size("ActiveRun"));
  (await coder.encode("ActiveRun", fields)).copy(bytes);
  const decoded = decodeActiveRunAccount(bytes, ZKUBE_PROGRAM_ID);
  if (decoded.runId !== runIds[mode]) throw new Error("Actual TS run decoder rejected mode identity");
  rows.push({ id:row.id as string,kind:row.kind as string,owner:row.owner as string,executable:row.executable as boolean,
    expectedAuthority:row.expectedAuthority as string,address: deriveRunAddresses(owner, runIds[mode]).activeRun.toBase58(), data: bytes.toString("base64"),
    token:{config:Buffer.from(decoded.runToken!.config).toString("base64"),state:Buffer.from(decoded.runToken!.state).toString("base64")} });
}
const rulesChanged = { ...rows.find(row=>row.id==="active-daily-playing")! };
const changedFields = coder.decode("ActiveRun",Buffer.from(rulesChanged.data,"base64"));
changedFields.rules_hash = new Array(32).fill(5);
const changedBytes = Buffer.alloc(coder.size("ActiveRun")); (await coder.encode("ActiveRun",changedFields)).copy(changedBytes);
rulesChanged.data = changedBytes.toString("base64");
const changedView = decodeActiveRunAccount(changedBytes,ZKUBE_PROGRAM_ID);
rulesChanged.token = {config:Buffer.from(changedView.runToken!.config).toString("base64"),state:Buffer.from(changedView.runToken!.state).toString("base64")};
const successor = { ...rows.find(row=>row.id==="active-daily-playing")! };
const successorId = runIds.daily + 1n;
const successorFields = coder.decode("ActiveRun",Buffer.from(successor.data,"base64"));
successorFields.run_id = new BN(successorId.toString());
const successorBytes = Buffer.alloc(coder.size("ActiveRun")); (await coder.encode("ActiveRun",successorFields)).copy(successorBytes);
successor.data = successorBytes.toString("base64"); successor.address = deriveRunAddresses(owner,successorId).activeRun.toBase58();
decodeActiveRunAccount(successorBytes,ZKUBE_PROGRAM_ID);
const successorPrepared = { ...rows.find(row=>row.id==="active-daily-prepared")!, address:successor.address };
const openingSuccessorFields = coder.decode("ActiveRun",Buffer.from(successorPrepared.data,"base64"));
openingSuccessorFields.run_id = new BN(successorId.toString());
const openingSuccessorBytes = Buffer.alloc(coder.size("ActiveRun")); (await coder.encode("ActiveRun",openingSuccessorFields)).copy(openingSuccessorBytes);
successorPrepared.data = openingSuccessorBytes.toString("base64");
decodeActiveRunAccount(openingSuccessorBytes,ZKUBE_PROGRAM_ID);
const successorProfile = coder.decode("PlayerState",Buffer.from(prior.player.data,"base64"));
successorProfile.active_run_id = new BN(successorId.toString()); successorProfile.next_run_id = new BN((successorId+1n).toString());
const successorProfileBytes = Buffer.alloc(coder.size("PlayerState")); (await coder.encode("PlayerState",successorProfile)).copy(successorProfileBytes);
const successorPlayer = {...prior.player,data:successorProfileBytes.toString("base64")};
const consumedPlayers: Record<string, unknown> = {};
const initialPlayers: Record<string, unknown> = {}, preparedPlayers: Record<string, unknown> = {};
for (const mode of ["daily"] as const) {
  const fields = coder.decode("PlayerState", Buffer.from(prior.player.data, "base64"));
  fields["active_run_id"] = new BN(0);
  const bytes = Buffer.alloc(coder.size("PlayerState")); (await coder.encode("PlayerState", fields)).copy(bytes);
  consumedPlayers[mode] = { ...prior.player, data: bytes.toString("base64") };
  const opening = coder.decode("PlayerState", Buffer.from(prior.player.data,"base64"));
  opening.active_run_id = new BN(0);
  opening.next_run_id = new BN(runIds[mode].toString());
  const beforeBytes = Buffer.alloc(coder.size("PlayerState")); (await coder.encode("PlayerState",opening)).copy(beforeBytes);
  initialPlayers[mode] = {...prior.player,data:beforeBytes.toString("base64")};
  opening["active_run_id"] = new BN(runIds[mode].toString());
  opening.next_run_id = new BN((runIds[mode]+1n).toString());
  const afterBytes = Buffer.alloc(coder.size("PlayerState")); (await coder.encode("PlayerState",opening)).copy(afterBytes);
  preparedPlayers[mode] = {...prior.player,data:afterBytes.toString("base64")};
}
const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window"), previousNow = Date.now;
const routing = [];
const sessionDecisions = [];
try {
  Date.now = () => Number(plans.inputs.now) * 1000;
  for (const row of rows) {
    const mode = "daily";
    const storage = new Map<string,string>();
    Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: {
      getItem: (key:string) => storage.get(key) ?? null, setItem: (key:string,value:string) => storage.set(key,value), removeItem:(key:string) => storage.delete(key) } } });
    const sessionToken = deriveSessionTokenV2Pda({ authority: owner, sessionSigner: device.publicKey }).sessionToken;
    saveRunSession({ owner, runId:runIds[mode], mode, session:device, sessionToken, addresses:deriveRunAddresses(owner,runIds[mode]), validUntil:Number(plans.inputs.now)+3600, createdAt:Number(plans.inputs.now) });
    const info = { owner:ZKUBE_PROGRAM_ID, executable:false, data:Buffer.from(row.data,"base64"), lamports:1, rentEpoch:0 };
    const connection = { rpcEndpoint:"https://er.invalid/", getAccountInfo:async()=>info } as unknown as Connection;
    const base = { rpcEndpoint:"https://base.invalid/", getAccountInfo:async(address:PublicKey)=>address.equals(sessionToken)?null:info } as unknown as Connection;
    const actual = await resolvePersistedRun({owner,slot:"arcade",wallet:new SessionWallet(ownerKey),baseConnection:base,
      dependencies:{getStatus:async()=>({isDelegated:true,fqdn:connection.rpcEndpoint}),makeErConnection:()=>connection}});
    routing.push({id:row.id,delegated:true,phase:actual.phase});
  }
  for (const mode of ["daily"] as const) {
    const finished = rows.find(row => row.id === `active-${mode}-finished`)!;
    const sessionInfo = {owner:new PublicKey(plans.accounts.session.owner),executable:false,
      data:Buffer.from(plans.accounts.session.data,"base64"),lamports:1,rentEpoch:0};
    const validUntil = Number(sessionInfo.data.readBigInt64LE(136));
    const sessionToken = new PublicKey(plans.accounts.session.address);
    const runInfo = {owner:ZKUBE_PROGRAM_ID,executable:false,data:Buffer.from(finished.data,"base64"),lamports:1,rentEpoch:0};
    for (const condition of ["ready","missing","expired","revoked","depleted"] as const) {
      const storage = new Map<string,string>();
      Object.defineProperty(globalThis,"window",{configurable:true,value:{localStorage:{
        getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value),removeItem:(key:string)=>storage.delete(key)}}});
      saveRunSession({owner,runId:runIds[mode],mode,session:device,sessionToken,addresses:deriveRunAddresses(owner,runIds[mode]),
        validUntil,createdAt:Number(plans.inputs.now)});
      Date.now = () => (condition==="expired"?validUntil:Number(plans.inputs.now))*1000;
      const connection = {rpcEndpoint:"https://base.invalid/",getAccountInfo:async(address:PublicKey)=>
        address.equals(sessionToken)?condition==="revoked"?null:sessionInfo:runInfo} as unknown as Connection;
      const actual = await resolvePersistedRun({owner,slot:"arcade",wallet:new SessionWallet(ownerKey),baseConnection:connection,
        dependencies:{getStatus:async()=>({isDelegated:false}),makeErConnection:()=>connection}});
      const funding = validateDeviceSignerFunding({info:{owner:PublicKey.default,executable:false,data:Buffer.alloc(0),
        lamports:condition==="depleted"?0:1000000000,rentEpoch:0},rentFloorLamports:890880});
      const available = condition!=="missing";
      const authorized = "sessionAuthorized" in actual && actual.sessionAuthorized;
      // The live TS controller uses a session for normal settlement. The owner
      // fallback is the existing recovery builder contract, not a wired TS UI flow.
      sessionDecisions.push({mode,condition,phase:actual.phase,available,authorized,funding,
        payer:available&&authorized&&funding==="ready"?device.publicKey.toBase58():owner.toBase58()});
    }
  }
} finally { Date.now=previousNow; if(previousWindow)Object.defineProperty(globalThis,"window",previousWindow);else Reflect.deleteProperty(globalThis,"window"); }
const paths = ["fixtures/unity-run-reconciliation-v1.json", "fixtures/unity-plans-v1.json", "client/src/backend/solana/runs/resumeRun.ts", "client/src/backend/solana/runs/runPlan.ts", "client/src/backend/solana/idl/solana.json", "client/src/backend/solana/session/deviceSessionFunding.ts", "client/src/backend/solana/runs/runSessionStore.ts"];
// This is the existing owner recovery builder contract. The current TS live
// controller does not wire that fallback; this fixture does not claim it does.
const ownerConsume: Record<string,string> = {};
const deviceConsume: Record<string,string> = {};
const successors: Record<string,unknown> = {};
for (const mode of ["daily"] as const) {
  const finished = rows.find(row=>row.id===`active-${mode}-finished`)!;
  const connection = {rpcEndpoint:"https://base.invalid/",getAccountInfoAndContext:async()=>({context:{slot:10000},value:{
    owner:ZKUBE_PROGRAM_ID,executable:false,data:Buffer.from(finished.data,"base64"),lamports:1,rentEpoch:0}})} as unknown as Connection;
  const plan = await buildConsumeRunRecoveryPlan({wallet:new SessionWallet(ownerKey),owner,runId:runIds[mode],addresses:deriveRunAddresses(owner,runIds[mode]),
    mode,dailyChallenge:PublicKey.default,connection});
  const message = new TransactionMessage({payerKey:owner,recentBlockhash:plans.inputs.blockhash,
    instructions:withPinnedWalletComputeBudget(plan.transaction.instructions)}).compileToV0Message();
  const transaction = new VersionedTransaction(message); transaction.sign([ownerKey]);
  ownerConsume[mode] = Buffer.from(transaction.serialize()).toString("base64");
  const devicePlan = await buildFinalizeRunPlan({wallet:new SessionWallet(device),owner,sessionToken:new PublicKey(plans.accounts.session.address),
    runId:runIds[mode],addresses:deriveRunAddresses(owner,runIds[mode]),mode,dailyChallenge:PublicKey.default,connection});
  const deviceMessage = new TransactionMessage({payerKey:device.publicKey,recentBlockhash:plans.inputs.blockhash,
    instructions:withPinnedWalletComputeBudget(devicePlan.transaction.instructions)}).compileToV0Message();
  const deviceTransaction = new VersionedTransaction(deviceMessage); deviceTransaction.sign([device]);
  deviceConsume[mode] = Buffer.from(deviceTransaction.serialize()).toString("base64");
  const next = {...rows.find(row=>row.id===`active-${mode}-playing`)!};
  const fields = coder.decode("ActiveRun",Buffer.from(next.data,"base64")); fields.run_id=new BN(successorId.toString());
  const bytes=Buffer.alloc(coder.size("ActiveRun")); (await coder.encode("ActiveRun",fields)).copy(bytes);
  next.data=bytes.toString("base64"); next.address=deriveRunAddresses(owner,successorId).activeRun.toBase58();
  decodeActiveRunAccount(bytes,ZKUBE_PROGRAM_ID);
  const profile=coder.decode("PlayerState",Buffer.from(prior.player.data,"base64"));
  profile["active_run_id"]=new BN(successorId.toString());
  profile.next_run_id=new BN((successorId+1n).toString());
  const profileBytes=Buffer.alloc(coder.size("PlayerState")); (await coder.encode("PlayerState",profile)).copy(profileBytes);
  successors[mode]={run:next,player:{...prior.player,data:profileBytes.toString("base64")}};
}
return {schemaVersion:1,provenance:{...Object.fromEntries(paths.map(path=>[path,createHash("sha256").update(readFileSync(`${root}/${path}`)).digest("hex")])),
  "client/tools/unity/run-client-fixtures.ts":createHash("sha256").update(readFileSync(new URL(import.meta.url))).digest("hex")},
  cases:rows,routing,player:prior.player,consumedPlayers,rulesChanged,initialPlayers,preparedPlayers,successor,successorPlayer,successorPrepared,ownerConsume,deviceConsume,sessionDecisions,successors};
}
