import React, { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { motion } from "motion/react";

import { getZoneGuardian } from "@/config/bossCharacters";
import { dailyScoringRuleName } from "@/chain/dailyRules";
import { ZONE_NAMES } from "@/config/profileData";
import {
  getThemeColors,
  getThemeImages,
  type ThemeColors,
  type ThemeId,
} from "@/config/themes";
import type { DailyView } from "@/chain/dailyClient";
import type { PlayerPosition } from "@/ui/components/arena/dailyPosition";
import { formatCountdown } from "@/utils/time";

export const Countdown: React.FC<{
  endTime: number;
  colors: ThemeColors;
}> = ({ endTime, colors }) => {
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

  return (
    <span
      className="rounded-full px-3 py-1.5 font-sans text-xs font-bold tabular-nums text-white"
      style={{ background: colors.accent }}
    >
      {formatCountdown(seconds)}
    </span>
  );
};

/**
 * A finished (or finishing) daily as a compact result strip: zone art,
 * guardian, your best line, and the lifecycle pill — including the refund
 * action for cancelled dailies.
 */
const DailyResultCard: React.FC<{
  daily: DailyView;
  position: PlayerPosition | null;
  label: string;
  action: string | null;
  onRefund: () => void;
}> = ({ daily, position, label, action, onRefund }) => {
  const zoneId = daily.mapId || 1;
  const zoneName = ZONE_NAMES[zoneId] ?? `Zone ${zoneId}`;
  const zoneThemeId = `theme-${Math.min(10, Math.max(1, zoneId))}` as ThemeId;
  const zoneColors = getThemeColors(zoneThemeId);
  const zoneImages = getThemeImages(zoneThemeId);
  const guardian = getZoneGuardian(zoneId);
  const canRefund = daily.status === "cancelled" && hasPendingRefund(daily);
  const isBusy = action === "refund";

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
              <>
                <p className="font-sans text-[11px] text-white/60">
                  #{position.rank} · {position.score.toLocaleString()} daily
                </p>
                <p className="font-sans text-[10px] text-white/40">
                  +
                  {Math.max(
                    0,
                    position.score - position.engineScore,
                  ).toLocaleString()}{" "}
                  challenge · {position.engineScore.toLocaleString()} engine ·{" "}
                  {position.dailyBonusTriggers} bonus triggers · {position.moves} moves
                </p>
              </>
            ) : (
              <p className="font-sans text-[11px] text-white/60">
                {daily.attemptsStarted.toString()} run
                {daily.attemptsStarted === 1n ? "" : "s"} started
              </p>
            )}
          </div>
          <StatusAction
            daily={daily}
            canRefund={canRefund}
            isBusy={isBusy}
            action={action}
            onRefund={onRefund}
          />
        </div>

        <p className="mt-2 font-sans text-[10px] font-semibold text-cyan-200/75">
          {dailyScoringRuleName(daily.scoringRule)}
        </p>
      </div>
    </motion.section>
  );
};

function StatusAction({
  daily,
  canRefund,
  isBusy,
  action,
  onRefund,
}: {
  daily: DailyView;
  canRefund: boolean;
  isBusy: boolean;
  action: string | null;
  onRefund: () => void;
}) {
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
    return (
      <span className="shrink-0 rounded-full bg-white/60 px-3 py-1.5 font-sans text-xs font-bold text-black">
        {daily.player?.weeklyRolledUp ? "WEEKLY ✓" : "ROLLING UP"}
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

function hasPendingRefund(daily: DailyView): boolean {
  const player = daily.player;
  if (!player) return false;
  return player.attempts > 0 && !player.starRefunded;
}

function formatDailyDate(timestamp: number): string {
  return new Date(timestamp * 1_000).toLocaleDateString(navigator.language, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

export default DailyResultCard;
