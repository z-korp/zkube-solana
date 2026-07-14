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

export const MUTATOR_DEFS: Record<number, MutatorDef> = {
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
    effects: [
      "Clear 3+ lines in a move → Wave charge",
      "Start with 1 charge",
    ],
  },
  // Zone 2 — Sobek 🐊 / Egypt
  3: {
    id: 3,
    name: "Sobek's Strike",
    description:
      "The Nile crocodile rewards exact two-line clears with the Hammer.",
    icon: "🐊",
    effects: [
      "Clear exactly 2 lines in a move → Hammer charge",
      "Start with 1 charge",
    ],
  },
  // Zone 3 — Fenris 🐺 / Norse
  5: {
    id: 5,
    name: "Fenris Howl",
    description:
      "The frost wolf answers a strong clear with the Totem.",
    icon: "🐺",
    effects: [
      "Clear 3+ lines in a move → Totem charge",
      "Start with 1 charge",
    ],
  },
  // Zone 4 — Noctua 🦉 / Greece
  7: {
    id: 7,
    name: "Noctua's Sight",
    description:
      "The owl rewards a perfectly empty board with the Hammer.",
    icon: "🦉",
    effects: [
      "Perfect clear after a move or bonus → Hammer charge",
      "At most 1 perfect-clear charge between moves",
      "Start with 1 charge",
    ],
  },
  // Zone 5 — Long 🐲 / China
  9: {
    id: 9,
    name: "Long's Breath",
    description:
      "The dragon rewards sustained line clearing with a Wave.",
    icon: "🐲",
    effects: [
      "Every 15 lines cleared by moves → Wave charge",
      "Start with 1 charge",
    ],
  },
  // Zone 6 — Lamassu 🦁 / Persia
  11: {
    id: 11,
    name: "Lamassu's Gaze",
    description:
      "The gate guardian rewards one move that breaks every block size.",
    icon: "🦁",
    effects: [
      "Destroy sizes 1, 2, 3, and 4 in one move → Totem charge",
      "Start with 1 charge",
    ],
  },
  // Zone 7 — Kitsune 🦊 / Japan
  13: {
    id: 13,
    name: "Kitsune's Spark",
    description:
      "The spirit fox rewards exact three-line clears with the Hammer.",
    icon: "🦊",
    effects: [
      "Clear exactly 3 lines in a move → Hammer charge",
      "Start with 1 charge",
    ],
  },
  // Zone 8 — Balam 🐆 / Mayan
  15: {
    id: 15,
    name: "Balam's Rite",
    description:
      "The jaguar rewards a perfectly empty board with a Wave.",
    icon: "🐆",
    effects: [
      "Perfect clear after a move or bonus → Wave charge",
      "At most 1 perfect-clear charge between moves",
      "Start with 2 charges",
    ],
  },
  // Zone 9 — Mamba 🐍 / Tribal
  17: {
    id: 17,
    name: "Mamba's Rhythm",
    description:
      "The serpent turns Combo Meter milestones into Totems.",
    icon: "🐍",
    effects: [
      "Every 8 Combo Meter points → Totem charge",
      "Moves and bonuses can trigger it; at most 1 charge per action",
      "Start with 1 charge",
    ],
  },
  // Zone 10 — Kuntur 🦅 / Inca
  19: {
    id: 19,
    name: "Kuntur's Trial",
    description:
      "The condor rewards exact four-line clears with the Hammer.",
    icon: "🦅",
    effects: [
      "Clear exactly 4 lines in a move → Hammer charge",
      "Start with 1 charge",
    ],
  },

  // ── Passive Mutators (even IDs 2-20) — change the rules of the zone ──

  // Zone 1 — Mako 🐢 / Tiki / Ocean
  2: {
    id: 2,
    name: "Calm Tides",
    description:
      "Gentle waters make Campaign Stars easier to earn.",
    icon: "🌊",
    effects: [
      "−10% star thresholds (easier)",
      "4 starting rows",
    ],
    effectsEndless: ["4 starting rows"],
  },
  // Zone 2 — Sobek 🐊 / Egypt
  4: {
    id: 4,
    name: "Foundation Stone",
    description:
      "Measured scoring and perfect clears make the desert more forgiving.",
    icon: "☀️",
    effects: ["Move score ×1.25", "+10 on perfect clears", "−5% star thresholds (easier)", "5 starting rows"],
    effectsEndless: [
      "Move score ×1.25",
      "+10 on perfect clears",
      "5 starting rows",
    ],
  },
  // Zone 3 — Fenris 🐺 / Norse
  6: {
    id: 6,
    name: "Frozen Rage",
    description:
      "Fury rewards fury. Combos detonate and line clears chain steady pressure.",
    icon: "❄️",
    effects: [
      "×1.5 combo bonus on multi-line clears",
      "+1 per line clear",
      "4 starting rows",
    ],
    effectsEndless: [
      "×1.5 combo bonus on multi-line clears",
      "+1 per line clear",
      "4 starting rows",
    ],
  },
  // Zone 4 — Noctua 🦉 / Greece
  8: {
    id: 8,
    name: "Marble Discipline",
    description:
      "Precision pays through stronger moves and perfect clears.",
    icon: "🏛️",
    effects: [
      "Move score ×1.25",
      "+15 on perfect clears",
      "5 starting rows",
    ],
    effectsEndless: [
      "Move score ×1.25",
      "+15 on perfect clears",
      "5 starting rows",
    ],
  },
  // Zone 5 — Long 🐲 / China
  10: {
    id: 10,
    name: "Imperial Scale",
    description:
      "Waves roll in from the dragon's domain. Every line you break pays a steady toll.",
    icon: "🐉",
    effects: ["+1 per line clear", "6 starting rows"],
    effectsEndless: ["+1 per line clear", "6 starting rows"],
  },
  // Zone 6 — Lamassu 🦁 / Persia
  12: {
    id: 12,
    name: "Geometric Flow",
    description:
      "Patterns reward skilled combos and perfect clears.",
    icon: "🕌",
    effects: [
      "×1.5 combo bonus on multi-line clears",
      "+10 on perfect clears",
      "5 starting rows",
    ],
    effectsEndless: [
      "×1.5 combo bonus on multi-line clears",
      "+10 on perfect clears",
      "5 starting rows",
    ],
  },
  // Zone 7 — Kitsune 🦊 / Japan
  14: {
    id: 14,
    name: "Bushido",
    description:
      "The warrior's code turns every scored move into a sharper strike.",
    icon: "🗡️",
    effects: [
      "Move score ×1.75",
      "5 starting rows",
    ],
    effectsEndless: [
      "Move score ×1.75",
      "5 starting rows",
    ],
  },
  // Zone 8 — Balam 🐆 / Mayan
  16: {
    id: 16,
    name: "Jungle Altar",
    description:
      "The jaguar favors the skilled. Combos detonate at double strength.",
    icon: "🌿",
    effects: [
      "×2.0 combo bonus on multi-line clears",
      "6 starting rows",
    ],
    effectsEndless: [
      "×2.0 combo bonus on multi-line clears",
      "6 starting rows",
    ],
  },
  // Zone 9 — Mamba 🐍 / Tribal
  18: {
    id: 18,
    name: "Primal Pulse",
    description:
      "The serpent's drum. Combos cascade at ×2 and every line keeps the rhythm.",
    icon: "🔥",
    effects: [
      "×2.0 combo bonus on multi-line clears",
      "+1 per line clear",
      "6 starting rows",
    ],
    effectsEndless: [
      "×2.0 combo bonus on multi-line clears",
      "+1 per line clear",
      "6 starting rows",
    ],
  },
  // Zone 10 — Kuntur 🦅 / Inca
  20: {
    id: 20,
    name: "Altitude",
    description:
      "Thin air, strong scoring, double combos, and perfect-clear rewards at the summit.",
    icon: "⛰️",
    effects: [
      "Move score ×1.5",
      "×2.0 combo bonus on multi-line clears",
      "+20 on perfect clears",
      "+5% star thresholds (harder)",
      "7 starting rows",
    ],
    effectsEndless: [
      "Move score ×1.5",
      "×2.0 combo bonus on multi-line clears",
      "+20 on perfect clears",
      "7 starting rows",
    ],
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

export const BONUS_TYPES: Record<
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
