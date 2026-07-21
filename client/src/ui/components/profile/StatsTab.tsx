import React from "react";
import { motion } from "motion/react";

import StatTile from "@/ui/components/shared/StatTile";
import { useThemeColors } from "@/ui/elements/theme-provider/hooks";
import { staggerContainer, staggerItem } from "@/ui/motion";

const containerVariants = staggerContainer(0.05);

interface StatsTabProps {
  totalGames: number;
  totalLines: number;
  maxCombo: number;
  totalBosses: number;
  dailiesPlayed: number;
  perfectLevels: number;
  cubesEarned: number;
  cubesSpent: number;
}

const StatsTab: React.FC<StatsTabProps> = ({
  totalGames,
  totalLines,
  maxCombo,
  totalBosses,
  dailiesPlayed,
  perfectLevels,
  cubesEarned,
  cubesSpent,
}) => {
  const colors = useThemeColors();
  const stats: Array<{ label: string; value: string; color?: string }> = [
    { label: "Games", value: totalGames.toLocaleString() },
    { label: "Best Combo", value: maxCombo > 0 ? `×${maxCombo}` : "--" },
    {
      label: "Lines",
      value: totalLines > 0 ? totalLines.toLocaleString() : "--",
    },
    {
      label: "Guardians",
      value: totalBosses > 0 ? totalBosses.toLocaleString() : "--",
    },
    {
      label: "Dailies played",
      value: dailiesPlayed > 0 ? dailiesPlayed.toLocaleString() : "--",
    },
    {
      label: "Perfect levels",
      value: perfectLevels > 0 ? perfectLevels.toLocaleString() : "--",
    },
    {
      label: "Lifetime Cubes earned",
      value: cubesEarned.toLocaleString(),
      color: "#fde68a",
    },
    { label: "Lifetime Cubes spent", value: cubesSpent.toLocaleString() },
  ];

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="show"
      className="flex flex-col gap-4 pb-2"
    >
      <section>
        <motion.p
          variants={staggerItem}
          className="mb-2 font-sans text-[11px] font-bold uppercase tracking-[0.15em]"
          style={{ color: colors.textMuted }}
        >
          Lifetime record
        </motion.p>
        <div className="grid grid-cols-2 gap-2.5">
          {stats.map((stat) => (
            <motion.div variants={staggerItem} key={stat.label}>
              <StatTile
                label={stat.label}
                value={stat.value}
                color={stat.color ?? colors.text}
                labelColor={colors.textMuted}
                className="bg-white/[0.1]"
              />
            </motion.div>
          ))}
        </div>
      </section>
    </motion.div>
  );
};

export default StatsTab;
