import React from "react";

import { InfoRow } from "@/ui/components/shared/InfoSheet";

/**
 * Full Daily scoring/reward rules, shared by the Daily Challenge page and the
 * Rewards Daily tab so the on-screen copy stays a single plain-language line.
 */
export function DailyScoringRules({
  objectiveWeight,
}: {
  objectiveWeight?: number;
}): React.JSX.Element {
  return (
    <>
      <p>
        Each run is up to 100 moves. Your Daily score is the engine score plus
        the challenge bonus from the day&apos;s objective
        {objectiveWeight !== undefined ? ` (weighted ×${objectiveWeight})` : ""}
        .
      </p>
      <div>
        <InfoRow
          label="Ranking order"
          value="Daily score · challenge bonus · engine score · moves · player ID"
        />
        <InfoRow
          label="Retries"
          value="Unlimited — best finalized score counts"
        />
        <InfoRow label="First finish today" value="+100 XP" />
        <InfoRow label="First Tier 7 today" value="+50 XP" />
      </div>
      <p>
        Daily rank awards 100/60/30/10/2 Weekly points. Cash and Star rewards
        settle from the Weekly leaderboard at the end of the week.
      </p>
    </>
  );
}
