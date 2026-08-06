import { LockKeyhole } from "lucide-react";
import { motion } from "motion/react";

import { GuardianFaceBlock } from "@/ui/components/economy";

export interface CampaignShelfItem {
  zoneId: number;
  rim: "white" | "silver" | "gold";
}

interface CampaignDoorProps {
  /** The realm being conquered and up to two behind it, wearing earned rims. */
  shelf: readonly CampaignShelfItem[];
  /** Lifetime stars; hidden while locked (stars live on the wallet). */
  totalStars?: number;
  /** Landing state: dimmed, a lock where the stars go, not pressable. */
  locked?: boolean;
  onClick?: () => void;
}

/**
 * The violet door under the marquee — the free adventure, wearing the realm
 * shelf. Identical furniture on the landing (locked) and on Home (live), so
 * connection unlocks it in place instead of introducing it.
 */
const CampaignDoor: React.FC<CampaignDoorProps> = ({
  shelf,
  totalStars,
  locked = false,
  onClick,
}) => (
  <motion.button
    type="button"
    disabled={locked}
    onClick={onClick}
    whileTap={locked ? undefined : { y: 4, boxShadow: "0 1px 0 #3C1A80" }}
    className={`mx-auto mt-3 flex w-full max-w-[400px] items-center gap-3 rounded-2xl px-4 py-2.5 text-white ${
      locked ? "opacity-45 saturate-[0.45]" : ""
    }`}
    style={{
      background:
        "linear-gradient(160deg, #C9A4FF 0%, #9A5CF0 55%, #5B2BB8 100%)",
      boxShadow:
        "0 5px 0 #3C1A80, 0 12px 26px -10px rgba(154,92,240,0.5), inset 0 2px 0 rgba(255,255,255,0.5)",
    }}
  >
    <span className="flex -space-x-2.5">
      {shelf.map((realm) => (
        <GuardianFaceBlock
          key={realm.zoneId}
          zoneId={realm.zoneId}
          size={36}
          rim={realm.rim}
        />
      ))}
    </span>
    <span className="flex-1 text-left font-sans text-[16px] font-extrabold uppercase tracking-[0.1em]">
      Campaign
    </span>
    <span className="flex items-center rounded-full bg-black/25 px-2.5 py-1 font-mono text-xs font-bold tabular-nums text-white/90">
      {locked ? <LockKeyhole size={13} /> : <>★ {totalStars ?? 0}/300</>}
    </span>
  </motion.button>
);

export default CampaignDoor;
