import React, { useMemo } from "react";

import {
  AUTO_EMBLEM_ID,
  resolveFeaturedEmblem,
  type EmblemZoneInput,
} from "@/config/emblems";
import { EmblemBadge, GuardianMedallion } from "@/ui/components/economy";
import PlayerIdentityHeader from "@/ui/components/shared/PlayerIdentityHeader";
import { useThemeColors } from "@/ui/elements/theme-provider/hooks";

/** EmblemBadge render state, mirrored locally since it is not exported. */
type BadgeState = "unlocked" | "locked" | "gold";

interface ProfileHeaderCardProps {
  displayName: string | null | undefined;
  address: string;
  /** Stored featured emblem id (0 = auto). */
  featuredEmblem: number;
  /** Per-zone Campaign progress, used to resolve the featured emblem. */
  zones: readonly EmblemZoneInput[];
  /** Links the wallet pill to Settings. */
  onEditIdentity?: () => void;
}

/**
 * Profile identity header: the resolved featured emblem alongside the player's
 * display name and wallet, with a caption naming the featured emblem. Guardian
 * emblems render as a circular medallion; auto/realm/world render as a badge
 * tile. The emblem is cosmetic and reflects Campaign progress only.
 */
const ProfileHeaderCard: React.FC<ProfileHeaderCardProps> = ({
  displayName,
  address,
  featuredEmblem,
  zones,
  onEditIdentity,
}) => {
  const colors = useThemeColors();

  const featured = useMemo(
    () => resolveFeaturedEmblem(featuredEmblem, zones),
    [featuredEmblem, zones],
  );

  const isGuardian =
    featured.descriptor.kind === "guardian" &&
    typeof featured.descriptor.zoneId === "number";
  const badgeState: BadgeState = featured.gold
    ? "gold"
    : featured.unlocked
      ? "unlocked"
      : "locked";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        {isGuardian ? (
          <GuardianMedallion
            zoneId={featured.descriptor.zoneId as number}
            size={64}
            glow={featured.gold}
            className="shrink-0"
          />
        ) : (
          <EmblemBadge
            emblemId={featured.descriptor.id}
            state={badgeState}
            size={64}
            showAuto={
              featuredEmblem === AUTO_EMBLEM_ID &&
              featured.descriptor.id !== AUTO_EMBLEM_ID
            }
            className="shrink-0"
          />
        )}
        <div className="min-w-0 flex-1">
          <PlayerIdentityHeader
            displayName={displayName}
            address={address}
            onEditIdentity={onEditIdentity}
          />
        </div>
      </div>

      <p className="font-sans text-[11px] font-semibold text-white/50">
        Featured:{" "}
        <span className="font-bold" style={{ color: colors.accent2 }}>
          {featured.descriptor.name}
        </span>
      </p>
    </div>
  );
};

export default ProfileHeaderCard;
