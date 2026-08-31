import { MONEY_SURFACE_SENTINEL } from "@/ui/moneySurface";

export interface GuardianPrizeCopy {
  readonly prizeLine: string;
  readonly entryLine: string;
  readonly arcadeGreeting: string;
  readonly noPrizeLine: string;
  readonly surface: typeof MONEY_SURFACE_SENTINEL;
}

type GuardianPrizeLines = Omit<GuardianPrizeCopy, "surface">;

const GUARDIAN_PRIZE_COPY: Record<number, GuardianPrizeLines> = {
  1: {
    prizeLine: "The tide returns bearing gold. Take it, rider of currents.",
    entryLine: "The ocean accepts your offering. Swim.",
    arcadeGreeting:
      "The tide pool glitters tonight. Add your coin to the current.",
    noPrizeLine: "The tide went out without you. It always returns.",
  },
  2: {
    prizeLine: "The Nile pays its debts in gold. Yours, champion.",
    entryLine: "The river takes its toll. Cross.",
    arcadeGreeting: "The river runs rich today. Feed it.",
    noPrizeLine: "The Nile keeps what it takes. Return hungrier.",
  },
  3: {
    prizeLine: "The hunt is yours. Feast on your spoils, packmate.",
    entryLine: "Your offering steams in the snow. Run.",
    arcadeGreeting: "The hunt pays in gold tonight. Run with the pack.",
    noPrizeLine: "The kill went to faster jaws. Sharpen yours.",
  },
  4: {
    prizeLine: "The proof is complete. Collect what wisdom earned.",
    entryLine: "A wager placed with reason. Begin.",
    arcadeGreeting: "The arena rewards proofs in gold. Present yours.",
    noPrizeLine: "A sound argument, but not the winning one. Revise.",
  },
  5: {
    prizeLine: "A dragon honors its debts. Take your jade and gold.",
    entryLine: "The river accepts your tribute. Endure.",
    arcadeGreeting: "The river of fortune flows through this hall. Step in.",
    noPrizeLine: "The current carried the jade elsewhere. Endure.",
  },
  6: {
    prizeLine: "The gate opens on a treasury. It is yours.",
    entryLine: "A tile placed. The mosaic begins.",
    arcadeGreeting: "Beyond this gate lies treasure. Pay the toll.",
    noPrizeLine: "The gate stayed shut this time. Knock harder.",
  },
  7: {
    prizeLine: "You caught the fox and the purse. Cheeky. I like it.",
    entryLine: "A shiny thing! I'll hold it. Probably.",
    arcadeGreeting: "Shiny coin, shinier prizes. Care to out-trick fate?",
    noPrizeLine: "Fate tricked you first. Delicious. Go again.",
  },
  8: {
    prizeLine: "The ritual bears gold. The jungle shares its bounty.",
    entryLine: "The jungle accepts your offering. Hunt.",
    arcadeGreeting: "The jungle trades gold for offerings. Make yours.",
    noPrizeLine: "The spirits fed elsewhere tonight. Offer again.",
  },
  9: {
    prizeLine: "The beat drops gold at your feet. Dance on, champion.",
    entryLine: "Your coin joins the rhythm. Keep time.",
    arcadeGreeting: "Tonight the beat drops gold. Buy in and keep time.",
    noPrizeLine: "The rhythm paid another dancer. Find the beat.",
  },
  10: {
    prizeLine: "Summit gold, carried on sun wings. It is yours.",
    entryLine: "The mountain takes its due. Climb.",
    arcadeGreeting: "Gold waits at the summit. The climb costs one coin.",
    noPrizeLine: "The summit stayed above you. Climb again.",
  },
};

export function getGuardianPrizeCopy(zoneId: number): GuardianPrizeCopy {
  return {
    ...(GUARDIAN_PRIZE_COPY[zoneId] ?? GUARDIAN_PRIZE_COPY[1]),
    surface: MONEY_SURFACE_SENTINEL,
  };
}
