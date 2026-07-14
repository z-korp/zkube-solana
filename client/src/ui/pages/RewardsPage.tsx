import React, { useState } from "react";
import { motion } from "motion/react";

import { getThemeColors } from "@/config/themes";
import { useClaimableCounts } from "@/hooks/useClaimableCount";
import DailyTab from "@/ui/components/rewards/DailyTab";
import QuestsRewardsTab from "@/ui/components/rewards/QuestsRewardsTab";
import WeeklyTab from "@/ui/components/rewards/WeeklyTab";
import PageHeader from "@/ui/components/shared/PageHeader";
import SegmentedTabs from "@/ui/components/shared/SegmentedTabs";
import { useTheme } from "@/ui/elements/theme-provider/hooks";

const TABS = ["Quests", "Daily", "Weekly"] as const;

const RewardsPage: React.FC = () => {
  const { themeTemplate } = useTheme();
  const colors = getThemeColors(themeTemplate);
  const claimableCounts = useClaimableCounts();
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]>("Quests");

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden pb-[100px] pt-12">
      <div className="shrink-0 pb-2">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 24 }}
        >
          <PageHeader title="Rewards" />
        </motion.div>
        <SegmentedTabs
          tabs={TABS}
          active={activeTab}
          onChange={setActiveTab}
          layoutId="rewards-tab-indicator"
          badges={{
            Quests: claimableCounts.daily + claimableCounts.weekly,
          }}
          className="mx-6 mt-2"
        />
      </div>

      <div className="mx-4 mb-4 mt-2 min-h-0 flex-1 overflow-y-auto hide-scrollbar">
        {activeTab === "Daily" && <DailyTab colors={colors} />}
        {activeTab === "Weekly" && <WeeklyTab colors={colors} />}
        {activeTab === "Quests" && <QuestsRewardsTab colors={colors} />}
      </div>
    </div>
  );
};

export default RewardsPage;
