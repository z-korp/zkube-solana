/* eslint-disable react-refresh/only-export-components */
import { X } from "lucide-react";

import type { ZoneProgressData } from "@/config/profileData";
import type { ThemeColors } from "@/config/themes";
import { useCampaign } from "@/contexts/campaign";
import ArcadeButton from "@/ui/components/shared/ArcadeButton";
import ProgressBar from "@/ui/components/shared/ProgressBar";

interface UnlockModalProps {
  colors: ThemeColors;
  zone: ZoneProgressData;
  onClose: () => void;
}

export function formatUsdcBaseUnits(value: bigint): string {
  const whole = value / 1_000_000n;
  const fraction = (value % 1_000_000n)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

const UnlockModal: React.FC<UnlockModalProps> = ({ colors, zone, onClose }) => {
  const campaign = useCampaign();
  const starCost = zone.starCost ?? 0;
  const currentStars = Number(
    campaign.campaign?.starsBalance ?? BigInt(zone.currentStars ?? 0),
  );
  const canUnlockWithStars = currentStars >= starCost;
  const canSubmit = campaign.campaign !== null && !campaign.unlocking;
  const starsRemaining = Math.max(starCost - currentStars, 0);

  const handleUnlock = async () => {
    try {
      await campaign.unlock(zone.zoneId);
      onClose();
    } catch {
      // The shared campaign controller exposes the actionable error below.
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-3 pb-[110px] pt-3 md:p-6">
      <button
        type="button"
        aria-label="Close unlock modal"
        onClick={onClose}
        className="absolute inset-0 bg-black/65 backdrop-blur-md"
      />

      <div
        className="relative max-h-full w-full max-w-[980px] overflow-y-auto rounded-3xl border border-white/[0.2] bg-slate-950/92 px-4 pb-4 pt-4 shadow-[0_30px_80px_rgba(0,0,0,0.6)] backdrop-blur-2xl md:px-6 md:pb-6"
        style={{
          background: `linear-gradient(180deg, ${colors.backgroundGradientStart}F2, ${colors.background}F0)`,
        }}
      >
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 bg-black/25 text-white/80"
        >
          <X size={16} />
        </button>

        <div className="mb-3 flex justify-center md:hidden">
          <div className="h-1 w-10 rounded bg-white/20" />
        </div>

        <div className="mb-4 flex items-center gap-3">
          <span className="text-[32px] md:text-[38px]">{zone.emoji}</span>
          <div className="min-w-0 flex-1">
            <p
              className="font-sans text-[11px] font-bold uppercase tracking-[0.14em]"
              style={{ color: colors.accent }}
            >
              Unlock Zone
            </p>
            <p className="truncate font-display text-2xl font-black text-white md:text-3xl">
              {zone.name}
            </p>
          </div>
        </div>

        <div
          className="grid grid-cols-1 gap-3 md:gap-4"
        >
          <section
            className="flex flex-col rounded-2xl border border-white/[0.14] bg-white/[0.06] p-4 backdrop-blur-xl"
            style={{ boxShadow: `inset 0 0 12px ${colors.accent2}1F` }}
          >
            <p
              className="mb-2 font-sans text-xs font-bold uppercase tracking-[0.12em]"
              style={{ color: colors.accent2 }}
            >
              Earn It
            </p>
            <p
              className="font-sans text-3xl font-black leading-none"
              style={{ color: colors.accent2 }}
            >
              {starCost}★
            </p>
            <p className="mb-3 mt-1 font-sans text-sm font-semibold text-white/70">
              Stars required
            </p>

            <ProgressBar
              value={currentStars}
              max={starCost}
              color={colors.accent2}
              height={8}
              glow
            />
            <p
              className="mt-2 font-sans text-sm font-bold"
              style={{ color: colors.accent2 }}
            >
              {currentStars}/{starCost}★
            </p>
            <p className="mt-0.5 font-sans text-sm text-white/70">
              {starsRemaining} stars to go
            </p>

            <div className="mt-auto pt-3">
              {canUnlockWithStars ? (
                <ArcadeButton
                  disabled={!canSubmit}
                  onClick={() => void handleUnlock()}
                >
                  Unlock with Stars
                </ArcadeButton>
              ) : (
                <p className="font-sans text-sm font-semibold text-white/65">
                  Earn Stars in Campaign and Weekly play, or buy a pack below.
                </p>
              )}
            </div>
          </section>

        </div>

        {campaign.campaign && (
          <section className="mt-3 rounded-2xl border border-white/[0.14] bg-white/[0.06] p-4">
            <p className="font-sans text-xs font-bold uppercase tracking-[0.12em] text-white/70">
              Star packs
            </p>
            <p className="mt-1 font-sans text-sm text-white/55">
              Stars stay bound to this Vault and cannot be transferred or redeemed.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-5">
              {campaign.campaign.starPacks.map((pack, index) => (
                <button
                  key={pack.stars.toString()}
                  type="button"
                  disabled={!canSubmit}
                  onClick={() => void campaign.buyStars(index)}
                  className="rounded-xl border border-white/15 bg-black/20 px-2 py-3 text-center transition hover:bg-white/10 disabled:opacity-50"
                >
                  <span className="block font-display text-lg font-black text-yellow-300">
                    {pack.stars.toString()}★
                  </span>
                  <span className="mt-1 block font-sans text-xs font-bold text-white/65">
                    {pack.enabled
                      ? `${formatUsdcBaseUnits(pack.price)} USDC`
                      : "Unavailable"}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {campaign.error && (
          <p className="mt-3 text-center font-sans text-sm text-red-300">
            {campaign.error}
          </p>
        )}
      </div>
    </div>
  );
};

export default UnlockModal;
