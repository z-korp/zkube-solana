export interface MutatorDef {
  id: number;
  name: string;
  description: string;
  icon: string;
  /** Zone-mode effects (includes star-threshold lines). */
  effects: string[];
  /**
   * Endless / tournament effects — star thresholds are omitted because star
   * ratings don't apply to those modes. Falls back to `effects` when absent.
   */
  effectsEndless?: string[];
}

// Campaign trigger types are authored once per map and remain fixed for all ten levels.
// Bonus types: 1=Hammer (destroy 1 block), 2=Totem (destroy all blocks of same size), 3=Wave (clear entire row)

const MUTATOR_DEFS: Record<number, MutatorDef> = {
  0: {
    id: 0,
    name: "No Mutator",
    description: "Standard rules apply",
    icon: "⚖️",
    effects: [],
  },

  // ── Active Mutators (odd IDs 1-19) ──

  // Zone 1 — Mako 🐢 / Tiki / Ocean
  1: {
    id: 1,
    name: "Mako's Gift",
    description:
      "The sea turtle rewards a strong clear with a Wave.",
    icon: "🐢",
    effects: ["3+ lines in one move = +1 Wave", "start with 1"],
  },
  // Zone 2 — Sobek 🐊 / Egypt
  3: {
    id: 3,
    name: "Sobek's Strike",
    description:
      "The Nile crocodile rewards exact two-line clears with the Hammer.",
    icon: "🐊",
    effects: ["exactly 2 lines = +1 Hammer", "start with 1"],
  },
  // Zone 3 — Fenris 🐺 / Norse
  5: {
    id: 5,
    name: "Fenris Howl",
    description:
      "The frost wolf answers a strong clear with the Totem.",
    icon: "🐺",
    effects: ["3+ lines in one move = +1 Totem", "start with 1"],
  },
  // Zone 4 — Noctua 🦉 / Greece
  7: {
    id: 7,
    name: "Noctua's Sight",
    description:
      "The owl rewards a perfectly empty board with the Hammer.",
    icon: "🦉",
    effects: ["empty the board = +1 Hammer", "max 1 per move", "start with 1"],
  },
  // Zone 5 — Long 🐲 / China
  9: {
    id: 9,
    name: "Long's Breath",
    description:
      "The dragon rewards sustained line clearing with a Wave.",
    icon: "🐲",
    effects: ["every 15 lines cleared = +1 Wave", "start with 1"],
  },
  // Zone 6 — Lamassu 🦁 / Persia
  11: {
    id: 11,
    name: "Lamassu's Gaze",
    description:
      "The gate guardian rewards one move that breaks every block size.",
    icon: "🦁",
    effects: ["break sizes 1-4 in one move = +1 Totem", "start with 1"],
  },
  // Zone 7 — Kitsune 🦊 / Japan
  13: {
    id: 13,
    name: "Kitsune's Spark",
    description:
      "The spirit fox rewards exact three-line clears with the Hammer.",
    icon: "🦊",
    effects: ["exactly 3 lines = +1 Hammer", "start with 1"],
  },
  // Zone 8 — Balam 🐆 / Mayan
  15: {
    id: 15,
    name: "Balam's Rite",
    description:
      "The jaguar rewards a perfectly empty board with a Wave.",
    icon: "🐆",
    effects: ["empty the board = +1 Wave", "max 1 per move", "start with 2"],
  },
  // Zone 9 — Mamba 🐍 / Tribal
  17: {
    id: 17,
    name: "Mamba's Rhythm",
    description:
      "The serpent turns Combo Meter milestones into Totems.",
    icon: "🐍",
    effects: ["every 8 combo points = +1 Totem", "max 1 per action", "start with 1"],
  },
  // Zone 10 — Kuntur 🦅 / Inca
  19: {
    id: 19,
    name: "Kuntur's Trial",
    description:
      "The condor rewards exact four-line clears with the Hammer.",
    icon: "🦅",
    effects: ["exactly 4 lines = +1 Hammer", "start with 1"],
  },

  // ── Passive Mutators (even IDs 2-20) — change the rules of the zone ──

  // Zone 1 — Mako 🐢 / Tiki / Ocean
  2: {
    id: 2,
    name: "Calm Tides",
    description:
      "Gentle waters make ⭐ Stars easier to earn.",
    icon: "🌊",
    effects: ["stars 10% easier", "4 rows at start"],
    effectsEndless: ["4 rows at start"],
  },
  // Zone 2 — Sobek 🐊 / Egypt
  4: {
    id: 4,
    name: "Foundation Stone",
    description:
      "Measured scoring and perfect clears make the desert more forgiving.",
    icon: "☀️",
    effects: ["move score ×1.25", "perfect clear +10", "stars 5% easier", "5 rows at start"],
    effectsEndless: ["move score ×1.25", "perfect clear +10", "5 rows at start"],
  },
  // Zone 3 — Fenris 🐺 / Norse
  6: {
    id: 6,
    name: "Frozen Rage",
    description:
      "Fury rewards fury. Combos detonate and line clears chain steady pressure.",
    icon: "❄️",
    effects: ["combos ×1.5", "+1 per line", "4 rows at start"],
    effectsEndless: ["combos ×1.5", "+1 per line", "4 rows at start"],
  },
  // Zone 4 — Noctua 🦉 / Greece
  8: {
    id: 8,
    name: "Marble Discipline",
    description:
      "Precision pays through stronger moves and perfect clears.",
    icon: "🏛️",
    effects: ["move score ×1.25", "perfect clear +15", "5 rows at start"],
    effectsEndless: ["move score ×1.25", "perfect clear +15", "5 rows at start"],
  },
  // Zone 5 — Long 🐲 / China
  10: {
    id: 10,
    name: "Imperial Scale",
    description:
      "Waves roll in from the dragon's domain. Every line you break pays a steady toll.",
    icon: "🐉",
    effects: ["+1 per line", "6 rows at start"],
    effectsEndless: ["+1 per line", "6 rows at start"],
  },
  // Zone 6 — Lamassu 🦁 / Persia
  12: {
    id: 12,
    name: "Geometric Flow",
    description:
      "Patterns reward skilled combos and perfect clears.",
    icon: "🕌",
    effects: ["combos ×1.5", "perfect clear +10", "5 rows at start"],
    effectsEndless: ["combos ×1.5", "perfect clear +10", "5 rows at start"],
  },
  // Zone 7 — Kitsune 🦊 / Japan
  14: {
    id: 14,
    name: "Bushido",
    description:
      "The warrior's code turns every scored move into a sharper strike.",
    icon: "🗡️",
    effects: ["move score ×1.75", "5 rows at start"],
    effectsEndless: ["move score ×1.75", "5 rows at start"],
  },
  // Zone 8 — Balam 🐆 / Mayan
  16: {
    id: 16,
    name: "Jungle Altar",
    description:
      "The jaguar favors the skilled. Combos detonate at double strength.",
    icon: "🌿",
    effects: ["combos ×2", "6 rows at start"],
    effectsEndless: ["combos ×2", "6 rows at start"],
  },
  // Zone 9 — Mamba 🐍 / Tribal
  18: {
    id: 18,
    name: "Primal Pulse",
    description:
      "The serpent's drum. Combos cascade at ×2 and every line keeps the rhythm.",
    icon: "🔥",
    effects: ["combos ×2", "+1 per line", "6 rows at start"],
    effectsEndless: ["combos ×2", "+1 per line", "6 rows at start"],
  },
  // Zone 10 — Kuntur 🦅 / Inca
  20: {
    id: 20,
    name: "Altitude",
    description:
      "Thin air, strong scoring, double combos, and perfect-clear rewards at the summit.",
    icon: "⛰️",
    effects: ["move score ×1.5", "combos ×2", "perfect clear +20", "stars 5% harder", "7 rows at start"],
    effectsEndless: ["move score ×1.5", "combos ×2", "perfect clear +20", "7 rows at start"],
  },
};

const createFallbackMutator = (id: number): MutatorDef => ({
  id,
  name: `Mutator ${id}`,
  description: "Unknown mutator",
  icon: id % 2 === 0 ? "🛡️" : "✨",
  effects: [],
});

export const getMutatorDef = (id: number): MutatorDef =>
  id <= 0 ? MUTATOR_DEFS[0] : (MUTATOR_DEFS[id] ?? createFallbackMutator(id));

/**
 * Return the effect list tailored for the run's mode. In endless / tournament
 * runs (run_type === 1) star thresholds aren't scored, so we skip those lines.
 */
export const getMutatorEffects = (
  def: MutatorDef,
  isEndless: boolean,
): string[] => (isEndless ? (def.effectsEndless ?? def.effects) : def.effects);

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
