import { Context, Effect, Layer, Scope, Stream, SubscriptionRef } from "effect";
import { PublicKey, type Connection } from "@solana/web3.js";
import { Content, Identity, Runs, Session, type ContentService, type RunsService } from "../../services";
import { ContentUnavailable, RunsRejected } from "../../errors";
import type { RunView } from "../../views";
import { LocalCampaignProgress, makeLocalBackendLive, packCampaignStars } from "../../local/LocalBackendLive";
import { inspectSession, SolanaIdentitySessionState } from "../SolanaIdentitySessionLive";
import { createReadOnlyWallet } from "../identity/readOnlyWallet";
import { buildRecordCampaignStarsPlan, fetchPlayerStateView } from "../economy/playerStateClient";
import { compileWalletTransactionPlan, WALLET_SEND_OPTIONS } from "../runs/runPlan";
import { SessionWallet } from "../session/sessionWallet";

export class MoneyCampaign extends Context.Tag("zkube/solana/MoneyCampaign")<MoneyCampaign, {
  start: RunsService["startCampaign"];
  act: RunsService["act"];
  resume: () => ReturnType<RunsService["resume"]>;
  events: RunsService["events"];
  catalog: ContentService["catalog"];
  stars: Stream.Stream<readonly number[]>;
}>() {}

/** Owner-keyed instances of the same local backend used by the store identity. */
export function makeMoneyCampaignLive(connection: Connection) {
  return Layer.scoped(MoneyCampaign, Effect.gen(function* () {
    const identity = yield* SolanaIdentitySessionState;
    const identityEvents = yield* Identity;
    const deviceEvents = yield* Session;
    const scope = yield* Scope.Scope;
    const stars = yield* SubscriptionRef.make<readonly number[]>(Array(100).fill(0));
    const records = new Map<string, Promise<Local>>();
    let stopped = false;
    yield* Effect.addFinalizer(() => Effect.sync(() => { stopped = true; }));
    type Local = { owner: string; runs: RunsService; content: ContentService;
      progress: Context.Tag.Service<typeof LocalCampaignProgress>; pending?: Promise<void>; retryRequested?: boolean };
    const current = (owner: string) => !stopped && identity.binding()?.wallet.publicKey.toBase58() === owner;

    // The persisted dirty flag is the retry intent. No shared transaction lock
    // or owner signature is involved in this cosmetic maximum merge.
    const sync = (local: Local) => {
      if (!current(local.owner)) return;
      if (local.pending) { local.retryRequested = true; return; }
      local.pending = (async () => {
        const owner = new PublicKey(local.owner);
        const profile = await fetchPlayerStateView({ connection, owner, wallet: createReadOnlyWallet(owner) });
        if (stopped) return;
        await Effect.runPromise(local.progress.merge(Uint8Array.from(profile?.campaignStars ?? new Uint8Array(25))));
        if (!current(local.owner) || !local.progress.read().campaignWritePending) return;
        const inspected = await inspectSession(connection, owner, Math.floor(Date.now() / 1000));
        if (!inspected || inspected.needsAuthorization || inspected.funding !== "ready" || !current(local.owner)) return;
        const device = inspected.session;
        const submitted = packCampaignStars(local.progress.read().stars);
        const wallet = new SessionWallet(device.signer);
        const plan = await buildRecordCampaignStarsPlan({ connection, wallet, ownerAuthority: owner,
          sessionToken: device.sessionToken, stars: submitted });
        const transaction = await compileWalletTransactionPlan({ transactionPlan: plan, wallet });
        if (!current(local.owner) || identity.deviceSession()?.sessionToken.toBase58() !== device.sessionToken.toBase58() ||
            device.validUntil <= Math.floor(Date.now() / 1000)) return;
        const signature = await connection.sendRawTransaction(transaction.serialize(), WALLET_SEND_OPTIONS);
        const result = await connection.confirmTransaction(signature, "confirmed");
        if (!stopped && !result.value.err) await Effect.runPromise(local.progress.acknowledge(submitted));
      })().catch(() => undefined).finally(() => {
        local.pending = undefined;
        if (local.retryRequested) { local.retryRequested = false; sync(local); }
      });
    };
    const select = () => Effect.tryPromise({
      try: async () => {
        const owner = identity.binding()?.wallet.publicKey.toBase58();
        if (!owner || stopped) throw new Error("Connect an address to play Campaign");
        let building = records.get(owner);
        if (!building) {
          building = Effect.runPromise(Effect.gen(function* () {
            const context = yield* Layer.buildWithScope(makeLocalBackendLive({ target: "money", owner }), scope);
            const local: Local = { owner, runs: Context.get(context, Runs), content: Context.get(context, Content),
              progress: Context.get(context, LocalCampaignProgress) };
            yield* local.progress.changes.pipe(Stream.runForEach(value => Effect.sync(() => {
              if (current(owner)) Effect.runSync(SubscriptionRef.set(stars, value));
            })), Effect.forkIn(scope));
            return local;
          }));
          records.set(owner, building);
          void building.catch(() => { records.delete(owner); });
        }
        const local = await building;
        if (!current(owner)) throw new Error("Campaign owner changed");
        Effect.runSync(SubscriptionRef.set(stars, local.progress.read().stars));
        return local;
      }, catch: cause => new RunsRejected({ message: cause instanceof Error ? cause.message : String(cause) }),
    });
    const refresh = select().pipe(Effect.tap(local => Effect.sync(() => sync(local))), Effect.asVoid,
      Effect.catchAll(() => SubscriptionRef.set(stars, Array(100).fill(0))));
    yield* Stream.merge(identityEvents.state.pipe(Stream.map(() => undefined)), deviceEvents.state.pipe(Stream.map(() => undefined)))
      .pipe(Stream.runForEach(() => refresh), Effect.catchAll(() => Effect.void), Effect.forkScoped);
    // Negative local identifiers remain distinct from the unsigned Arcade IDs
    // and retain their owner through the public numeric presentation boundary.
    const ownerBits = (local: Local) => BigInt("0x" + Buffer.from(new PublicKey(local.owner).toBytes()).toString("hex"));
    const view = (local: Local, value: RunView | null) => value ? { ...value,
      runId: (-((ownerBits(local) << 64n) | BigInt(value.runId))).toString() } : null;
    const localId = (local: Local, runId: string) => {
      const value = -BigInt(runId);
      if (value <= 0n || value >> 64n !== ownerBits(local)) throw new Error("Campaign run belongs to another address");
      return (value & ((1n << 64n) - 1n)).toString();
    };
    return {
      start: (realm, level) => select().pipe(Effect.flatMap(local => local.runs.startCampaign(realm, level)
        .pipe(Effect.map(value => view(local, value)!), Effect.tap(() => Effect.sync(() => sync(local)))))),
      resume: () => select().pipe(Effect.flatMap(local => local.runs.resume("campaign")
        .pipe(Effect.map(value => view(local, value)), Effect.tap(() => Effect.sync(() => sync(local)))))),
      act: (runId, action) => select().pipe(Effect.flatMap(local => Effect.try({ try: () => localId(local, runId),
        catch: () => new RunsRejected({ message: "Campaign run belongs to another address" }) }).pipe(
        Effect.flatMap(id => local.runs.act(id, action)), Effect.map(value => view(local, value)!),
        Effect.tap(value => Effect.sync(() => { if (value.phase === "finished" || value.phase === "levelComplete") sync(local); }))))),
      events: runId => Stream.unwrap(select().pipe(Effect.map(local => local.runs.events(localId(local, runId))))),
      catalog: () => select().pipe(Effect.flatMap(local => local.content.catalog()),
        Effect.mapError(cause => new ContentUnavailable({ message: cause.message }))),
      stars: stars.changes,
    };
  }));
}
