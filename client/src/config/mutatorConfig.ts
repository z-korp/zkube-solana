import { CAMPAIGN_CATALOG } from "@/core/campaignCatalog.generated";
import { guardianSentence } from "./guardianSentence";

export interface GuardianDef {
  name: string;
  description: string;
  icon: string;
}

type GuardianIdentity = Omit<GuardianDef, "description">;

const GUARDIANS: Readonly<Record<number, GuardianIdentity>> = {
  1: {
    name: "Mako's Gift",
    icon: "🐢",
  },
  2: {
    name: "Sobek's Strike",
    icon: "🐊",
  },
  3: {
    name: "Fenris Howl",
    icon: "🐺",
  },
  4: {
    name: "Noctua's Sight",
    icon: "🦉",
  },
  5: {
    name: "Long's Breath",
    icon: "🐲",
  },
  6: {
    name: "Lamassu's Gaze",
    icon: "🦁",
  },
  7: {
    name: "Kitsune's Spark",
    icon: "🦊",
  },
  8: {
    name: "Balam's Rite",
    icon: "🐆",
  },
  9: {
    name: "Mamba's Rhythm",
    icon: "🐍",
  },
  10: {
    name: "Kuntur's Trial",
    icon: "🦅",
  },
};

export function getGuardianDef(id: number): GuardianDef {
  const guardian = GUARDIANS[id];
  if (!guardian) throw new Error(`Unknown guardian ${id}`);
  const published = CAMPAIGN_CATALOG.maps.find((realm) => realm.mapId === id);
  if (!published) throw new Error(`Guardian ${id} has no published realm`);
  const [bonus, trigger, threshold] = published.rules;
  return {
    ...guardian,
    description: guardianSentence({ bonus, trigger, threshold }),
  };
}
