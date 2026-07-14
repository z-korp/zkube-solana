import React, { useState } from "react";
import { motion } from "motion/react";

import { getThemeColors } from "@/config/themes";
import { useClaimableCounts } from "@/hooks/useClaimableCount";
import DailyTab from "@/ui/components/rewards/DailyTab";
import QuestsRewardsTab from "@/ui/components/rewards/QuestsRewardsTab";
import WeeklyTab from "@/ui/components/rewards/WeeklyTab";
import PageHeader from "@/ui/components/shared/PageHeader";
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
        <div className="mx-6 mt-2 flex rounded-full border border-white/[0.16] bg-white/[0.1] p-1 shadow-[inset_0_2px_8px_rgba(0,0,0,0.45)] backdrop-blur-xl">
          {TABS.map((tab) => {
            const badgeCount =
              tab === "Quests"
                ? claimableCounts.daily + claimableCounts.weekly
                : 0;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`relative z-10 flex-1 rounded-full px-3 py-1.5 font-sans text-[12px] font-bold uppercase tracking-wide transition-colors duration-200 ${
                  activeTab === tab
                    ? "text-white"
                    : "text-white/40 hover:text-white/60"
                }`}
              >
                {activeTab === tab && (
                  <motion.div
                    layoutId="rewards-tab-indicator"
                    className="absolute inset-0 rounded-full border border-white/[0.08] bg-white/20 shadow-[inset_0_1px_1px_rgba(255,255,255,0.2)]"
                    transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                  />
                )}
                <span className="relative z-20 drop-shadow-sm">{tab}</span>
                {badgeCount > 0 && (
                  <span className="absolute -right-0.5 -top-1 z-30 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 font-sans text-[10px] font-bold leading-none text-white shadow-md">
                    {badgeCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
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
