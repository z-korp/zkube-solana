import React, { useMemo } from "react";
import { Loader2 } from "lucide-react";
import { motion } from "motion/react";

import type { ThemeColors } from "@/config/themes";
import { groupQuests, useQuests, type QuestStatus } from "@/hooks/useQuests";
import EmptyState from "@/ui/components/shared/EmptyState";
import ProgressBar from "@/ui/components/shared/ProgressBar";
import { useThemeColors } from "@/ui/elements/theme-provider/hooks";
import { staggerContainer, staggerItem } from "@/ui/motion";
import {
  formatDurationCoarse,
  nextDailyResetUnix,
  nextWeeklyResetUnix,
} from "@/utils/time";

const containerVariants = staggerContainer(0.05);

const QuestsTab: React.FC = () => {
  const colors = useThemeColors();
  const { quests, isLoading, error } = useQuests();
  const { daily, weekly, finisher } = groupQuests(quests);

  const keepVisible = (quest: QuestStatus) => quest.active;

  const activeDaily = daily.filter(keepVisible);
  const activeWeekly = weekly.filter(keepVisible);
  const activeFinisher = finisher.filter(keepVisible);
  const combinedDaily = useMemo(
    () => [...activeDaily, ...activeFinisher],
    [activeDaily, activeFinisher],
  );

  const getQuestColor = (quest: QuestStatus): string => {
    if (quest.type === "weekly") return "#B89BFF";
    if (quest.type === "finisher") return "#FF7CA8";
    return colors.accent;
  };

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="show"
      className="flex flex-col gap-4 pb-2"
    >
      <QuestSection
        colors={colors}
        title="Daily Quests"
        subtitle="Three new objectives every day"
        resetHint={`New quests in ${formatDurationCoarse(
          nextDailyResetUnix() - Math.floor(Date.now() / 1_000),
        )}`}
        quests={combinedDaily}
        getQuestColor={getQuestColor}
        showFinisherDivider={activeFinisher.length > 0}
      />
      <QuestSection
        colors={colors}
        title="Weekly Quests"
        subtitle="Long-run objectives awarding XP"
        resetHint={`New quests in ${formatDurationCoarse(
          nextWeeklyResetUnix() - Math.floor(Date.now() / 1_000),
        )}`}
        quests={activeWeekly}
        getQuestColor={getQuestColor}
      />
      {isLoading && (
        <motion.p
          variants={staggerItem}
          className="flex items-center justify-center gap-2 font-sans text-xs text-white/50"
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading on-chain
          quests…
        </motion.p>
      )}
      {error && (
        <motion.p
          variants={staggerItem}
          role="alert"
          className="text-center font-sans text-xs text-red-300"
        >
          {error}
        </motion.p>
      )}
    </motion.div>
  );
};

interface QuestSectionProps {
  colors: ThemeColors;
  title: string;
  subtitle: string;
  quests: QuestStatus[];
  getQuestColor: (quest: QuestStatus) => string;
  resetHint: string;
  showFinisherDivider?: boolean;
}

const QuestSection: React.FC<QuestSectionProps> = ({
  colors,
  title,
  subtitle,
  quests,
  getQuestColor,
  resetHint,
  showFinisherDivider = false,
}) => {
  const sortedQuests = [...quests].sort((left, right) => {
    const leftRank = left.completed ? 1 : 0;
    const rightRank = right.completed ? 1 : 0;
    return leftRank - rightRank;
  });

  return (
    <motion.section
      variants={staggerItem}
      className="rounded-2xl border p-3 backdrop-blur-xl"
      style={{
        background: "rgba(255,255,255,0.08)",
        borderColor: "rgba(255,255,255,0.15)",
      }}
    >
      <div className="mb-3">
        <p
          className="font-sans text-[12px] font-extrabold uppercase tracking-[0.12em]"
          style={{ color: colors.text }}
        >
          {title}
        </p>
        <p
          className="mt-0.5 font-sans text-[11px] font-semibold"
          style={{ color: colors.textMuted }}
        >
          {subtitle}
        </p>
      </div>

      {sortedQuests.length === 0 ? (
        <div className="rounded-xl border border-white/[0.14] bg-white/[0.08]">
          <EmptyState
            compact
            title="No active quests right now"
            hint={resetHint}
            titleColor="rgba(255,255,255,0.7)"
          />
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {sortedQuests.map((quest, index) => (
            <div key={quest.index}>
              {showFinisherDivider &&
                quest.type === "finisher" &&
                index > 0 &&
                sortedQuests[index - 1]?.type !== "finisher" && (
                  <div className="flex items-center gap-2 py-1">
                    <div className="h-px flex-1 bg-white/10" />
                    <span className="font-sans text-[10px] font-bold uppercase tracking-wide text-[#FF7CA8]">
                      Daily Finisher
                    </span>
                    <div className="h-px flex-1 bg-white/10" />
                  </div>
                )}
              <QuestCard
                colors={colors}
                quest={quest}
                color={getQuestColor(quest)}
              />
            </div>
          ))}
        </div>
      )}
    </motion.section>
  );
};

interface QuestCardProps {
  colors: ThemeColors;
  quest: QuestStatus;
  color: string;
}

const QuestCard: React.FC<QuestCardProps> = ({
  colors,
  quest,
  color,
}) => {
  const progressValue = Math.min(quest.progress, quest.target);

  return (
    <div
      className="rounded-2xl border px-3 py-3 backdrop-blur-xl"
      style={{
        background: quest.completed
            ? `${color}18`
            : "rgba(255,255,255,0.11)",
        borderColor: quest.completed ? `${color}4D` : "rgba(255,255,255,0.16)",
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-xl border"
          style={{ background: `${color}22`, borderColor: `${color}55` }}
        >
          <span
            className="text-lg"
          >
            {quest.icon}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p
              className="font-sans text-[14px] font-extrabold leading-tight"
              style={{ color: quest.completed ? color : colors.text }}
            >
              {quest.name}
            </p>

            {quest.completed ? (
              <span
                className="rounded-full px-2 py-1 font-sans text-[10px] font-extrabold uppercase"
                style={{
                  color: colors.textMuted,
                  background: "rgba(255,255,255,0.12)",
                }}
              >
                Complete · XP applied
              </span>
            ) : (
              <span
                className="font-sans text-[12px] font-extrabold"
                style={{ color }}
              >
                +{questRewardLabel(quest)}
              </span>
            )}
          </div>

          <p
            className="mt-0.5 font-sans text-[12px] font-semibold"
            style={{ color: colors.textMuted }}
          >
            {quest.description}
          </p>

          {!quest.completed && (
            <div className="mt-2">
              <ProgressBar
                value={progressValue}
                max={quest.target}
                color={color}
                height={6}
                glow={quest.completed}
              />
              <div
                className="mt-1 flex items-center justify-between font-sans text-[11px] font-semibold"
                style={{ color: colors.textMuted }}
              >
                <span>
                  {progressValue}/{quest.target}
                </span>
                <span>
                  In progress
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

function questRewardLabel(quest: QuestStatus): string {
  return quest.xpReward > 0 ? `${quest.xpReward} XP` : "Complete";
}

export default QuestsTab;
