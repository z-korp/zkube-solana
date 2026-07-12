import React from "react";
import type { ThemeColors } from "@/config/themes";
import QuestsTab from "@/ui/components/profile/QuestsTab";

interface QuestsRewardsTabProps {
  colors: ThemeColors;
}

const QuestsRewardsTab: React.FC<QuestsRewardsTabProps> = ({ colors }) => (
  <div className="flex flex-col gap-4">
    <QuestsTab colors={colors} />
  </div>
);

export default QuestsRewardsTab;
