import type { ZoneProgressData } from "@/config/profileData";
import type { ThemeColors } from "@/config/themes";
import { useCampaign } from "@/contexts/campaign";
import { useNavigationStore } from "@/stores/navigationStore";
import ArcadeButton from "@/ui/components/shared/ArcadeButton";
import Sheet from "@/ui/components/shared/Sheet";

interface UnlockModalProps {
  colors: ThemeColors;
  zone: ZoneProgressData;
  onClose: () => void;
}

const UnlockModal: React.FC<UnlockModalProps> = ({ colors, zone, onClose }) => {
  const campaign = useCampaign();
  const openShop = useNavigationStore((state) => state.openShop);
  // undefined means the unlock price is not known yet — never show 0★.
  const starCost = zone.starCost;
  const priceKnown = starCost !== undefined;
  const currentStars = Number(
    campaign.campaign?.starsBalance ?? BigInt(zone.currentStars ?? 0),
  );
  const canUnlockWithStars = priceKnown && currentStars >= starCost;
  const canSubmit = campaign.campaign !== null && !campaign.unlocking;
  const starsRemaining = priceKnown
    ? Math.max(starCost - currentStars, 0)
    : 0;

  const handleUnlock = async () => {
    try {
      await campaign.unlock(zone.zoneId);
      onClose();
    } catch {
      // The shared campaign controller exposes the actionable error below.
    }
  };

  const handleOpenShop = () => {
    onClose();
    openShop("home");
  };

  return (
    <Sheet
      open
      onClose={onClose}
      srTitle={`Unlock ${zone.name}`}
      dismissible={!campaign.unlocking}
    >
      <div className="mb-4 flex items-center gap-3">
        <span className="text-[34px]">{zone.emoji}</span>
        <div className="min-w-0 flex-1">
          <p
            className="font-sans text-[11px] font-bold uppercase tracking-[0.14em]"
            style={{ color: colors.accent }}
          >
            Unlock Zone
          </p>
          <p className="truncate font-display text-2xl font-black text-white">
            {zone.name}
          </p>
        </div>
      </div>

      <p className="mb-4 font-sans text-sm font-semibold text-white/70">
        {priceKnown ? (
          canUnlockWithStars ? (
            <>You have {currentStars}★</>
          ) : (
            <>
              You have {currentStars}★ ·{" "}
              <span style={{ color: colors.accent2 }}>
                Need {starsRemaining} more
              </span>
            </>
          )
        ) : (
          <>You have {currentStars}★</>
        )}
      </p>

      {!priceKnown ? (
        <ArcadeButton disabled>Loading price...</ArcadeButton>
      ) : canUnlockWithStars ? (
        <ArcadeButton disabled={!canSubmit} onClick={() => void handleUnlock()}>
          {campaign.unlocking ? "Unlocking..." : `Unlock for ${starCost}★`}
        </ArcadeButton>
      ) : (
        <ArcadeButton onClick={handleOpenShop}>Get Stars</ArcadeButton>
      )}

      {campaign.error && (
        <p className="mt-3 text-center font-sans text-sm text-red-300">
          {campaign.error}
        </p>
      )}
    </Sheet>
  );
};

export default UnlockModal;
