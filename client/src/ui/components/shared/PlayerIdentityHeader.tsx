import React from "react";

import LevelRing from "@/ui/components/shared/LevelRing";
import StarBalance from "@/ui/components/shared/StarBalance";
import WalletChip from "@/ui/components/shared/WalletChip";
import { useThemeColors } from "@/ui/elements/theme-provider/hooks";

/**
 * The shared identity row for Home and Profile: level ring (its color is the
 * rank), the player's display name over their wallet pill, and the Star
 * balance. The rank title is intentionally not text — it lives in the ring's
 * color and hover tooltip — so the header stays uncluttered. Profile renders
 * its XP bar separately below this row.
 */
const PlayerIdentityHeader: React.FC<{
  level: number;
  /** 0..1 progress through the current level (drives the ring arc). */
  progress: number;
  displayName: string | null | undefined;
  /** Cosmetic rank title — used as the name fallback and the ring tooltip. */
  title: string;
  address: string;
  starBalance: string | number;
  ringSize?: number;
  starSize?: "md" | "lg";
  /** Makes the wallet pill a button (Profile links it to Settings). */
  onEditIdentity?: () => void;
}> = ({
  level,
  progress,
  displayName,
  title,
  address,
  starBalance,
  ringSize = 52,
  starSize = "md",
  onEditIdentity,
}) => {
  const colors = useThemeColors();

  return (
    <div className="flex items-center gap-3">
      <LevelRing
        level={level}
        progress={progress}
        size={ringSize}
        title={title}
      />
      <div className="min-w-0 flex-1">
        <p
          className="truncate font-sans text-lg font-extrabold"
          style={{ color: colors.text }}
        >
          {displayName || title}
        </p>
        <WalletChip
          address={address}
          onClick={onEditIdentity}
          title={address || undefined}
          ariaLabel={
            onEditIdentity && address ? `Connected wallet ${address}` : undefined
          }
          className="mt-0.5"
        />
      </div>
      <StarBalance
        value={starBalance}
        size={starSize}
        align="right"
        className="shrink-0"
      />
    </div>
  );
};

export default PlayerIdentityHeader;
