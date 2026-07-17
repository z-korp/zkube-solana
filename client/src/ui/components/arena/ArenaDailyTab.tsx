import { useCallback, useMemo, useState } from "react";
import { Eye, Loader2, Trophy } from "lucide-react";
import { motion } from "motion/react";

import {
  dailyScoringRuleDescription,
  dailyScoringRuleName,
} from "@/chain/dailyRules";
import { getGuardianPortrait, getZoneGuardian } from "@/config/bossCharacters";
import { getMutatorDef } from "@/config/mutatorConfig";
import { ZONE_NAMES } from "@/config/profileData";
import {
  getThemeColors,
  getThemeId,
  getThemeImages,
  type ThemeColors,
} from "@/config/themes";
import { useDaily } from "@/contexts/daily";
import useAccount from "@/hooks/useAccount";
import { useActiveDailyAttempt } from "@/hooks/useActiveDailyAttempt";
import { useCurrentChallenge } from "@/hooks/useCurrentChallenge";
import { useDailyLeaderboard } from "@/hooks/useDailyLeaderboard";
import { usePlayerEntry } from "@/hooks/usePlayerEntry";
import { usePreviousChallenge } from "@/hooks/usePreviousChallenge";
import { useNavigationStore } from "@/stores/navigationStore";
import DailyResultCard, {
  Countdown,
} from "@/ui/components/arena/DailyResultCard";
import { getPlayerPosition } from "@/ui/components/arena/dailyPosition";
import { DailyScoringRules } from "@/ui/components/arena/dailyRulesCopy";
import ArcadeButton from "@/ui/components/shared/ArcadeButton";
import EmptyState from "@/ui/components/shared/EmptyState";
import InfoSheet from "@/ui/components/shared/InfoSheet";
import { truncatePublicKey } from "@/utils/solanaDisplay";

const TROPHY_IMAGES: Record<number, string> = {
  1: "/assets/common/trophies/gold.png",
  2: "/assets/common/trophies/silver.png",
  3: "/assets/common/trophies/bronze.png",
};

const rowVariants = {
  hidden: { opacity: 0, x: -20 },
  visible: (index: number) => ({
    opacity: 1,
    x: 0,
    transition: {
      delay: index * 0.04,
      type: "spring" as const,
      stiffness: 300,
      damping: 24,
    },
  }),
};

/**
 * The whole daily loop on one screen: today's rules, the enter/resume CTA,
 * the live board (rows spectate on tap), and yesterday's result.
 */
const ArenaDailyTab: React.FC<{ colors: ThemeColors }> = ({ colors }) => {
  const { address } = useAccount();
  const daily = useDaily();
  const previous = usePreviousChallenge();
  const activeDailyRun = useActiveDailyAttempt();
  const { challenge, isLoading: challengeLoading } = useCurrentChallenge();
  const { entries: dailyEntries, isLoading: boardLoading } =
    useDailyLeaderboard(challenge?.challenge_id);
  const { entry: playerEntry } = usePlayerEntry(
    challenge?.challenge_id,
    address,
  );
  const navigate = useNavigationStore((state) => state.navigate);
  const openShop = useNavigationStore((state) => state.openShop);
  const setSpectateTarget = useNavigationStore(
    (state) => state.setSpectateTarget,
  );
  const [starting, setStarting] = useState(false);

  const now = Math.floor(Date.now() / 1000);
  const hasActiveDailyRun = Boolean(activeDailyRun);
  const isActive = Boolean(
    challenge &&
    !challenge.settled &&
    !challenge.cancelled &&
    challenge.start_time <= now &&
    challenge.end_time > now,
  );
  const entriesOpen = Boolean(
    daily.daily &&
    daily.daily.status === "open" &&
    daily.daily.opensAt <= now &&
    daily.daily.entriesCloseAt > now,
  );
  const runAvailable =
    daily.run.phase === "none" || daily.run.phase === "missing";

  // A missing challenge has no client-computed fallback. The map is part of
  // the immutable daily account and must come from Solana.
  const zoneId = challenge?.zone_id ?? 1;
  const zoneName = ZONE_NAMES[zoneId] ?? `Zone ${zoneId}`;
  const themeId = getThemeId(zoneId);
  const zoneImages = getThemeImages(themeId);
  const zoneColors = getThemeColors(themeId);
  const guardian = getZoneGuardian(zoneId);
  const scoringRule = daily.daily?.scoringRule ?? null;

  const activeMutator = challenge?.active_mutator_id
    ? getMutatorDef(challenge.active_mutator_id)
    : null;
  const passiveMutator = challenge?.passive_mutator_id
    ? getMutatorDef(challenge.passive_mutator_id)
    : null;

  const previousPosition = useMemo(
    () => getPlayerPosition(previous.daily, address),
    [address, previous.daily],
  );

  const rankRows = useMemo(
    () =>
      dailyEntries.slice(0, 30).map((entry) => ({
        id: `daily-${entry.rank}`,
        rank: entry.rank,
        name: entry.playerName,
        score: entry.dailyScore ?? entry.score,
        dailyBonusTriggers: entry.dailyBonusTriggers ?? 0,
        engineScore: entry.engineScore ?? entry.score,
        moves: entry.moves ?? 0,
        playerAddress: entry.player,
        runId: entry.runId,
        isYou: address === entry.player,
      })),
    [address, dailyEntries],
  );

  const visiblePlayerRank = useMemo(() => {
    const ranked = dailyEntries.find((entry) => entry.player === address);
    if (ranked) {
      return {
        rank: ranked.rank,
        score: ranked.dailyScore ?? ranked.score,
        name: `You · ${truncatePublicKey(address)}`,
      };
    }
    if (
      playerEntry &&
      playerEntry.rank > 0 &&
      (playerEntry.bestDailyScore ?? playerEntry.bestScore) > 0
    ) {
      return {
        rank: playerEntry.rank,
        score: playerEntry.bestDailyScore ?? playerEntry.bestScore,
        name: `You · ${truncatePublicKey(address)}`,
      };
    }
    return null;
  }, [address, dailyEntries, playerEntry]);

  const isMyRankVisible = rankRows.some((row) => row.isYou);

  const watch = useCallback(
    (player: string, runId: bigint) => {
      setSpectateTarget({ player, runId: runId.toString() });
      navigate("spectate");
    },
    [navigate, setSpectateTarget],
  );

  const openRun = useCallback(() => {
    if (!activeDailyRun) return;
    navigate("play", activeDailyRun.gameId);
  }, [activeDailyRun, navigate]);

  const enter = useCallback(async () => {
    if (starting || hasActiveDailyRun) return;
    setStarting(true);
    try {
      const run = await daily.enter();
      navigate("play", run.runId);
    } catch {
      // The shared controller projects transaction failures into daily.error.
    } finally {
      setStarting(false);
    }
  }, [daily, hasActiveDailyRun, navigate, starting]);

  const starAttemptDisabled = Boolean(
    starting ||
    daily.action ||
    !entriesOpen ||
    !runAvailable ||
    !daily.daily?.playerEligible ||
    (daily.daily && daily.daily.playerStars < daily.daily.starEntryCost),
  );
  const insufficientStars = Boolean(
    daily.daily && daily.daily.playerStars < daily.daily.starEntryCost,
  );

  if (challengeLoading || (daily.loading && !daily.daily)) {
    return (
      <div
        className="flex flex-col items-center justify-center py-16"
        style={{ color: colors.textMuted }}
      >
        <Loader2
          className="mb-4 h-8 w-8 animate-spin"
          style={{ color: colors.accent }}
        />
        <p className="font-sans text-sm font-medium">
          Loading today&apos;s arena...
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-[640px] flex-col gap-3">
      {!challenge ? (
        <EmptyState
          icon={<span className="text-4xl">📅</span>}
          title="No daily challenge yet"
          hint="Today's challenge is being opened by the keeper."
          titleColor={colors.text}
          hintColor={colors.textMuted}
        />
      ) : (
        <>
          {/* ── Today's rules capsule ── */}
          <div
            className="relative overflow-hidden rounded-2xl border-2"
            style={{
              borderColor: `${zoneColors.accent}35`,
              boxShadow: `0 4px 32px rgba(0,0,0,0.3), inset 0 1px 0 ${zoneColors.accent}15`,
            }}
          >
            <img
              src={zoneImages.background}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-black/85" />
            <div className="relative z-10 px-4 pb-3 pt-3">
              <div className="flex items-center gap-3">
                <img
                  src={getGuardianPortrait(zoneId)}
                  alt={guardian.name}
                  className="h-12 w-12 shrink-0 rounded-xl object-cover"
                  style={{
                    border: `2px solid ${zoneColors.accent}44`,
                    boxShadow: `0 0 16px ${zoneColors.accent}22`,
                  }}
                  draggable={false}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-display text-lg font-black text-white">
                      {guardian.name}
                    </span>
                    <span
                      className="rounded-full px-2 py-0.5 font-sans text-[9px] font-bold uppercase"
                      style={{
                        color: zoneColors.accent,
                        background: `${zoneColors.accent}18`,
                      }}
                    >
                      {zoneName}
                    </span>
                  </div>
                  <p className="mt-0.5 font-sans text-[11px] font-semibold text-white/50">
                    {challenge.total_attempts.toString()} attempt
                    {challenge.total_attempts !== 1n ? "s" : ""} today
                  </p>
                </div>
                {isActive ? (
                  <Countdown endTime={challenge.end_time} colors={zoneColors} />
                ) : (
                  <span className="shrink-0 rounded-full bg-red-500 px-3 py-1.5 font-sans text-xs font-bold text-white">
                    ENDED
                  </span>
                )}
              </div>

              {scoringRule && (
                <div className="mt-2.5 rounded-xl border border-cyan-300/20 bg-cyan-300/[0.08] px-3 py-2">
                  <p className="font-display text-sm font-black text-cyan-200">
                    {dailyScoringRuleName(scoringRule)}
                  </p>
                  <p className="mt-0.5 font-sans text-xs leading-relaxed text-white/65">
                    {dailyScoringRuleDescription(scoringRule)}
                  </p>
                </div>
              )}

              {(activeMutator || passiveMutator) && (
                <div className="mt-2 flex flex-col gap-1">
                  {[activeMutator, passiveMutator].map((mutator) =>
                    mutator && mutator.id !== 0 ? (
                      <p
                        key={mutator.id}
                        className="font-sans text-[13px] leading-relaxed text-white"
                      >
                        {mutator.icon}{" "}
                        <span
                          className="font-semibold"
                          style={{ color: zoneColors.accent }}
                        >
                          {mutator.name}
                        </span>{" "}
                        {mutator.description}
                      </p>
                    ) : null,
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── Enter / resume ── */}
          {hasActiveDailyRun ? (
            <ArcadeButton onClick={openRun} accentOverride={zoneColors.accent}>
              {activeDailyRun?.settled
                ? "Finish previous Daily"
                : "Resume Daily"}
            </ArcadeButton>
          ) : (
            daily.daily &&
            daily.daily.playerEligible &&
            runAvailable &&
            entriesOpen && (
              <div className="flex flex-col gap-1.5">
                <ArcadeButton
                  disabled={starAttemptDisabled}
                  onClick={() => void enter()}
                  accentOverride="#facc15"
                  className="text-[13px]"
                >
                  {starting
                    ? "Preparing..."
                    : `Enter Daily · ${daily.daily.starEntryCost.toString()}★`}
                </ArcadeButton>
                <div className="flex flex-col items-center gap-1.5">
                  {insufficientStars ? (
                    <button
                      type="button"
                      onClick={() => openShop("ranks")}
                      className="text-center font-sans text-xs font-extrabold text-yellow-200"
                    >
                      Need{" "}
                      {(
                        daily.daily.starEntryCost - daily.daily.playerStars
                      ).toString()}{" "}
                      more ★ · Get Stars
                    </button>
                  ) : (
                    <p className="text-center font-sans text-[11px] font-semibold text-white/50">
                      Unlimited retries · best score counts · +100 XP first
                      finish
                    </p>
                  )}
                  <InfoSheet title="How Daily scoring works">
                    <DailyScoringRules
                      objectiveWeight={
                        scoringRule
                          ? scoringRule.bonusMultiplierX100 / 100
                          : undefined
                      }
                    />
                  </InfoSheet>
                </div>
              </div>
            )
          )}

          {!daily.daily?.playerEligible && (
            <p className="rounded-xl border border-yellow-300/20 bg-yellow-950/50 px-3 py-2 text-center text-xs font-semibold text-yellow-200">
              Clear Zone 1 to unlock the Daily Arena.
            </p>
          )}

          {/* ── Today's board ── */}
          {boardLoading ? (
            <div
              className="flex flex-col items-center justify-center py-10"
              style={{ color: colors.textMuted }}
            >
              <Loader2
                className="mb-3 h-7 w-7 animate-spin"
                style={{ color: colors.accent }}
              />
              <p className="font-sans text-sm font-medium">
                Loading rankings...
              </p>
            </div>
          ) : rankRows.length === 0 ? (
            <EmptyState
              icon={<Trophy className="h-12 w-12" />}
              title="No entries yet"
              hint="Finish a run to claim rank #1."
              titleColor={colors.text}
              hintColor={colors.textMuted}
            />
          ) : (
            <motion.div
              initial="hidden"
              animate="visible"
              className="space-y-2"
            >
              {rankRows.map((entry, index) => {
                const baseBg =
                  entry.rank === 1
                    ? "rgba(255,215,0,0.2)"
                    : entry.rank === 2
                      ? "rgba(192,192,192,0.18)"
                      : entry.rank === 3
                        ? "rgba(205,127,50,0.18)"
                        : "rgba(255,255,255,0.1)";
                const pulseBright =
                  entry.rank === 1
                    ? "rgba(255,215,0,0.32)"
                    : entry.rank === 2
                      ? "rgba(192,192,192,0.28)"
                      : entry.rank === 3
                        ? "rgba(205,127,50,0.28)"
                        : `${colors.accent}40`;
                const pulseBase =
                  entry.rank <= 3 ? baseBg : `${colors.accent}20`;

                return (
                  <motion.div
                    custom={index}
                    variants={rowVariants}
                    key={entry.id}
                    onClick={() => watch(entry.playerAddress, entry.runId)}
                    className={`flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 backdrop-blur-xl transition-all active:scale-[0.98] ${entry.isYou ? "leaderboard-pulse" : ""}`}
                    style={{
                      ...(entry.isYou
                        ? ({
                            "--pulse-base": pulseBase,
                            "--pulse-bright": pulseBright,
                          } as React.CSSProperties)
                        : { backgroundColor: baseBg }),
                      borderColor: entry.isYou
                        ? `${colors.accent}AA`
                        : entry.rank <= 3
                          ? "rgba(255,255,255,0.3)"
                          : "rgba(255,255,255,0.14)",
                    }}
                  >
                    <div
                      className="flex w-8 items-center justify-center text-center font-sans text-base font-black"
                      style={{
                        color:
                          entry.rank <= 3 ? colors.accent2 : colors.textMuted,
                      }}
                    >
                      {entry.rank <= 3 ? (
                        <img
                          src={TROPHY_IMAGES[entry.rank]}
                          alt={`Rank ${entry.rank}`}
                          className="h-6 w-6"
                          draggable={false}
                        />
                      ) : (
                        entry.rank
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <p
                        className="truncate font-sans text-sm font-extrabold"
                        style={{
                          color: entry.isYou ? colors.accent : colors.text,
                        }}
                      >
                        {entry.isYou ? `You · ${entry.name}` : entry.name}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <div
                        className="font-sans text-[16px] font-extrabold tracking-wide"
                        style={{ color: colors.text }}
                      >
                        {entry.score.toLocaleString()} daily
                      </div>
                      <span className="font-sans text-[10px] text-white/40">
                        +
                        {Math.max(
                          0,
                          entry.score - entry.engineScore,
                        ).toLocaleString()}{" "}
                        challenge · {entry.engineScore.toLocaleString()} engine
                        · {entry.dailyBonusTriggers} bonus triggers ·{" "}
                        {entry.moves} moves
                      </span>
                      <Eye size={15} style={{ color: colors.textMuted }} />
                    </div>
                  </motion.div>
                );
              })}

              {visiblePlayerRank && !isMyRankVisible && (
                <>
                  <div className="py-1 text-center font-sans text-[10px] text-white/30">
                    ···
                  </div>
                  <motion.div
                    custom={rankRows.length}
                    variants={rowVariants}
                    className="leaderboard-pulse flex items-center gap-3 rounded-2xl border px-4 py-3 backdrop-blur-xl"
                    style={
                      {
                        "--pulse-base": `${colors.accent}20`,
                        "--pulse-bright": `${colors.accent}40`,
                        borderColor: `${colors.accent}AA`,
                      } as React.CSSProperties
                    }
                  >
                    <div
                      className="flex w-8 items-center justify-center text-center font-sans text-base font-black"
                      style={{ color: colors.accent }}
                    >
                      {visiblePlayerRank.rank}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p
                        className="truncate font-sans text-sm font-extrabold"
                        style={{ color: colors.accent }}
                      >
                        {visiblePlayerRank.name}
                      </p>
                    </div>
                    <div
                      className="font-sans text-[16px] font-extrabold tracking-wide"
                      style={{ color: colors.text }}
                    >
                      {visiblePlayerRank.score.toLocaleString()} pts
                    </div>
                  </motion.div>
                </>
              )}

              {!visiblePlayerRank && rankRows.length > 0 && (
                <div className="mt-2 rounded-2xl border border-white/[0.10] bg-white/[0.04] px-4 py-3 text-center">
                  <p className="font-sans text-xs font-semibold text-white/50">
                    You&apos;re not ranked yet. Finish a run to appear here!
                  </p>
                </div>
              )}
            </motion.div>
          )}
        </>
      )}

      {/* ── Yesterday ── */}
      {previous.daily?.player && (
        <DailyResultCard
          daily={previous.daily}
          position={previousPosition}
          label="Yesterday"
          action={previous.action}
          onRefund={() => void previous.refund().catch(() => undefined)}
        />
      )}

      {(daily.error || previous.error) && (
        <p role="alert" className="text-center font-sans text-xs text-red-300">
          {daily.error ?? previous.error}
        </p>
      )}
    </div>
  );
};

export default ArenaDailyTab;
