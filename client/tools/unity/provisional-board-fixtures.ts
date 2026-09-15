// Invoke the actual keeper adapter's read path; do not copy its comparator.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BorshAccountsCoder, convertIdlToCamelCase } from "@anchor-lang/core";
import BN from "bn.js";
import { PublicKey, type Connection } from "@solana/web3.js";
import { AnchorKeeperAdapter, MAX_ARENA_PLAYERS_PER_DAILY } from "../../../services/src/anchorIdlAdapter";
import type { BoardSourceSnapshot } from "../../../services/src/arcadeReconciliation";
import { IDL } from "../../src/backend/solana/idl/index";
import { deriveArenaDailyPda, deriveArenaPlayerPda } from "../../src/backend/solana/pdas";
import { ZKUBE_PROGRAM_ID } from "../../src/backend/solana/constants";
import { generateProductReadFixtures } from "./product-read-fixtures";
import { repositoryRoot } from "./solana-fixtures";

export async function generateProvisionalBoardFixtures() {
  const base = await generateProductReadFixtures();
  const coder = new BorshAccountsCoder(convertIdlToCamelCase(IDL));
  const source = coder.decode<Record<string, unknown>>("arenaPlayer", Buffer.from(base.arenaPlayer.data, "base64"));
  const day = base.inputs.day, challenge = deriveArenaDailyPda(day);
  const owner = (value:number) => { const bytes = new Uint8Array(32); bytes[0] = value & 255; bytes[1] = value >>> 8; return new PublicKey(bytes); };
  const wallets=Array.from({length:255},(_,index)=>owner(index+1));
  const rawTie=wallets.flatMap((left,index)=>wallets.slice(index+1).filter(right=>left.toBase58()>right.toBase58()).map(right=>[left,right] as const))[0];
  if(!rawTie||Buffer.compare(rawTie[0].toBuffer(),rawTie[1].toBuffer())>=0)throw new Error("Fixture lacks an adversarial raw-wallet tie");
  // Score and Theme leaders differ; a wallet tie must use bytes, while the
  // earliest timestamp beats wallet order. Zero metrics never qualify.
  const inputs = [
    { owner: owner(300), score: 1000, theme: 0n, finalized: 20n },
    { owner: rawTie[1], score: 200, theme: 8000n, finalized: 10n },
    { owner: rawTie[0], score: 200, theme: 9000n, finalized: 10n },
    { owner: owner(301), score: 200, theme: 0n, finalized: 9n },
    { owner: owner(302), score: 0, theme: 0n, finalized: 1n },
    { owner: owner(303), score: 1, theme: 1n, finalized: BigInt(Number.MAX_SAFE_INTEGER) },
    { owner: owner(304), score: 0, theme: 42n, finalized: 12n },
  ];
  const encodeInput=async(input:typeof inputs[number])=>{
    const best = { player: input.owner, score: input.score, objectiveTotal: new BN(input.theme.toString()),
      finalizedAt: new BN(input.finalized.toString()), replayHash: Array.from({length:32},()=>0) };
    const blank={...best,score:0,objectiveTotal:new BN(0),finalizedAt:new BN(0)};
    const data = Buffer.alloc(coder.size("arenaPlayer"));
    (await coder.encode("arenaPlayer", { ...source, player: input.owner, rentPayer: input.owner,
      paidEntries:1, resolvedEntries:1, hasScoreBest:input.score>0, hasThemeBest:input.theme>0n,
      scoreBestEntry:input.score>0?best:blank, themeBestEntry:input.theme>0n?best:blank,
      scoreBestRunId:new BN(input.score>0?1:0), themeBestRunId:new BN(input.theme>0n?1:0) })).copy(data);
    return { pubkey:deriveArenaPlayerPda(challenge,input.owner), account:{data,owner:ZKUBE_PROGRAM_ID,executable:false,lamports:1,rentEpoch:0} };
  };
  const rows = await Promise.all(inputs.map(encodeInput));
  let scannedRows=rows;
  const calls: unknown[] = [];
  const connection = { getProgramAccounts: async(program:PublicKey, config:unknown) => {
    if (!program.equals(ZKUBE_PROGRAM_ID)) throw new Error("Unexpected scan program");
    calls.push(config); return [...scannedRows].reverse();
  } } as unknown as Connection;
  const adapter = await AnchorKeeperAdapter.create({connection,nowUnix:base.inputs.now,release:{launchDayId:day}});
  // The method is private to the production adapter; this test-only structural
  // view executes it directly without introducing another production read API.
  const reader = adapter as unknown as { loadBoardSources(input:{snapshot:{dayId:number}}[]):Promise<Map<number,{score:BoardSourceSnapshot[];theme:BoardSourceSnapshot[]}>> };
  const boards = (await reader.loadBoardSources([{snapshot:{dayId:day}}])).get(day)!;
  const envelope=(row:typeof rows[number])=>({address:row.pubkey.toBase58(),owner:row.account.owner.toBase58(),executable:false,data:row.account.data.toString("base64")});
  const invalidTimestamps=[];
  for(const finalized of [BigInt(Number.MAX_SAFE_INTEGER)+1n,-1n]) {
    const invalid=await encodeInput({...inputs[5]!,finalized}); scannedRows=[invalid];
    let rejection:string|null=null;
    try {await reader.loadBoardSources([{snapshot:{dayId:day}}]);} catch(error) {rejection=error instanceof Error?error.message:String(error);}
    if(!rejection?.includes("finalization is invalid"))throw new Error("Keeper must reject the timestamp boundary fixture");
    invalidTimestamps.push({finalizedAt:finalized.toString(),envelope:envelope(invalid),rejection});
  }
  const encode = (values:BoardSourceSnapshot[]) => values.map((row,index)=>({rank:index+1,owner:row.owner.toBase58(),source:row.source.toBase58(),
    score:row.score,objectiveTotal:row.objectiveTotal.toString(),finalizedAt:row.finalizedAt}));
  const files=["services/src/anchorIdlAdapter.ts","programs/solana/src/state/arcade.rs","client/src/backend/solana/idl/solana.json"];
  return {schemaVersion:1,day,maximumScanAccounts:MAX_ARENA_PLAYERS_PER_DAILY,score:encode(boards.score),theme:encode(boards.theme),calls,
    accounts:rows.map(envelope),rawWalletTie:rawTie.map(key=>key.toBase58()),
    timestampBoundary:{maximumAccepted:Number.MAX_SAFE_INTEGER,invalidCases:invalidTimestamps},
    provenance:Object.fromEntries(files.map(path=>[path,createHash("sha256").update(readFileSync(resolve(repositoryRoot,path))).digest("hex")]))};
}
