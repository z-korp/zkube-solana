import React from "react";
import { motion } from "motion/react";

import type { ThemeColors } from "@/config/themes";
import StatTile from "@/ui/components/shared/StatTile";

const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.05 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: "spring" as const, stiffness: 300, damping: 24 },
  },
};

interface StatsTabProps {
  colors: ThemeColors;
  totalGames: number;
  totalLines: number;
  maxCombo: number;
  totalBosses: number;
  dailiesPlayed: number;
  perfectLevels: number;
  starsEarned: number;
  starsSpent: number;
}

const StatsTab: React.FC<StatsTabProps> = ({
  colors,
  totalGames,
  totalLines,
  maxCombo,
  totalBosses,
  dailiesPlayed,
  perfectLevels,
  starsEarned,
  starsSpent,
}) => {
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
      label: "Lifetime ★ earned",
      value: starsEarned.toLocaleString(),
      color: "#fde68a",
    },
    { label: "Lifetime ★ spent", value: starsSpent.toLocaleString() },
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
          variants={itemVariants}
          className="mb-2 font-sans text-[11px] font-bold uppercase tracking-[0.15em]"
          style={{ color: colors.textMuted }}
        >
          Lifetime record
        </motion.p>
        <div className="grid grid-cols-2 gap-2.5">
          {stats.map((stat) => (
            <motion.div variants={itemVariants} key={stat.label}>
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
