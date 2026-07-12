import { useMemo } from "react";

import { useCampaignController } from "@/contexts/campaign";
import { useRun } from "@/contexts/run";
import { Game } from "@/dojo/game/models/game";

export const useGame = (options: {
  gameId: bigint | undefined;
  shouldLog: boolean;
}) => {
  const run = useRun();
  const { campaign } = useCampaignController();
  const game = useMemo(() => {
    const active = run.activeRun;
    if (!active) return null;
    const levelStars =
      active.mode === "daily"
        ? []
        : (campaign?.maps.find((map) => map.mapId === active.mapId)
            ?.levelStars ?? []);
    return new Game(active, levelStars);
  }, [campaign?.maps, run.activeRun]);

  void options;
  return { game, gameKey: null, seed: 0n };
};
