import React, { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { motion } from "motion/react";

import { getZoneGuardian } from "@/config/bossCharacters";
import { getMutatorDef } from "@/config/mutatorConfig";
import { ZONE_NAMES } from "@/config/profileData";
import { getDailyRewardTiers } from "@/config/rewardTiers";
import {
  getThemeColors,
  getThemeImages,
  type ThemeColors,
  type ThemeId,
} from "@/config/themes";
import { useDaily } from "@/contexts/daily";
import { usePreviousChallenge } from "@/hooks/usePreviousChallenge";
import type { DailyView } from "@/chain/dailyClient";
import { useEmbeddedIdentity } from "@/chain/embeddedIdentityContext";
import TierContext, {
  type RankContextEntry,
} from "@/ui/components/rewards/TierContext";
import { truncatePublicKey } from "@/utils/solanaDisplay";

interface CountdownProps {
  endTime: number;
  colors: ThemeColors;
}

const Countdown: React.FC<CountdownProps> = ({ endTime, colors }) => {
  const [seconds, setSeconds] = useState(() =>
    Math.max(0, endTime - Math.floor(Date.now() / 1_000)),
  );

  useEffect(() => {
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, endTime - Math.floor(Date.now() / 1_000));
      setSeconds(remaining);
      if (remaining <= 0) window.clearInterval(timer);
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [endTime]);

  if (seconds <= 0) {
    return (
      <span className="rounded-full bg-yellow-500/80 px-3 py-1.5 font-sans text-xs font-bold text-black">
        FINALIZING
      </span>
    );
  }

  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;
  return (
    <span
      className="rounded-full px-3 py-1.5 font-sans text-xs font-bold tabular-nums text-white"
      style={{ background: colors.accent }}
    >
      {String(hours).padStart(2, "0")}:{String(minutes).padStart(2, "0")}:
      {String(remainder).padStart(2, "0")}
    </span>
  );
};

interface DailyTabProps {
  colors: ThemeColors;
}

const DailyTab: React.FC<DailyTabProps> = ({ colors }) => {
  const current = useDaily();
  const previous = usePreviousChallenge();
  const { publicKey } = useEmbeddedIdentity();
  const address = publicKey.toBase58();

  const currentPosition = useMemo(
    () => getPlayerPosition(current.daily, address),
    [address, current.daily],
  );
  const previousPosition = useMemo(
    () => getPlayerPosition(previous.daily, address),
    [address, previous.daily],
  );
  const currentEntries = useMemo(
    () => toRankEntries(current.daily),
    [current.daily],
  );

  if (current.loading && !current.daily) {
    return (
      <div
        className="flex flex-col items-center justify-center py-16"
        style={{ color: colors.textMuted }}
      >
        <Loader2
          className="mb-4 h-8 w-8 animate-spin"
          style={{ color: colors.accent }}
        />
        <p className="font-sans text-sm font-medium">
          Loading daily challenge...
        </p>
      </div>
    );
  }

  return (
    <motion.div
      variants={{
        hidden: { opacity: 0 },
        show: { opacity: 1, transition: { staggerChildren: 0.06 } },
      }}
      initial="hidden"
      animate="show"
      className="flex flex-col gap-3"
    >
      {previous.daily?.player && (
        <DailyCard
          daily={previous.daily}
          position={previousPosition}
          label="Previous Daily"
          action={previous.action}
          onClaim={() => void previous.claim().catch(() => undefined)}
          onRefund={() => void previous.refund().catch(() => undefined)}
        />
      )}

      {!current.daily ? (
        <div
          className="flex flex-col items-center justify-center py-16 text-center"
          style={{ color: colors.textMuted }}
        >
          <span className="mb-4 text-4xl">📅</span>
          <p
            className="font-sans text-lg font-semibold"
            style={{ color: colors.text }}
          >
            No daily challenge yet
          </p>
          <p className="mt-1 font-sans text-sm">
            Today&apos;s challenge has not been published.
          </p>
        </div>
      ) : (
        <>
          <DailyCard
            daily={current.daily}
            position={currentPosition}
            label="Today"
            action={current.action}
            onClaim={() => void current.claim().catch(() => undefined)}
            onRefund={() => void current.refund().catch(() => undefined)}
          />

          {currentPosition && (
            <motion.section
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <TierContext
                colors={colors}
                myRank={currentPosition.rank}
                myScore={currentPosition.score}
                myName="You"
                entries={currentEntries}
                scoreLabel=" pts"
              />
            </motion.section>
          )}
        </>
      )}

      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-2.5 text-center"
      >
        <p className="font-sans text-[11px] font-semibold text-white/50">
          The on-chain top 10 share the finalized USDC prize pool. Today&apos;s
          rank weights: {formatPayoutSummary(current.daily?.payoutBps ?? [])}.
        </p>
      </motion.section>

      {(current.error || previous.error) && (
        <p role="alert" className="text-center font-sans text-xs text-red-300">
          {current.error ?? previous.error}
        </p>
      )}
    </motion.div>
  );
};

function DailyCard({
  daily,
  position,
  label,
  action,
  onClaim,
  onRefund,
}: {
  daily: DailyView;
  position: PlayerPosition | null;
  label: string;
  action: string | null;
  onClaim: () => void;
  onRefund: () => void;
}) {
  const zoneId = daily.mapId || 1;
  const zoneName = ZONE_NAMES[zoneId] ?? `Zone ${zoneId}`;
  const zoneThemeId = `theme-${Math.min(10, Math.max(1, zoneId))}` as ThemeId;
  const zoneColors = getThemeColors(zoneThemeId);
  const zoneImages = getThemeImages(zoneThemeId);
  const guardian = getZoneGuardian(zoneId);
  const activeMutator = daily.rules.activeMutatorId
    ? getMutatorDef(daily.rules.activeMutatorId)
    : null;
  const passiveMutator = daily.rules.passiveMutatorId
    ? getMutatorDef(daily.rules.passiveMutatorId)
    : null;
  const player = daily.player;
  const canClaim =
    daily.status === "claimable" &&
    daily.claimsCloseAt > 0 &&
    Math.floor(Date.now() / 1_000) <= daily.claimsCloseAt &&
    Boolean(player) &&
    !player?.claimed &&
    position !== null &&
    position.rank <= 10;
  const canRefund = daily.status === "cancelled" && hasPendingRefund(daily);
  const isBusy = action === "claim" || action === "refund";

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 24 }}
      className="relative overflow-hidden rounded-2xl border"
      style={{ borderColor: `${zoneColors.accent}35` }}
    >
      <img
        src={zoneImages.background}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/70 to-black/50" />
      <div className="relative z-10 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p
              className="font-sans text-[10px] font-bold uppercase tracking-[0.14em]"
              style={{ color: zoneColors.accent }}
            >
              {label} · {formatDailyDate(daily.opensAt)}
            </p>
            <p className="mt-1 font-sans text-sm font-bold text-white">
              {zoneName} · {guardian.name}
            </p>
            {position ? (
              <p className="font-sans text-[11px] text-white/60">
                #{position.rank} · {position.score.toLocaleString()} pts
              </p>
            ) : (
              <p className="font-sans text-[11px] text-white/60">
                {daily.runsStarted.toString()} run
                {daily.runsStarted === 1n ? "" : "s"} started
              </p>
            )}
          </div>
          <DailyAction
            daily={daily}
            canClaim={canClaim}
            canRefund={canRefund}
            isBusy={isBusy}
            action={action}
            onClaim={onClaim}
            onRefund={onRefund}
          />
        </div>

        {(activeMutator || passiveMutator) && (
          <p className="mt-2 font-sans text-[10px] text-white/45">
            {[activeMutator?.name, passiveMutator?.name]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}
      </div>
    </motion.section>
  );
}

function DailyAction({
  daily,
  canClaim,
  canRefund,
  isBusy,
  action,
  onClaim,
  onRefund,
}: {
  daily: DailyView;
  canClaim: boolean;
  canRefund: boolean;
  isBusy: boolean;
  action: string | null;
  onClaim: () => void;
  onRefund: () => void;
}) {
  const player = daily.player;
  if (player?.claimed) {
    return (
      <span className="shrink-0 rounded-full bg-green-500 px-3 py-1.5 font-sans text-xs font-bold text-white">
        {formatUsdc(player.prizeAmount)} USDC claimed
      </span>
    );
  }
  if (canClaim) {
    return (
      <motion.button
        whileTap={{ scale: 0.95 }}
        type="button"
        onClick={onClaim}
        disabled={isBusy}
        className="shrink-0 rounded-full bg-green-500 px-3 py-1.5 font-sans text-xs font-bold text-white disabled:opacity-50"
      >
        {action === "claim" ? (
          <span className="flex items-center gap-1.5">
            <Loader2 className="h-3 w-3 animate-spin" /> Claiming…
          </span>
        ) : (
          "Claim USDC"
        )}
      </motion.button>
    );
  }
  if (canRefund) {
    return (
      <motion.button
        whileTap={{ scale: 0.95 }}
        type="button"
        onClick={onRefund}
        disabled={isBusy}
        className="shrink-0 rounded-full bg-yellow-500 px-3 py-1.5 font-sans text-xs font-bold text-black disabled:opacity-50"
      >
        {action === "refund" ? (
          <span className="flex items-center gap-1.5">
            <Loader2 className="h-3 w-3 animate-spin" /> Refunding…
          </span>
        ) : (
          "Claim refund"
        )}
      </motion.button>
    );
  }
  if (daily.status === "open") {
    return (
      <Countdown
        endTime={daily.runsCloseAt}
        colors={getThemeColors(
          `theme-${Math.min(10, Math.max(1, daily.mapId))}` as ThemeId,
        )}
      />
    );
  }
  if (daily.status === "entriesClosed" || daily.status === "finalizing") {
    return (
      <span className="shrink-0 rounded-full bg-yellow-500/80 px-3 py-1.5 font-sans text-xs font-bold text-black">
        FINALIZING
      </span>
    );
  }
  if (daily.status === "claimable") {
    const claimWindowExpired =
      daily.claimsCloseAt > 0 &&
      Math.floor(Date.now() / 1_000) > daily.claimsCloseAt;
    return (
      <span className="shrink-0 rounded-full bg-white/60 px-3 py-1.5 font-sans text-xs font-bold text-black">
        {claimWindowExpired ? "Claim window closed" : "No prize"}
      </span>
    );
  }
  if (daily.status === "cancelled") {
    return (
      <span className="shrink-0 rounded-full bg-white/60 px-3 py-1.5 font-sans text-xs font-bold text-black">
        Refunded
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-full border border-white/20 bg-black/25 px-3 py-1.5 font-sans text-xs font-bold text-white/65">
      {daily.status === "closed" ? "CLOSED" : daily.status.toUpperCase()}
    </span>
  );
}

interface PlayerPosition {
  rank: number;
  score: number;
}

function getPlayerPosition(
  daily: DailyView | null,
  address: string,
): PlayerPosition | null {
  if (!daily?.player) return null;
  const leaderboardIndex = daily.leaderboard.findIndex(
    (entry) => entry.player.toBase58() === address,
  );
  const rank =
    leaderboardIndex >= 0
      ? leaderboardIndex + 1
      : daily.player.rank > 0
        ? daily.player.rank
        : null;
  if (rank === null) return null;
  return { rank, score: daily.player.bestScore };
}

function toRankEntries(daily: DailyView | null): RankContextEntry[] {
  return (daily?.leaderboard ?? []).map((entry, index) => {
    const address = entry.player.toBase58();
    return {
      rank: index + 1,
      score: entry.score,
      name: truncatePublicKey(address),
    };
  });
}

function hasPendingRefund(daily: DailyView): boolean {
  const player = daily.player;
  if (!player) return false;
  const paidTotal = BigInt(player.paidAttempts) * daily.entryPrice;
  return (
    paidTotal > player.refundedAmount ||
    (player.freeAttemptUsed && !player.starRefunded)
  );
}

function formatUsdc(value: bigint): string {
  const whole = value / 1_000_000n;
  const fraction = (value % 1_000_000n)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function formatPayoutSummary(payoutBps: readonly number[]): string {
  const tiers = getDailyRewardTiers(payoutBps);
  if (tiers.length === 0) return "not published";
  return tiers
    .map((tier) => `${tier.label} ${tier.payoutBps / 100}%`)
    .join(" · ");
}

function formatDailyDate(timestamp: number): string {
  return new Date(timestamp * 1_000).toLocaleDateString(navigator.language, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

export default DailyTab;
