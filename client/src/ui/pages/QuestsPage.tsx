import React, { useState } from "react";
import { motion } from "motion/react";

import AchievementsTab from "@/ui/components/quests/AchievementsTab";
import QuestsTab from "@/ui/components/quests/QuestsTab";
import PageHeader from "@/ui/components/shared/PageHeader";
import SegmentedTabs from "@/ui/components/shared/SegmentedTabs";

const TABS = ["Quests", "Feats"] as const;

/**
 * Automatic, non-monetary Arcade progression. Competition status lives in
 * Ranks and no quest or feat requires a claim transaction.
 */
const QuestsPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]>("Quests");

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
          layoutId="quests-tab-indicator"
          className="mx-6 mt-2"
        />
      </div>

      <div className="mx-4 mb-4 mt-2 min-h-0 flex-1 overflow-y-auto hide-scrollbar">
        <div className="mx-auto max-w-[640px]">
          {activeTab === "Quests" && <QuestsTab />}
          {activeTab === "Feats" && <AchievementsTab />}
        </div>
      </div>
    </div>
  );
};

export default QuestsPage;
