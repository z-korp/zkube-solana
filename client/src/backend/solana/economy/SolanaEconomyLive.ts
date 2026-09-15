import { MoneyCampaign } from "../content/MoneyCampaignLive";
import { Effect, Layer, Schedule, Stream, SubscriptionRef } from "effect";
import type { Connection } from "@solana/web3.js";

import {
  coreLadderTier,
  initializeZkubeCore,
} from "@/core/zkubeCore";
import { currentDailyDayId } from "@/core/dailyRules";
import { EconomyRejected } from "../../errors";
import { Economy, type EconomyService } from "../../services";
import type {
  BoardKind,
  ClaimableReward,
  EconomyState,
} from "../../views";
import {
  SolanaIdentitySessionState,
  type SolanaIdentitySessionStateService,
} from "../SolanaIdentitySessionLive";
import {
  buildClaimDailyPrizePlan,
  buildPurchaseKreditsPlan,
  fetchUnclaimedRewards,
} from "../content/dailyClient";
import { unpackCompactLevelStars } from "../content/campaignClient";
import { SessionWallet } from "../session/sessionWallet";
import { SolanaWalletDriver } from "../wallet/SolanaWalletDriver";
import { submitVersionedTransactionPlan } from "../runs/runPlan";
import {
  buildSetFeaturedEmblemPlan,
  fetchPlayerStateView,
  type PlayerStateView,
} from "./playerStateClient";

export interface SolanaEconomyOptions {
  readonly connection: Connection;
}

/** Unwired Economy slice; composed with the other five services at the switch. */
export function makeSolanaEconomyLive(
  options: SolanaEconomyOptions,
): Layer.Layer<Economy, never, SolanaIdentitySessionState | SolanaWalletDriver | MoneyCampaign> {
  return Layer.scoped(
    Economy,
    Effect.gen(function* () {
      const identity = yield* SolanaIdentitySessionState;
      const campaign = yield* MoneyCampaign;
      yield* SolanaWalletDriver;
      const stateRef = yield* SubscriptionRef.make<EconomyState>(emptyEconomy());
      const reload = () => loadEconomy(options.connection, identity);

      yield* Stream.repeatEffectWithSchedule(
        Effect.promise(reload),
        Schedule.spaced("15 seconds"),
      ).pipe(
        Stream.runForEach((state) => SubscriptionRef.set(stateRef, state)),
        Effect.catchAll(() => Effect.void),
        Effect.forkScoped,
      );

      const mutate = <A>(operation: () => Promise<A>) =>
        Effect.tryPromise({
          try: async () => {
            await operation();
            const state = await reload();
            Effect.runSync(SubscriptionRef.set(stateRef, state));
            return state;
          },
          catch: (cause) =>
            new EconomyRejected({ message: message(cause) }),
        });

      const economy: EconomyService = {
        buy: (pack) =>
          mutate(async () => {
            const binding = requireBinding(identity);
            const plan = await buildPurchaseKreditsPlan({
              connection: options.connection,
              ownerWallet: binding.wallet,
              kreditCount: pack,
            });
            const signature = await submitVersionedTransactionPlan({
              transactionPlan: plan,
              wallet: binding.wallet,
            });
            await options.connection.confirmTransaction(signature, "confirmed");
          }),
        claim: (dayId, board) =>
          mutate(async () => {
            const { owner, wallet, sessionToken } = requireSession(identity);
            const rewards = await fetchUnclaimedRewards({
              connection: options.connection,
              owner,
              currentDayId: currentDailyDayId(),
            });
            const reward = rewards.find(
              (candidate) =>
                candidate.dayId === dayId && candidate.board === board,
            );
            if (!reward) throw new Error("Daily reward is not claimable");
            const plan = await buildClaimDailyPrizePlan({
              connection: options.connection,
              wallet,
              ownerAuthority: owner,
              sessionToken,
              dayId,
              board,
              position: reward.position,
            });
            const signature = await submitVersionedTransactionPlan({
              transactionPlan: plan,
              wallet,
            });
            await options.connection.confirmTransaction(signature, "confirmed");
          }),
        setWorn: (emblem, border) =>
          mutate(async () => {
            const { owner, wallet, sessionToken } = requireSession(identity);
            const plan = await buildSetFeaturedEmblemPlan({
              connection: options.connection,
              wallet,
              ownerAuthority: owner,
              sessionToken,
              emblemId: emblem,
              frameTier: border,
            });
            const signature = await submitVersionedTransactionPlan({
              transactionPlan: plan,
              wallet,
            });
            await options.connection.confirmTransaction(signature, "confirmed");
          }),
        state: Stream.zipLatest(stateRef.changes, campaign.stars).pipe(Stream.map(([state, stars]) => ({
          ...state, profile: { ...state.profile, stars: [...stars] },
        }))),
      };
      return economy;
    }),
  );
}

async function loadEconomy(
  connection: Connection,
  identity: SolanaIdentitySessionStateService,
): Promise<EconomyState> {
  const binding = identity.binding();
  if (!binding) return emptyEconomy();
  const owner = binding.wallet.publicKey;
  const [profile, claimable] = await Promise.all([
    fetchPlayerStateView({ connection, wallet: binding.wallet, owner }),
    fetchUnclaimedRewards({
      connection,
      owner,
      currentDayId: currentDailyDayId(),
    }).catch(() => []),
    initializeZkubeCore(),
  ]);
  return projectSolanaEconomy(profile, claimable);
}

export function projectSolanaEconomy(
  profile: PlayerStateView | null,
  claimable: ReadonlyArray<{
    dayId: number;
    board: BoardKind;
    amountLamports: bigint;
    expiresAt: number;
  }>,
): EconomyState {
  if (!profile) return emptyEconomy();
  const rewards: ClaimableReward[] = claimable.map((reward) => ({
    dayId: reward.dayId,
    board: reward.board,
    lamports: reward.amountLamports,
    expiresAt: reward.expiresAt,
  }));
  return {
    kredits: profile.kreditBalance,
    claimable: rewards,
    profile: {
      stars: Array.from({ length: 10 }, (_, mapIndex) =>
        unpackCompactLevelStars(profile.campaignStars, mapIndex),
      ).flat(),
      ladderPoints: profile.ladderPoints,
      ladderTier: coreLadderTier(profile.ladderPoints),
      highestTier: profile.highestLadderTier,
      wornEmblem: profile.featuredEmblem,
      wornBorder: profile.featuredFrameTier,
      records: {
        score: { ...profile.scoreRecord },
        theme: { ...profile.themeRecord },
      },
      streak: profile.entryStreakDays,
      bestScore: profile.bestDailyScore,
    },
  };
}

function emptyEconomy(): EconomyState {
  const emptyRecord = {
    bestPrizeRank: 0,
    podiums: 0,
    wins: 0,
    rewardsLamports: 0n,
  };
  return {
    kredits: 0n,
    claimable: [],
    profile: {
      stars: Array<number>(100).fill(0),
      ladderPoints: 0n,
      ladderTier: 0,
      highestTier: 0,
      wornEmblem: 0,
      wornBorder: 0,
      records: { score: emptyRecord, theme: { ...emptyRecord } },
      streak: 0,
      bestScore: 0,
    },
  };
}

function requireBinding(identity: SolanaIdentitySessionStateService) {
  const binding = identity.binding();
  if (!binding) throw new Error("Connect the owner wallet first");
  return binding;
}

function requireSession(identity: SolanaIdentitySessionStateService) {
  const binding = requireBinding(identity);
  const session = identity.deviceSession();
  if (!session) throw new Error("Enable this device first");
  return {
    owner: binding.wallet.publicKey,
    wallet: new SessionWallet(session.signer),
    sessionToken: session.sessionToken,
  };
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
