import React, { useMemo, useState } from "react";
import { motion } from "motion/react";

import { useClaimableCounts } from "@/hooks/useClaimableCount";
import { useProgress } from "@/contexts/progress";
import { getLevelFromXp } from "@/config/profileData";
import { usePlayerMeta } from "@/hooks/usePlayerMeta";
import { useConnectedPlayer } from "@/chain/connectedPlayerContext";
import AchievementsTab from "@/ui/components/rewards/AchievementsTab";
import MilestonesTab from "@/ui/components/rewards/MilestonesTab";
import QuestsTab from "@/ui/components/rewards/QuestsTab";
import PageHeader from "@/ui/components/shared/PageHeader";
import SegmentedTabs from "@/ui/components/shared/SegmentedTabs";

const TABS = ["Quests", "Feats", "Ranks"] as const;

/**
 * Everything claimable, in one place: rotating quests, achievements (feats),
 * and the level-milestone ladder. Competition status lives in the Arena.
 */
const RewardsPage: React.FC = () => {
  const claimableCounts = useClaimableCounts();
  const progress = useProgress();
  const player = useConnectedPlayer();
  const { playerMeta } = usePlayerMeta(player.publicKey?.toBase58() ?? "");
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]>("Quests");

  const claimableMilestones = useMemo(() => {
    const claimed = progress.progress?.levelMilestones?.claimed ?? 0;
    const level = getLevelFromXp(playerMeta?.lifetimeXp ?? 0);
    let count = 0;
    for (let index = 0; index < 10; index++) {
      if (level >= (index + 1) * 10 && !(claimed & (1 << index))) count++;
    }
    return count;
  }, [playerMeta?.lifetimeXp, progress.progress?.levelMilestones?.claimed]);

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden pb-[100px] pt-12">
      <div className="shrink-0 pb-2">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 24 }}
        >
          <PageHeader title="Quests" />
        </motion.div>
        <SegmentedTabs
          tabs={TABS}
          active={activeTab}
          onChange={setActiveTab}
          layoutId="rewards-tab-indicator"
          badges={{
            Quests: claimableCounts.daily + claimableCounts.weekly,
            Feats: claimableCounts.achievements,
            Ranks: claimableMilestones,
          }}
          className="mx-6 mt-2"
        />
      </div>

      <div className="mx-4 mb-4 mt-2 min-h-0 flex-1 overflow-y-auto hide-scrollbar">
        <div className="mx-auto max-w-[640px]">
          {activeTab === "Quests" && <QuestsTab />}
          {activeTab === "Feats" && <AchievementsTab />}
          {activeTab === "Ranks" && <MilestonesTab />}
        </div>
      </div>
    </div>
  );
};

export default RewardsPage;
