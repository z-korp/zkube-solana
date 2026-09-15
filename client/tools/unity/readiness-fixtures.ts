import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { BorshAccountsCoder, convertIdlToCamelCase } from "@anchor-lang/core";
import { Keypair, PublicKey, SystemProgram, type Connection } from "@solana/web3.js";
import BN from "bn.js";
import { IDL } from "../../src/backend/solana/idl/index";
import { repositoryRoot } from "./solana-fixtures";
import { inspectSession } from "../../src/backend/solana/SolanaIdentitySessionLive";
import { saveDeviceSession } from "../../src/backend/solana/session/deviceSessionStore";
import { fetchDailyView, assertRankedEntryDependencies, buildPrepareDailyRunPlan } from "../../src/backend/solana/content/dailyClient";
import { computeArcadeLifecycle } from "../../src/ui/components/arcade/arcadeLifecycle";
import { SessionWallet } from "../../src/backend/solana/session/sessionWallet";
import { deriveRunAddresses } from "../../src/backend/solana/pdas";

export const readinessFixturePath=resolve(repositoryRoot,"fixtures/unity-money-readiness-v1.json");
interface FixtureEnvelope { address: string; owner: string; executable: boolean; data: string }
export async function generateReadinessFixtures() {
  const plans=JSON.parse(readFileSync(resolve(repositoryRoot,"fixtures/unity-plans-v1.json"),"utf8"));
  const products=JSON.parse(readFileSync(resolve(repositoryRoot,"fixtures/unity-product-reads-v1.json"),"utf8"));
  const owner=Keypair.fromSeed(new Uint8Array(32).fill(1)),device=Keypair.fromSeed(new Uint8Array(32).fill(2));
  const coder=new BorshAccountsCoder(convertIdlToCamelCase(IDL));
  const now=plans.inputs.now,day=plans.inputs.day,rent=890880;
  const oldWindow=Object.getOwnPropertyDescriptor(globalThis,"window");
  const sessionCases=[];
  try {
    for(const variant of ["ready","expiring","one-short","missing-signer","missing-key","expired","skew","revoked"]){
      const storage=new Map<string,string>();
      Object.defineProperty(globalThis,"window",{configurable:true,value:{localStorage:{
        getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value),removeItem:(key:string)=>storage.delete(key)}}});
      const token={...plans.accounts.session};
      const bytes=Buffer.from(token.data,"base64");
      const remaining=variant==="expired"?0:variant==="skew"?60:variant==="expiring"?61:3600;
      bytes.writeBigInt64LE(BigInt(now+remaining),136);token.data=bytes.toString("base64");
      const balance=variant==="one-short"?rent+9999:5000000;
      if(variant!=="missing-key")saveDeviceSession({owner:owner.publicKey,signer:device,sessionToken:new PublicKey(token.address),validUntil:now+remaining,createdAt:now});
      const info=(row:FixtureEnvelope)=>({owner:new PublicKey(row.owner),executable:row.executable,data:Buffer.from(row.data,"base64"),lamports:1,rentEpoch:0});
      const connection={getMultipleAccountsInfo:async()=>[variant==="revoked"?null:info(token),
        variant==="missing-signer"?null:{owner:SystemProgram.programId,executable:false,data:Buffer.alloc(0),lamports:balance,rentEpoch:0}],
        getMinimumBalanceForRentExemption:async()=>rent} as unknown as Connection;
      const inspected=await inspectSession(connection,owner.publicKey,now);
      const action=!inspected||inspected.needsAuthorization?"renew":inspected.funding==="ready"?"ready":"refill";
      sessionCases.push({variant,now,token,balance,action,keyPresent:variant!=="missing-key",tokenPresent:variant!=="revoked",signerPresent:variant!=="missing-signer"});
    }
  } finally {if(oldWindow)Object.defineProperty(globalThis,"window",oldWindow);else Reflect.deleteProperty(globalThis,"window");}

  const dailyCases=[];
  const wallet=new SessionWallet(device);
  async function encode(name:string,row:FixtureEnvelope,change:Record<string,unknown>){
    const fields=coder.decode(name,Buffer.from(row.data,"base64"));Object.assign(fields,change);
    const bytes=Buffer.alloc(coder.size(name));(await coder.encode(name,fields)).copy(bytes);
    return {...row,data:bytes.toString("base64")};
  }
  for(const variant of ["ready","missing-receiver","missing-vault","wrong-vault-owner","zero-kredits","resume","occupied","frozen","before-open","paused","suspended"]){
    // Keep only entry dependencies. The source fixture also contains negative
    // session variants at the same PDA; importing those would replace a valid
    // session in a positive readiness case.
    const rows=Object.fromEntries(["protocol","arcade","credit","daily","following","player"].map(name=>[name,products.accounts[name]]));
    rows.player=await encode("playerState",rows.player,{activeRunId:new BN(variant==="resume"?"9007199254740993":"0"),kreditBalance:new BN(variant==="zero-kredits"?0:3)});
    if(variant==="missing-receiver")rows.following=null;
    if(variant==="missing-vault")rows.credit=null;
    if(variant==="wrong-vault-owner")rows.credit={...rows.credit,owner:SystemProgram.programId.toBase58()};
    if(variant==="paused")rows.protocol=products.pausedProtocol;
    if(variant==="suspended")rows.arcade=products.suspendedArcade;
    const fields=coder.decode("arenaDaily",Buffer.from(rows.daily.data,"base64"));
    const observedNow=variant==="frozen"?Number(fields.runsCloseAt.toString()):now;
    if(variant==="before-open")rows.daily=await encode("arenaDaily",rows.daily,{opensAt:new BN(now+1)});
    const map=new Map<string,FixtureEnvelope>(Object.values(rows).filter((row:FixtureEnvelope|null):row is FixtureEnvelope=>row!==null&&!!row.address).map((row:FixtureEnvelope)=>[row.address,row]));
    // The TS fetch uses the player's wallet key for account reads. Session signing
    // is irrelevant to these read/helper plans; use the owner reader explicitly.
    const reader=new SessionWallet(owner);
    const info=(address:PublicKey)=>{const row=map.get(address.toBase58());return row?{owner:new PublicKey(row.owner),executable:row.executable,data:Buffer.from(row.data,"base64"),lamports:1,rentEpoch:0}:null;};
    const connection={rpcEndpoint:"https://base.invalid/",getAccountInfo:async(address:PublicKey)=>info(address),
      getAccountInfoAndContext:async(address:PublicKey)=>({context:{slot:1000},value:info(address)}),
      getMultipleAccountsInfo:async(addresses:PublicKey[])=>addresses.map(info)} as unknown as Connection;
    const view=await fetchDailyView({connection,wallet:reader,dayId:day});
    if(!view)throw new Error("Fixture Daily disappeared");
    const lifecycle=computeArcadeLifecycle({view,hasActiveRun:view.activeRunId!==0n,nowUnix:observedNow});
    let dependency="ready",preparation="ready";
    try{await assertRankedEntryDependencies({connection,wallet:reader,daily:view});}catch{dependency="unavailable";}
    if(variant==="occupied"){
      const run=JSON.parse(readFileSync(resolve(repositoryRoot,"fixtures/unity-run-client-v1.json"),"utf8")).successor;
      run.address = deriveRunAddresses(owner.publicKey, view.nextRunId).activeRun.toBase58();
      map.set(run.address,run);rows.occupied=run;
    }
    try{await buildPrepareDailyRunPlan({connection,wallet,ownerAuthority:owner.publicKey,sessionToken:new PublicKey(plans.accounts.session.address),daily:view,sessionValidUntil:now+3600});}catch{preparation="unavailable";}
    dailyCases.push({variant,now:observedNow,rows,lifecycle,dependency,preparation});
  }
  const paths=["client/src/backend/solana/SolanaIdentitySessionLive.ts","client/src/backend/solana/session/deviceSessionFunding.ts",
    "client/src/backend/solana/content/dailyClient.ts","client/src/ui/components/arcade/arcadeLifecycle.ts"];
  return {schemaVersion:1,inputs:{now,day,owner:owner.publicKey.toBase58(),device:device.publicKey.toBase58(),rent},sessionCases,dailyCases,
    provenance:{...Object.fromEntries(paths.map(path=>[path,createHash("sha256").update(readFileSync(resolve(repositoryRoot,path))).digest("hex")])),
      "client/tools/unity/readiness-fixtures.ts":createHash("sha256").update(readFileSync(new URL(import.meta.url))).digest("hex")}};
}
