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
          value="Daily score · bonus triggers · earlier completion"
        />
        <InfoRow
          label="Retries"
          value="First attempt free · up to 5 paid retries at 10 Cubes"
        />
        <InfoRow label="First finish today" value="+100 XP" />
        <InfoRow label="First Tier 7 today" value="+50 XP" />
      </div>
      <p>
        Every finalized attempt appears in the attempt count, while only your
        best Daily score counts. A Weekly keeps your best 10 of 14 Daily scores;
        the top 5 earn SOL and ranks 6–20 earn Cubes.
      </p>
    </>
  );
}
