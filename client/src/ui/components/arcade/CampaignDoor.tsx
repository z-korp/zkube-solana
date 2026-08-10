import { LockKeyhole } from "lucide-react";
import { motion } from "motion/react";

import { dailyScoringRuleName } from "@/chain/dailyRules";
import type { DailyScoringRuleView } from "@/chain/dailyRules";
import { getZoneGuardian } from "@/config/bossCharacters";
import { GuardianFaceBlock } from "@/ui/components/economy";
import type { MasteryBadge } from "@/ui/components/economy/GuardianFaceBlock";

export interface CampaignShelfItem {
  zoneId: number;
  /** Campaign mastery, worn as a corner star. */
  badge: MasteryBadge | null;
}

export interface CampaignTomorrow {
  /** Tomorrow's realm, derived from the published pool. */
  mapId: number;
  /** Tomorrow's objective. */
  scoringRule: DailyScoringRuleView;
}

interface CampaignDoorProps {
  /** The realm being conquered and up to two behind it, wearing earned stars. */
  shelf: readonly CampaignShelfItem[];
  /** Lifetime stars; hidden while locked (stars live on the wallet). */
  totalStars?: number;
  /** Tomorrow's daily, when the pool has already published it. */
  tomorrow?: CampaignTomorrow | null;
  /** Landing state: dimmed, a lock where the stars go, not pressable. */
  locked?: boolean;
  onClick?: () => void;
}

/**
 * The violet door under the marquee — the free adventure, wearing the realm
 * shelf. Identical furniture on the landing (locked) and on Home (live), so
 * connection unlocks it in place instead of introducing it.
 *
 * Tomorrow's daily rides inside the same door rather than beside it. The draw
 * is derived from a protocol-fixed seed, so the next realm is knowable a day
 * ahead — and the only actionable thing to do with that is practise the realm
 * here, for free. Two separate plates asked the player to make that connection
 * themselves; one plate states it.
 */
const CampaignDoor: React.FC<CampaignDoorProps> = ({
  shelf,
  totalStars,
  tomorrow = null,
  locked = false,
  onClick,
}) => (
  <motion.button
    type="button"
    disabled={locked}
    onClick={onClick}
    whileTap={locked ? undefined : { y: 4, boxShadow: "0 1px 0 #3C1A80" }}
    className={`mx-auto mt-3 flex w-full max-w-[400px] flex-col gap-2 rounded-2xl px-4 py-2.5 text-white ${
      locked ? "opacity-45 saturate-[0.45]" : ""
    }`}
    style={{
      background:
        "linear-gradient(160deg, #C9A4FF 0%, #9A5CF0 55%, #5B2BB8 100%)",
      boxShadow:
        "0 5px 0 #3C1A80, 0 12px 26px -10px rgba(154,92,240,0.5), inset 0 2px 0 rgba(255,255,255,0.5)",
    }}
  >
    <span className="flex w-full items-center gap-3">
      {/* Spaced, not stacked: the mastery star sits on the block's corner and
          an overlap would hide it behind the next realm. */}
      <span className="flex gap-1">
        {shelf.map((realm) => (
          <GuardianFaceBlock
            key={realm.zoneId}
            zoneId={realm.zoneId}
            size={36}
            badge={realm.badge}
          />
        ))}
      </span>
      <span className="flex-1 text-left font-sans text-[16px] font-extrabold uppercase tracking-[0.1em]">
        Campaign
      </span>
      <span className="flex items-center rounded-full bg-black/25 px-2.5 py-1 font-mono text-xs font-bold tabular-nums text-white/90">
        {locked ? <LockKeyhole size={13} /> : <>★ {totalStars ?? 0}/300</>}
      </span>
    </span>

    {tomorrow && !locked && (
      <span
        className="flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5"
        style={{
          background: "rgba(24,10,54,0.45)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.10)",
        }}
      >
        <GuardianFaceBlock zoneId={tomorrow.mapId} size={30} />
        <span className="font-sans text-[9px] font-bold uppercase tracking-[0.18em] text-white/55">
          Tomorrow
        </span>
        <span className="min-w-0 flex-1 truncate text-left font-sans text-[13px] font-extrabold text-white">
          {getZoneGuardian(tomorrow.mapId).name}
          <span className="font-mono text-[10px] font-semibold text-white/60">
            {" · "}
            {dailyScoringRuleName(tomorrow.scoringRule)}
          </span>
        </span>
      </span>
    )}
  </motion.button>
);

export default CampaignDoor;
