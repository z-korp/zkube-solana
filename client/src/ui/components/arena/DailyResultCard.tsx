import React, { type ReactNode } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { motion } from "motion/react";

import { getZoneGuardian } from "@/config/bossCharacters";
import { ZONE_NAMES } from "@/config/profileData";
import { getThemeColors, getThemeImages, type ThemeId } from "@/config/themes";
import type { DailyView } from "@/chain/dailyClient";
import { Countdown } from "@/ui/components/arena/Countdown";
import type { PlayerPosition } from "@/ui/components/arena/dailyPosition";

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
  /** When set, the card becomes a toggle that reveals `children` below. */
  onToggle?: () => void;
  expanded?: boolean;
  children?: ReactNode;
}> = ({
  daily,
  position,
  label,
  action,
  onRefund,
  onToggle,
  expanded = false,
  children,
}) => {
  const zoneId = daily.mapId || 1;
  const zoneName = ZONE_NAMES[zoneId] ?? `Zone ${zoneId}`;
  const zoneThemeId = `theme-${Math.min(10, Math.max(1, zoneId))}` as ThemeId;
  const zoneColors = getThemeColors(zoneThemeId);
  const zoneImages = getThemeImages(zoneThemeId);
  const guardian = getZoneGuardian(zoneId);
  const canRefund = daily.status === "cancelled" && hasPendingRefund(daily);
  const isBusy = action === "refund";

  const header = (
    <div className="relative z-10 flex items-start justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p
          className="font-sans text-[10px] font-bold uppercase tracking-[0.14em]"
          style={{ color: zoneColors.accent }}
        >
          {label} · {formatDailyDate(daily.opensAt)}
        </p>
        <p className="mt-0.5 font-sans text-[11px] font-semibold text-white/55">
          {zoneName} · {guardian.name}
        </p>
        {position ? (
          <p className="mt-1 font-display text-lg font-black text-white">
            <span style={{ color: zoneColors.accent2 }}>#{position.rank}</span>{" "}
            · {position.score.toLocaleString()}{" "}
            <span className="text-sm font-bold text-white/45">pts</span>
          </p>
        ) : (
          <p className="mt-1 font-sans text-[11px] text-white/50">
            No entry · {daily.attemptsStarted.toString()} run
            {daily.attemptsStarted === 1n ? "" : "s"} started
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <StatusAction
          daily={daily}
          canRefund={canRefund}
          isBusy={isBusy}
          action={action}
          onRefund={onRefund}
        />
        {onToggle && (
          <ChevronDown
            size={18}
            className={`transition-transform ${expanded ? "rotate-180" : ""}`}
            style={{ color: "rgba(255,255,255,0.6)" }}
          />
        )}
      </div>
    </div>
  );

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
      {onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          className="block w-full text-left transition-transform active:scale-[0.99]"
        >
          {header}
        </button>
      ) : (
        header
      )}
      {expanded && children && (
        <div className="relative z-10 border-t border-white/10 bg-black/45 px-4 py-2.5">
          {children}
        </div>
      )}
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
  return player.attempts > 0 && !player.cubeRefunded;
}

function formatDailyDate(timestamp: number): string {
  return new Date(timestamp * 1_000).toLocaleDateString(navigator.language, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

export default DailyResultCard;
