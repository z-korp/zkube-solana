export interface ZoneGuardian {
  zoneId: number;
  name: string;
  title: string;
  personality: string;
  greeting: string;
  dailyGreeting: string;
  zoneHint: string;
  encouragement: string;
  trialIntro: string;
  respectLine: string;
  oneStar: string;
  twoStar: string;
  threeStar: string;
  incomplete: string;
  /** Arcade payout ceremony — celebratory, spoken with the celebrate frame. */
  prizeLine: string;
  /** Arcade entry — the guardian accepts the fed coin (satisfied frame). */
  entryLine: string;
  /** Campaign boss falls — spoken with the defeated frame. */
  defeatLine: string;
  /** Arcade insert-coin idle — the guardian as arcade host, not zone master. */
  arcadeGreeting: string;
  /** Arcade run scored but out of the money. */
  noPrizeLine: string;
  /** Arcade personal best — spoken with the surprised frame. */
  newBestLine: string;
  emoji: string;
}

export const ZONE_GUARDIANS: Record<number, ZoneGuardian> = {
  1: {
    zoneId: 1,
    name: "Mako",
    title: "Spirit of the Tides",
    personality: "Ancient sea turtle spirit, wise and patient",
    greeting:
      "The ocean has many lessons, young one. Let the tides guide your hands.",
    dailyGreeting:
      "Today the tides shift for all challengers equally. Ride them better than anyone.",
    zoneHint:
      "Build steady combos. Every cleared line adds a point, and 3 or more lines in one action earns a Wave.",
    encouragement: "The current is with you. Trust the flow.",
    trialIntro:
      "The ocean's final wave approaches. Show me you've learned its rhythm.",
    respectLine: "The tides accept you. Swim with us now.",
    oneStar: "You survived the wave, but the ocean has more to teach.",
    twoStar: "Good form. The current carried you well.",
    threeStar: "The ocean itself bows. Perfect rhythm.",
    incomplete: "The tide recedes... but it always returns. Try again.",
    prizeLine:
      "The tide returns bearing gold. Take it, rider of currents.",
    entryLine: "The ocean accepts your offering. Swim.",
    defeatLine:
      "The current... flows past me now. Well ridden.",
    arcadeGreeting:
      "The tide pool glitters tonight. Add your coin to the current.",
    noPrizeLine:
      "The tide went out without you. It always returns.",
    newBestLine:
      "...The ocean itself just shifted. Your finest swim.",
    emoji: "🐢",
  },
  2: {
    zoneId: 2,
    name: "Sobek",
    title: "The Nile Guardian",
    personality: "Ancient crocodile spirit, patient and devastating",
    greeting:
      "The sands remember all who enter. Only the precise survive the Nile's judgment.",
    dailyGreeting:
      "The Nile tests all equally today. Precision will separate the worthy from the rest.",
    zoneHint:
      "Demolish the board with 1.5× move scoring. Perfect clears add 20, and exactly 2 lines earns a Hammer.",
    encouragement: "Patience and precision. The Nile rewards those who wait.",
    trialIntro: "The waters rise. Face the jaws of the Nile or be swept away.",
    respectLine: "The Nile parts for you. You have earned safe passage.",
    oneStar: "You crossed the river, but barely. The Nile demands more.",
    twoStar: "A worthy passage. The sands note your precision.",
    threeStar: "Flawless. The pharaohs would envy your discipline.",
    incomplete: "The sands swallow those who hesitate. Return stronger.",
    prizeLine:
      "The Nile pays its debts in gold. Yours, champion.",
    entryLine: "The river takes its toll. Cross.",
    defeatLine:
      "The jaws... close on nothing. You were faster.",
    arcadeGreeting:
      "The river runs rich today. Feed it.",
    noPrizeLine:
      "The Nile keeps what it takes. Return hungrier.",
    newBestLine:
      "...Even the old river is impressed. Again.",
    emoji: "🐊",
  },
  3: {
    zoneId: 3,
    name: "Fenris",
    title: "The Frost Wolf",
    personality: "Massive ice wolf spirit, fierce and relentless",
    greeting:
      "The frozen wastes spare no one. Only those with fire in their heart survive.",
    dailyGreeting:
      "The storm rages equally for all today. Strike harder than your rivals.",
    zoneHint:
      "Dare to chain clears: combos score at ×2, every line adds a point, and 3 or more lines earns a Totem.",
    encouragement: "Strike hard. Strike fast. The frost does not wait.",
    trialIntro: "The blizzard howls. Face the storm or be buried beneath it.",
    respectLine: "The pack accepts your strength. Run with us through the ice.",
    oneStar: "You endured, but the frost nearly claimed you.",
    twoStar: "Strong. The ice bends to your will.",
    threeStar: "Even the blizzard could not touch you. Legendary.",
    incomplete: "The cold takes the weak. Return with fire in your heart.",
    prizeLine:
      "The hunt is yours. Feast on your spoils, packmate.",
    entryLine: "Your offering steams in the snow. Run.",
    defeatLine:
      "The storm breaks... the wolf yields. Lead the pack.",
    arcadeGreeting:
      "The hunt pays in gold tonight. Run with the pack.",
    noPrizeLine:
      "The kill went to faster jaws. Sharpen yours.",
    newBestLine:
      "...A new howl echoes off the ice. Yours.",
    emoji: "🐺",
  },
  4: {
    zoneId: 4,
    name: "Noctua",
    title: "The Marble Owl",
    personality: "Wise owl spirit carved from living marble",
    greeting: "Welcome to the arena of the mind. Here, strategy conquers all.",
    dailyGreeting:
      "The same puzzle for all minds today. Prove yours is the sharpest.",
    zoneHint:
      "Pure execution wins: moves score at ×2, perfect clears add 15 and earn a Hammer, including bonus-created clears.",
    encouragement: "Think before you act. Every move is a theorem.",
    trialIntro: "Wisdom alone is not enough. Now prove you can act on it.",
    respectLine: "Knowledge and action, united. The owl sees your worth.",
    oneStar: "A passing grade, but far from elegant.",
    twoStar: "Well reasoned. Your logic holds.",
    threeStar: "A theorem proven without flaw. Brilliant.",
    incomplete: "The equation remains unsolved. Reconsider your approach.",
    prizeLine:
      "The proof is complete. Collect what wisdom earned.",
    entryLine: "A wager placed with reason. Begin.",
    defeatLine:
      "Checkmate... elegantly played. The owl bows.",
    arcadeGreeting:
      "The arena rewards proofs in gold. Present yours.",
    noPrizeLine:
      "A sound argument, but not the winning one. Revise.",
    newBestLine:
      "...Remarkable. A theorem I had not foreseen.",
    emoji: "🦉",
  },
  5: {
    zoneId: 5,
    name: "Long",
    title: "The Jade Dragon",
    personality: "Ancient jade dragon spirit, patient and overwhelming",
    greeting: "The dragon waits. Those who endure its gaze earn its power.",
    dailyGreeting:
      "The dragon's gaze falls on all challengers today. Outlast them all.",
    zoneHint:
      "Sustained pressure pays: every line adds 3 points, and every 15 lines cleared by moves earns a Wave.",
    encouragement: "Flow like the river. It carves mountains given time.",
    trialIntro: "The dragon stirs. Withstand its breath or be consumed.",
    respectLine: "The dragon bows. Your endurance is worthy of the heavens.",
    oneStar: "You survived the flood, but only just.",
    twoStar: "The river bends to your patience. Well done.",
    threeStar: "Even the dragon's torrent could not shake you. Imperial.",
    incomplete: "The current swept you away. Plant your feet deeper next time.",
    prizeLine:
      "A dragon honors its debts. Take your jade and gold.",
    entryLine: "The river accepts your tribute. Endure.",
    defeatLine:
      "The storm passes... and you remain. The heavens take note.",
    arcadeGreeting:
      "The river of fortune flows through this hall. Step in.",
    noPrizeLine:
      "The current carried the jade elsewhere. Endure.",
    newBestLine:
      "...The heavens take note. So does the dragon.",
    emoji: "🐲",
  },
  6: {
    zoneId: 6,
    name: "Lamassu",
    title: "The Gate Guardian",
    personality: "Winged lion spirit, ancient and all-knowing",
    greeting:
      "Every tile has its place in the mosaic. Can you see the pattern?",
    dailyGreeting:
      "The same mosaic for all eyes today. See the pattern faster than anyone.",
    zoneHint:
      "Stack patterns: combos score at ×2, lines add points, and breaking sizes 1-4 in one action earns a Totem.",
    encouragement:
      "Look deeper. The pattern reveals itself to the patient eye.",
    trialIntro:
      "The gate opens for those who see the pattern. Prove your sight.",
    respectLine: "The gate stands open. You see what others cannot.",
    oneStar: "You found the pattern, but missed its beauty.",
    twoStar: "The mosaic takes shape under your hands.",
    threeStar: "Every tile in its place. The pattern is complete.",
    incomplete: "The tiles scatter. Gather them and try again.",
    prizeLine:
      "The gate opens on a treasury. It is yours.",
    entryLine: "A tile placed. The mosaic begins.",
    defeatLine:
      "The pattern... was you all along. Pass through.",
    arcadeGreeting:
      "Beyond this gate lies treasure. Pay the toll.",
    noPrizeLine:
      "The gate stayed shut this time. Knock harder.",
    newBestLine:
      "...The pattern rearranged itself. Astonishing.",
    emoji: "🦁",
  },
  7: {
    zoneId: 7,
    name: "Kitsune",
    title: "The Spirit Fox",
    personality: "Mystical nine-tailed fox spirit, swift and cunning",
    greeting:
      "Catch me if you can. But beware, little puzzler, foxfire burns the careless.",
    dailyGreeting:
      "The same trick for all challengers today. Let's see who falls for it last.",
    zoneHint:
      "Harvest fast: moves score at ×3, perfect clears add 20, and exactly 3 lines earns a Hammer.",
    encouragement: "Quick paws, quick mind. Don't overthink it.",
    trialIntro:
      "Nine tails, nine illusions. See through them all or be lost forever.",
    respectLine: "You saw through every trick. The fox respects a sharp eye.",
    oneStar: "You escaped my illusions, but just barely.",
    twoStar: "Not bad. You kept your wits when the foxfire flickered.",
    threeStar: "Every illusion shattered. You're sharper than my claws.",
    incomplete: "Lost in the illusion. Find your way back and try again.",
    prizeLine:
      "You caught the fox and the purse. Cheeky. I like it.",
    entryLine: "A shiny thing! I'll hold it. Probably.",
    defeatLine:
      "Nine tails, all fooled... you win this round.",
    arcadeGreeting:
      "Shiny coin, shinier prizes. Care to out-trick fate?",
    noPrizeLine:
      "Fate tricked you first. Delicious. Go again.",
    newBestLine:
      "...Wait. THAT was not an illusion?!",
    emoji: "🦊",
  },
  8: {
    zoneId: 8,
    name: "Balam",
    title: "The Jungle Jaguar",
    personality: "Shadow jaguar spirit, primal and three-headed",
    greeting:
      "The jungle speaks to those who listen. Three gifts await the worthy.",
    dailyGreeting:
      "The jungle offers its three gifts to all today. Use them wisely, others won't hesitate.",
    zoneHint:
      "Start with 2 Totems. Perfect clears earn another, and combos score at double strength.",
    encouragement: "The ritual demands everything. Give it all.",
    trialIntro:
      "Three eyes open. Three powers converge. Survive the jaguar's gaze.",
    respectLine: "The jungle accepts you as one of its own. Walk unseen.",
    oneStar: "The ritual was... adequate. The jungle expects more.",
    twoStar: "The spirits stir. Your offering pleases them.",
    threeStar: "A perfect ritual. The jungle sings your name.",
    incomplete: "The ritual failed. The spirits turn away. Begin anew.",
    prizeLine:
      "The ritual bears gold. The jungle shares its bounty.",
    entryLine: "The jungle accepts your offering. Hunt.",
    defeatLine:
      "Three eyes close... the jungle sleeps for you.",
    arcadeGreeting:
      "The jungle trades gold for offerings. Make yours.",
    noPrizeLine:
      "The spirits fed elsewhere tonight. Offer again.",
    newBestLine:
      "...Three eyes widen. The jungle will remember this.",
    emoji: "🐆",
  },
  9: {
    zoneId: 9,
    name: "Mamba",
    title: "The Shadow Mamba",
    personality: "Colossal black mamba spirit, rhythmic and relentless",
    greeting: "Listen. The rhythm pulses through the earth. Follow it or fall.",
    dailyGreeting:
      "The same beat for all today. Match the rhythm longer than anyone else.",
    zoneHint:
      "Combos score at ×2, lines add 2 points, and every 8 Combo Meter points earns one Totem per action.",
    encouragement: "Feel the pulse. Let it guide your strikes.",
    trialIntro:
      "The mamba strikes without warning. Match its speed or be consumed.",
    respectLine: "You move like shadow. The mamba acknowledges its equal.",
    oneStar: "You kept the beat, but stumbled on the drops.",
    twoStar: "Your rhythm is strong. The drums resonate.",
    threeStar: "Thunder itself dances to your beat. Flawless.",
    incomplete: "You lost the rhythm. Listen again, and return.",
    prizeLine:
      "The beat drops gold at your feet. Dance on, champion.",
    entryLine: "Your coin joins the rhythm. Keep time.",
    defeatLine:
      "The rhythm... fades. Yours plays louder.",
    arcadeGreeting:
      "Tonight the beat drops gold. Buy in and keep time.",
    noPrizeLine:
      "The rhythm paid another dancer. Find the beat.",
    newBestLine:
      "...The drums skipped. You broke your own record.",
    emoji: "🐍",
  },
  10: {
    zoneId: 10,
    name: "Kuntur",
    title: "The Sun Condor",
    personality: "Golden condor spirit, austere and all-seeing",
    greeting:
      "The mountain path is narrow and the air is thin. Only the focused reach the summit.",
    dailyGreeting:
      "One path. One summit. All climbers face the same mountain today. Reach highest.",
    zoneHint:
      "The ultimate test: moves and combos score at ×2.5, perfect clears add 30, and exactly 4 lines earns a Hammer.",
    encouragement: "Less is more. One wing beat, one purpose.",
    trialIntro:
      "The summit awaits. With nothing but your will, prove you belong among the stars.",
    respectLine:
      "You stand at the peak. The sun condor carries your name to the heavens.",
    oneStar: "You reached the ledge, but the summit is far above.",
    twoStar: "The altitude tests you, and you endure.",
    threeStar: "The peak is yours. The sun shines on no one brighter.",
    incomplete: "The mountain rejects the unprepared. Train and return.",
    prizeLine:
      "Summit gold, carried on sun wings. It is yours.",
    entryLine: "The mountain takes its due. Climb.",
    defeatLine:
      "The peak... belongs to you. Fly higher than I.",
    arcadeGreeting:
      "Gold waits at the summit. The climb costs one coin.",
    noPrizeLine:
      "The summit stayed above you. Climb again.",
    newBestLine:
      "...Higher than your highest. The sun saw it.",
    emoji: "🦅",
  },
};

export function getGuardianStarText(
  guardian: ZoneGuardian,
  stars: number,
): string {
  if (stars >= 3) return guardian.threeStar;
  if (stars >= 2) return guardian.twoStar;
  if (stars >= 1) return guardian.oneStar;
  return guardian.incomplete;
}

export function getZoneGuardian(zoneId: number): ZoneGuardian {
  return ZONE_GUARDIANS[zoneId] ?? ZONE_GUARDIANS[1];
}

// All ten zones ship a full expression-frame set
// (public/assets/theme-N/boss/<frame>.png) from the sprite pipeline
// (client/tools/sprites/generate-guardian-rig.mjs).

/**
 * Returns the canonical guardian display art: the `idle` frame — the same
 * art the talking scenes rest on, so the guardian looks identical
 * everywhere. portrait.png remains on disk purely as the generation
 * reference for the sprite pipeline.
 */
export function getGuardianPortrait(zoneId: number): string {
  const clamped = Math.min(10, Math.max(1, zoneId || 1));
  return `/assets/theme-${clamped}/boss/idle.png`;
}
