import { useMemo } from "react";

import { useProgress } from "@/contexts/progress";
import {
  getQuestIntervalId,
  QUEST_DEFS,
  type QuestDef,
  type QuestType,
} from "@/config/questDefs";
import type { QuestProgressView } from "@/chain/progressClient";
import { bigintToSafeNumber } from "@/utils/solanaDisplay";

export interface QuestStatus extends QuestDef {
  index: number;
  intervalId: number;
  progress: number;
  completed: boolean;
  claimed: boolean;
  claimable: boolean;
  active: boolean;
  rewardUnit: "Stars" | "XP";
}

export function projectQuests(
  entries: readonly QuestProgressView[] | null,
  now = Math.floor(Date.now() / 1_000),
): QuestStatus[] {
  return QUEST_DEFS.map((definition, index) => {
    const value = entries?.[index];
    return {
      ...definition,
      index,
      target: value?.threshold ?? definition.target,
      reward: value
        ? bigintToSafeNumber(value.rewardAmount)
        : definition.reward * (definition.type === "weekly" ? 1 : 100),
      rewardUnit: value?.rewardUnit ?? (definition.type === "weekly" ? "Stars" : "XP"),
      intervalId: getQuestIntervalId(definition, now),
      progress: value?.progress ?? 0,
      completed: Boolean(value?.claimable || value?.claimed),
      claimed: value?.claimed ?? false,
      claimable: value?.claimable ?? false,
      active: value?.active ?? false,
    };
  });
}

export const useQuests = () => {
  const controller = useProgress();
  const quests = useMemo<QuestStatus[]>(
    () =>
      projectQuests(
        controller.progress?.quests ?? null,
        Math.floor(Date.now() / 1_000),
      ),
    [controller.progress?.quests],
  );
  return {
    quests,
    isLoading: controller.loading,
    claiming: controller.claiming,
    error: controller.error,
    claimQuest: controller.claimQuest,
  };
};

export const groupQuests = (
  quests: QuestStatus[],
): Record<QuestType, QuestStatus[]> => ({
  daily: quests.filter((quest) => quest.type === "daily"),
  weekly: quests.filter((quest) => quest.type === "weekly"),
  finisher: quests.filter((quest) => quest.type === "finisher"),
});
