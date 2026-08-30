export interface GuardianDef {
  name: string;
  description: string;
  icon: string;
}

const GUARDIANS: Readonly<Record<number, GuardianDef>> = {
  1: {
    name: "Mako's Gift",
    description: "The sea turtle rewards a strong clear with a Wave.",
    icon: "🐢",
  },
  2: {
    name: "Sobek's Strike",
    description:
      "The Nile crocodile rewards exact two-line clears with the Hammer.",
    icon: "🐊",
  },
  3: {
    name: "Fenris Howl",
    description:
      "The frost wolf rewards a devastating block break with a Totem.",
    icon: "🐺",
  },
  4: {
    name: "Noctua's Sight",
    description: "The owl rewards sustained clearing with the Hammer.",
    icon: "🦉",
  },
  5: {
    name: "Long's Breath",
    description: "The dragon rewards sustained line clearing with a Wave.",
    icon: "🐲",
  },
  6: {
    name: "Lamassu's Gaze",
    description:
      "The gate guardian rewards breaking every block size in one action.",
    icon: "🦁",
  },
  7: {
    name: "Kitsune's Spark",
    description:
      "The spirit fox rewards exact three-line clears with the Hammer.",
    icon: "🦊",
  },
  8: {
    name: "Balam's Rite",
    description: "The jaguar rewards a strong clear with a Totem.",
    icon: "🐆",
  },
  9: {
    name: "Mamba's Rhythm",
    description: "The serpent turns combo milestones into Totems.",
    icon: "🐍",
  },
  10: {
    name: "Kuntur's Trial",
    description: "The condor rewards exact four-line clears with the Hammer.",
    icon: "🦅",
  },
};

export function getGuardianDef(id: number): GuardianDef {
  const guardian = GUARDIANS[id];
  if (!guardian) throw new Error(`Unknown guardian ${id}`);
  return guardian;
}
