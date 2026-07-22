import type { ReactNode } from "react";
import { motion } from "motion/react";

import {
  dailyScoringRuleDescription,
  dailyScoringRuleName,
  type DailyScoringRuleView,
} from "@/chain/dailyRules";
import { getGuardianPortrait, getZoneGuardian } from "@/config/bossCharacters";
import { ZONE_NAMES } from "@/config/profileData";
import { getThemeColors, getThemeId, getThemeImages } from "@/config/themes";
import { cn } from "@/ui/utils";

interface DailyChallengeCardProps {
  /** Zone whose guardian presides over today's trial (1..10). */
  zoneId: number;
  /** Today's scoring rule; drives the rule name and one-line description. */
  scoringRule: DailyScoringRuleView | null;
  /** Countdown / status line rendered at the foot of the card. */
  status?: ReactNode;
  className?: string;
}

/**
 * The Arcade home's top card: the zone guardian and today's rule presented as
 * glass OVER the painted zone art. The zone image sits inside the card under a
 * light inner veil, so the guardian portrait and rule read against the painting
 * (the reference "rules capsule" look) rather than a flat black panel.
 */
const DailyChallengeCard: React.FC<DailyChallengeCardProps> = ({
  zoneId,
  scoringRule,
  status,
  className,
}) => {
  const themeId = getThemeId(zoneId);
  const images = getThemeImages(themeId);
  const colors = getThemeColors(themeId);
  const guardian = getZoneGuardian(zoneId);
  const zoneName = ZONE_NAMES[zoneId] ?? `Zone ${zoneId}`;

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "relative overflow-hidden rounded-3xl border",
        className,
      )}
      style={{
        borderColor: `${colors.accent}44`,
        boxShadow: `0 4px 32px rgba(0,0,0,0.3), inset 0 1px 0 ${colors.accent}15`,
      }}
    >
      {/* Painted zone art embedded in the card, revealed through a light veil. */}
      <img
        src={images.background}
        alt=""
        draggable={false}
        className="absolute inset-0 h-full w-full object-cover"
        style={{ opacity: 0.7 }}
      />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(2,6,18,0.42)_0%,rgba(2,6,18,0.58)_55%,rgba(2,5,13,0.74)_100%)]" />

      <div className="relative z-10 flex flex-col gap-3 p-5">
        <div className="flex items-center gap-3">
          <img
            src={getGuardianPortrait(zoneId)}
            alt={guardian.name}
            draggable={false}
            className="h-14 w-14 shrink-0 rounded-2xl object-cover"
            style={{
              border: `2px solid ${colors.accent}55`,
              boxShadow: `0 0 18px ${colors.accent}33`,
            }}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-xl font-black leading-tight text-white">
                {guardian.name}
              </h2>
              <span
                className="rounded-full px-2 py-0.5 font-sans text-[9px] font-bold uppercase tracking-wide"
                style={{
                  color: colors.accent,
                  background: `${colors.accent}1f`,
                }}
              >
                {zoneName}
              </span>
            </div>
            <p className="mt-0.5 truncate font-sans text-xs font-semibold text-white/60">
              {guardian.title}
            </p>
          </div>
        </div>

        {scoringRule && (
          <div
            className="rounded-2xl border px-3 py-2.5"
            style={{
              borderColor: `${colors.accent}33`,
              background: "rgba(0,0,0,0.28)",
            }}
          >
            <p
              className="font-display text-sm font-black"
              style={{ color: colors.accent }}
            >
              {dailyScoringRuleName(scoringRule)}
            </p>
            <p className="mt-0.5 font-sans text-xs leading-relaxed text-white/70">
              {dailyScoringRuleDescription(scoringRule)}
            </p>
          </div>
        )}

        {status && <div className="pt-0.5">{status}</div>}
      </div>
    </motion.section>
  );
};

export default DailyChallengeCard;
