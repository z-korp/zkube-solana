import React from "react";

import { InfoRow } from "@/ui/components/shared/InfoSheet";

/**
 * Full Daily scoring/reward rules shared by every Arena disclosure.
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
          label="Every ranked run"
          value="0.02 SOL · separate owner signature"
        />
        <InfoRow label="First finish today" value="+100 XP" />
        <InfoRow label="First Tier 7 today" value="+50 XP" />
      </div>
      <p>
        Every finalized attempt appears in the attempt count, while only your
        best Daily score counts. Weekly skill bounties use three fixed metrics;
        Daily, Weekly, and Season SOL prizes are pushed automatically.
      </p>
    </>
  );
}
