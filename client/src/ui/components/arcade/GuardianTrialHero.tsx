import type { ReactNode } from "react";
import { motion } from "motion/react";

import { getZoneGuardian } from "@/config/bossCharacters";
import {
  dailyScoringRuleName,
  type DailyScoringRuleView,
} from "@/chain/dailyRules";
import { GuardianMedallion } from "@/ui/components/economy";
import { useThemeColors } from "@/ui/elements/theme-provider/hooks";

interface GuardianTrialHeroProps {
  /** Zone whose guardian presides over the trial (1..10). */
  zoneId: number;
  /** Short eyebrow above the guardian name, e.g. "Today's trial". */
  eyebrow: string;
  /** Today's scoring rule; renders a compact pill when present. */
  scoringRule: DailyScoringRuleView | null;
  /** Status / countdown line rendered under the identity block. */
  meta: ReactNode;
  /** Glow the medallion when a run is live and resumable. */
  glow?: boolean;
}

/**
 * The Trial hero: the zone guardian medallion over a compact identity block
 * (eyebrow, guardian name in the display face, guardian title), the day's rule
 * as a single pill, and a status/countdown line. The accent comes from the
 * active zone theme via `useThemeColors`, so the card matches the surface.
 */
const GuardianTrialHero: React.FC<GuardianTrialHeroProps> = ({
  zoneId,
  eyebrow,
  scoringRule,
  meta,
  glow = false,
}) => {
  const colors = useThemeColors();
  const guardian = getZoneGuardian(zoneId);

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center gap-3 rounded-3xl border bg-black/40 p-5 text-center backdrop-blur-xl"
      style={{
        borderColor: `${colors.accent}44`,
        boxShadow: glow
          ? `0 0 30px ${colors.accent}3a, inset 0 1px 0 rgba(255,255,255,0.05)`
          : `inset 0 1px 0 rgba(255,255,255,0.05)`,
      }}
    >
      <GuardianMedallion zoneId={zoneId} size={92} glow={glow} />

      <div className="flex flex-col items-center gap-0.5">
        <span className="font-sans text-[11px] font-bold uppercase tracking-[0.16em] text-white/45">
          {eyebrow}
        </span>
        <h2 className="font-display text-2xl font-black leading-tight text-white">
          {guardian.name}
        </h2>
        <span className="font-sans text-xs font-semibold text-white/55">
          {guardian.title}
        </span>
      </div>

      {scoringRule && (
        <span
          className="rounded-full border px-3 py-1 font-sans text-[11px] font-bold uppercase tracking-[0.1em]"
          style={{
            borderColor: `${colors.accent}55`,
            background: `${colors.accent}18`,
            color: colors.accent,
          }}
        >
          {dailyScoringRuleName(scoringRule)}
        </span>
      )}

      <div className="pt-0.5">{meta}</div>
    </motion.section>
  );
};

export default GuardianTrialHero;
