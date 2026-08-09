import { motion } from "motion/react";
import { ChevronRight } from "lucide-react";

import { dailyScoringRuleName } from "@/chain/dailyRules";
import type { DailyScoringRuleView } from "@/chain/dailyRules";
import { getZoneGuardian } from "@/config/bossCharacters";
import { GuardianFaceBlock } from "@/ui/components/economy";

const PLATE_STYLE: React.CSSProperties = {
  background: "linear-gradient(180deg, #101A2E 0%, #0A1120 100%)",
  border: "1px solid rgba(255,255,255,0.10)",
  boxShadow: "0 3px 0 #04070F, inset 0 1px 0 rgba(255,255,255,0.08)",
};

interface TomorrowStripProps {
  /** Tomorrow's realm, derived from the published pool. */
  mapId: number;
  /** Tomorrow's objective. */
  scoringRule: DailyScoringRuleView;
  /** Practising the realm is the point of knowing early. */
  onClick: () => void;
}

/**
 * Tomorrow's daily, tonight. The draw is derived from a protocol-fixed seed,
 * so the next day's realm and objective are knowable a day ahead — and knowing
 * is only worth something if it is actionable, which is why this leads into
 * Campaign, where that realm can be practised for free.
 */
const TomorrowStrip: React.FC<TomorrowStripProps> = ({
  mapId,
  scoringRule,
  onClick,
}) => {
  const guardian = getZoneGuardian(mapId);
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={{ y: 2, boxShadow: "0 1px 0 #04070F" }}
      className="mt-2.5 flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left"
      style={PLATE_STYLE}
    >
      <GuardianFaceBlock zoneId={mapId} size={38} />
      <span className="min-w-0 flex-1">
        <span className="block font-sans text-[9px] font-bold uppercase tracking-[0.2em] text-white/40">
          Tomorrow
        </span>
        <span className="block truncate font-sans text-[15px] font-extrabold text-white">
          {guardian.name}
          <span className="font-mono text-[11px] font-semibold text-white/50">
            {" · "}
            {dailyScoringRuleName(scoringRule)}
          </span>
        </span>
      </span>
      <ChevronRight size={16} className="flex-none text-white/35" />
    </motion.button>
  );
};

export default TomorrowStrip;
