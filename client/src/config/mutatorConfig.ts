export interface GuardianDef {
  id: number;
  name: string;
  description: string;
  icon: string;
  effects: string[];
}

// Campaign trigger types are authored once per map and remain fixed for all ten levels.
// Bonus types: 1=Hammer (destroy 1 block), 2=Totem (destroy all blocks of same size), 3=Wave (clear entire row)

const GUARDIAN_DEFS: Record<number, GuardianDef> = {
  0: {
    id: 0,
    name: "No Guardian",
    description: "Standard rules apply",
    icon: "⚖️",
    effects: [],
  },


  // ── Campaign guardians ──
  21: {
    id: 21,
    name: "Mako's Gift",
    description: "The sea turtle rewards a strong clear with a Wave.",
    icon: "🐢",
    effects: ["2+ lines in one action = +1 Wave"],
  },
  23: {
    id: 23,
    name: "Sobek's Strike",
    description:
      "The Nile crocodile rewards exact two-line clears with the Hammer.",
    icon: "🐊",
    effects: ["exactly 2 lines = +1 Hammer"],
  },
  25: {
    id: 25,
    name: "Fenris Howl",
    description: "The frost wolf rewards a devastating block break with a Totem.",
    icon: "🐺",
    effects: ["break 10+ blocks in one action = +1 Totem"],
  },
  27: {
    id: 27,
    name: "Noctua's Sight",
    description: "The owl rewards sustained clearing with the Hammer.",
    icon: "🦉",
    effects: ["3 clearing moves in a row = +1 Hammer"],
  },
  29: {
    id: 29,
    name: "Long's Breath",
    description: "The dragon rewards sustained line clearing with a Wave.",
    icon: "🐲",
    effects: ["every 7 lines cleared by moves = +1 Wave"],
  },
  31: {
    id: 31,
    name: "Lamassu's Gaze",
    description:
      "The gate guardian rewards breaking every block size in one action.",
    icon: "🦁",
    effects: ["break sizes 1-4 in one action = +1 Totem"],
  },
  33: {
    id: 33,
    name: "Kitsune's Spark",
    description:
      "The spirit fox rewards exact three-line clears with the Hammer.",
    icon: "🦊",
    effects: ["exactly 3 lines = +1 Hammer"],
  },
  35: {
    id: 35,
    name: "Balam's Rite",
    description: "The jaguar rewards a strong clear with a Totem.",
    icon: "🐆",
    effects: ["3+ lines in one action = +1 Totem"],
  },
  37: {
    id: 37,
    name: "Mamba's Rhythm",
    description: "The serpent turns combo milestones into Totems.",
    icon: "🐍",
    effects: ["every 2 combo moves = +1 Totem", "max 1 per action"],
  },
  39: {
    id: 39,
    name: "Kuntur's Trial",
    description: "The condor rewards exact four-line clears with the Hammer.",
    icon: "🦅",
    effects: ["exactly 4 lines = +1 Hammer"],
  },
};

const createFallbackGuardian = (id: number): GuardianDef => ({
  id,
  name: `Guardian ${id}`,
  description: "Unknown guardian",
  icon: id % 2 === 0 ? "🛡️" : "✨",
  effects: [],
});

export const getGuardianDef = (id: number): GuardianDef =>
  id <= 0 ? GUARDIAN_DEFS[0] : (GUARDIAN_DEFS[id] ?? createFallbackGuardian(id));

const BONUS_TYPES: Record<
  number,
  { name: string; icon: string; description: string }
> = {
  0: { name: "None", icon: "", description: "" },
  1: {
    name: "Hammer",
    icon: "/assets/common/bonus/hammer.png",
    description: "Destroy a single block",
  },
  2: {
    name: "Totem",
    icon: "/assets/common/bonus/tiki.png",
    description: "Destroy all blocks of one size",
  },
  3: {
    name: "Wave",
    icon: "/assets/common/bonus/wave.png",
    description: "Clear an entire row",
  },
};

export const getBonusType = (id: number) => BONUS_TYPES[id] ?? BONUS_TYPES[0];

export const REROLL_ACTION = {
  name: "Reroll",
  icon: "/assets/common/bonus/reroll.png",
  description: "Replace the next preview row",
} as const;
