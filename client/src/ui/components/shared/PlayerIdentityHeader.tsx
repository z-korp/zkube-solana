import React from "react";

import WalletChip from "@/ui/components/shared/WalletChip";
import { useThemeColors } from "@/ui/elements/theme-provider/hooks";
import { truncatePublicKey } from "@/utils/solanaDisplay";

/**
 * The shared identity row for Home and Profile: the player's display name over
 * their wallet pill. When no display name is set, the truncated address stands
 * in for it. Kept intentionally minimal — no rank, level, or XP surfaces exist.
 */
const PlayerIdentityHeader: React.FC<{
  displayName: string | null | undefined;
  address: string;
  /** Makes the wallet pill a button (Profile links it to Settings). */
  onEditIdentity?: () => void;
}> = ({ displayName, address, onEditIdentity }) => {
  const colors = useThemeColors();

  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <p
          className="truncate font-sans text-lg font-extrabold"
          style={{ color: colors.text }}
        >
          {displayName || truncatePublicKey(address)}
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
    </div>
  );
};

export default PlayerIdentityHeader;
