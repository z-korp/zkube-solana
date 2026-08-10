import { ChevronRight, LockKeyhole } from "lucide-react";
import { motion } from "motion/react";

import { GuardianFaceBlock } from "@/ui/components/economy";

interface CampaignDoorProps {
  /** The realm currently being conquered; its guardian fronts the door. */
  zoneId?: number;
  /** Lifetime stars; hidden while locked (stars live on the wallet). */
  totalStars?: number;
  /** Landing state: dimmed, a lock where the stars go, not pressable. */
  locked?: boolean;
  onClick?: () => void;
}

/**
 * The violet strip under the marquee — the free mode, named for what it is.
 *
 * It used to carry a shelf of three realms and, inside it, tomorrow's daily.
 * That was two unrelated ideas in one plate with neither explained: nothing
 * said what the faces meant, and nothing said why tomorrow's realm was filed
 * under Campaign. The nav already handles getting here, so the strip only has
 * to say what this mode is and how far you are — and tomorrow's realm moved to
 * the Campaign page, where practising it is a tap rather than a riddle.
 */
const CampaignDoor: React.FC<CampaignDoorProps> = ({
  zoneId = 1,
  totalStars,
  locked = false,
  onClick,
}) => (
  <motion.button
    type="button"
    disabled={locked}
    onClick={onClick}
    whileTap={locked ? undefined : { y: 3, boxShadow: "0 1px 0 #3C1A80" }}
    className={`mx-auto mt-3 flex w-full max-w-[400px] items-center gap-2.5 rounded-2xl px-3 py-2 text-white ${
      locked ? "opacity-45 saturate-[0.45]" : ""
    }`}
    style={{
      background:
        "linear-gradient(160deg, #C9A4FF 0%, #9A5CF0 55%, #5B2BB8 100%)",
      boxShadow:
        "0 4px 0 #3C1A80, 0 12px 26px -10px rgba(154,92,240,0.5), inset 0 2px 0 rgba(255,255,255,0.5)",
    }}
  >
    <GuardianFaceBlock zoneId={zoneId} size={32} />
    <span className="min-w-0 flex-1 text-left">
      <span className="block font-sans text-[15px] font-extrabold uppercase leading-tight tracking-[0.1em]">
        Campaign
      </span>
      <span className="block font-sans text-[11px] font-semibold text-white/70">
        Free practice
      </span>
    </span>
    <span className="flex items-center rounded-full bg-black/25 px-2.5 py-1 font-mono text-xs font-bold tabular-nums text-white/90">
      {locked ? <LockKeyhole size={13} /> : <>★ {totalStars ?? 0}/300</>}
    </span>
    <ChevronRight size={16} className="flex-none text-white/50" />
  </motion.button>
);

export default CampaignDoor;
