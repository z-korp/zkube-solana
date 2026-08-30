import { useMemo } from "react";

import { useCampaign, useRun } from "@/backend/client";
import { Game } from "@/game/model";

export const useGame = (options: {
  gameId: bigint | undefined;
  shouldLog: boolean;
}) => {
  const run = useRun();
  const { campaign } = useCampaign();
  const game = useMemo(() => {
    const active = run.activeRun;
    if (!active) return null;
    const levelStars =
      active.mode === "campaign"
        ? (campaign?.maps.find((map) => map.mapId === active.mapId)
            ?.levelStars ?? [])
        : [];
    return new Game(active, levelStars);
  }, [campaign?.maps, run.activeRun]);

  void options;
  return { game, gameKey: null, seed: 0n };
};
