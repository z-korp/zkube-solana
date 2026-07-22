import { useState } from "react";
import { motion } from "motion/react";

import ArenaDailyTab from "@/ui/components/arena/ArenaDailyTab";
import WeeklyTab from "@/ui/components/arena/WeeklyTab";
import SeasonTab from "@/ui/components/arena/SeasonTab";
import PageHeader from "@/ui/components/shared/PageHeader";
import SegmentedTabs from "@/ui/components/shared/SegmentedTabs";

const TABS = ["Daily", "Weekly", "Season"] as const;

/**
 * The competition hub: three boards — Daily, Weekly (three skill bounties),
 * and Season. View-only; entering a ranked run lives on the Arcade home. Daily
 * results feed Season points.
 */
const ArenaPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]>("Daily");

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden pb-[100px] pt-12">
      <div className="shrink-0 pb-2">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 24 }}
        >
          <PageHeader title="Ranks" />
        </motion.div>
        <SegmentedTabs
          tabs={TABS}
          active={activeTab}
          onChange={setActiveTab}
          layoutId="arena-tab-indicator"
          className="mx-6 mt-2"
        />
      </div>

      <div className="mx-4 mb-4 mt-2 min-h-0 flex-1 overflow-y-auto hide-scrollbar">
        {activeTab === "Daily" && <ArenaDailyTab />}
        {activeTab === "Weekly" && (
          <div className="mx-auto max-w-[640px]">
            <WeeklyTab />
          </div>
        )}
        {activeTab === "Season" && <SeasonTab />}
      </div>
    </div>
  );
};

export default ArenaPage;
