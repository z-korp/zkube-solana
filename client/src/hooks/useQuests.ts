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
import { blockQuestVariant } from "@/chain/progressCatalog";

export interface QuestStatus extends QuestDef {
  index: number;
  blockSize: number | null;
  intervalId: number;
  progress: number;
  completed: boolean;
  claimed: boolean;
  claimable: boolean;
  active: boolean;
}

export function projectQuests(
  entries: readonly QuestProgressView[] | null,
  now = Math.floor(Date.now() / 1_000),
): QuestStatus[] {
  const day = Math.max(0, Math.floor(now / 86_400));
  return QUEST_DEFS.map((definition, index) => {
    const value = entries?.[index];
    const blockSize =
      index === 7
        ? (value?.blockSize ?? blockQuestVariant(day).blockSize)
        : null;
    const target = value?.threshold ?? definition.target;
    return {
      ...definition,
      index,
      description:
        blockSize === null
          ? definition.description
          : `Destroy ${target} size-${blockSize} blocks`,
      target,
      blockSize,
      xpReward: value?.xpReward ?? definition.xpReward,
      cubeReward: value
        ? bigintToSafeNumber(value.cubeReward)
        : definition.cubeReward,
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
