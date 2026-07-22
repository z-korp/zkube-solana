import { useState } from "react";
import { motion } from "motion/react";

import { useDaily } from "@/contexts/daily";
import ArenaDailyTab from "@/ui/components/arena/ArenaDailyTab";
import WeeklyTab from "@/ui/components/arena/WeeklyTab";
import SeasonTab from "@/ui/components/arena/SeasonTab";
import PageHeader from "@/ui/components/shared/PageHeader";
import SegmentedTabs from "@/ui/components/shared/SegmentedTabs";
import ZoneBackdrop from "@/ui/components/shared/ZoneBackdrop";

const TABS = ["Daily", "Weekly", "Season"] as const;

/**
 * The Leaderboard hub: three boards — Daily, Weekly (three skill bounties),
 * and Season. View-only; entering a ranked run lives on the Arcade home. Daily
 * results feed Season points. The boards sit as translucent glass over the
 * active daily zone's painted art, matching the reworked Arcade home.
 */
const ArenaPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]>("Daily");
  // Reveal the same painted zone the Daily is running on, so the glass boards
  // read consistently with the Arcade home.
  const zoneId = useDaily().daily?.mapId ?? 1;

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden pb-[100px] pt-12">
      <ZoneBackdrop zoneId={zoneId} />

      <div className="relative z-10 shrink-0 pb-2">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 24 }}
        >
          <PageHeader title="Leaderboard" />
        </motion.div>
        <SegmentedTabs
          tabs={TABS}
          active={activeTab}
          onChange={setActiveTab}
          layoutId="arena-tab-indicator"
          className="mx-6 mt-2"
        />
      </div>

      <div className="relative z-10 mx-4 mb-4 mt-2 min-h-0 flex-1 overflow-y-auto hide-scrollbar">
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
