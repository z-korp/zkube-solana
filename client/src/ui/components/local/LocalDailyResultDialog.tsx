import { useClientState, useConnectedPlayer, useDaily } from "@/backend/client";
import { getZoneGuardian } from "@/config/bossCharacters";
import { ZONE_NAMES } from "@/config/profileData";
import { dailyThemeName } from "@/core/dailyRules";
import type { GameOverDialogProps } from "@/ui/components/GameOverDialog";
import ShareCardSheet from "@/ui/components/profile/ShareCardSheet";

export default function LocalDailyResultDialog({
  isOpen,
  onClose,
  closeDisabled = false,
  settlementFailed = false,
  settlementError = null,
  onRetrySettlement,
  game,
}: GameOverDialogProps) {
  const daily = useDaily();
  const { economy } = useClientState();
  const player = useConnectedPlayer();
  const guardian = getZoneGuardian(game.zoneId);
  const objective = daily.daily?.dailyTheme ?? { kind: 0, value: 0 };
  return (
    <ShareCardSheet
      open={isOpen}
      onClose={onClose}
      closeDisabled={closeDisabled}
      saveError={
        settlementFailed
          ? (settlementError ?? "The result could not be saved. Try again.")
          : null
      }
      onRetry={onRetrySettlement}
      data={{
        displayName: player.label ?? "Player",
        realm: ZONE_NAMES[game.zoneId] ?? `Realm ${game.zoneId}`,
        objective: dailyThemeName(objective),
        dailyScore: game.totalScore,
        objectiveTotal: BigInt(game.challengeBonus),
        streak: economy.profile.streak,
        guardianName: guardian.name,
        guardianGreeting: guardian.dailyGreeting,
        zoneId: game.zoneId,
      }}
    />
  );
}
