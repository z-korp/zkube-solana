import { Fragment, useCallback, useMemo, useState } from "react";
import { ChevronDown, Eye, Trophy } from "lucide-react";
import { motion } from "motion/react";

import {
  dailyScoringRuleDescription,
  dailyScoringRuleName,
} from "@/chain/dailyRules";
import { getGuardianPortrait, getZoneGuardian } from "@/config/bossCharacters";
import { getMutatorDef } from "@/config/mutatorConfig";
import { ZONE_NAMES } from "@/config/profileData";
import { getThemeColors, getThemeId, getThemeImages } from "@/config/themes";
import { useDaily } from "@/contexts/daily";
import useAccount from "@/hooks/useAccount";
import { useActiveDailyAttempt } from "@/hooks/useActiveDailyAttempt";
import { useCurrentChallenge } from "@/hooks/useCurrentChallenge";
import { useDailyLeaderboard } from "@/hooks/useDailyLeaderboard";
import { usePlayerEntry } from "@/hooks/usePlayerEntry";
import { useNavigationStore } from "@/stores/navigationStore";
import BoardPotHeader from "@/ui/components/arena/BoardPotHeader";
import { Countdown } from "@/ui/components/arena/Countdown";
import { DailyScoringRules } from "@/ui/components/arena/dailyRulesCopy";
import { PaidCutLine } from "@/ui/components/arena/LeaderboardRow";
import { TROPHY_IMAGES } from "@/ui/components/arena/leaderboardMedals";
import { playerLabelWithWallet } from "@/ui/components/arena/leaderboardName";
import { useLeaderboardEmblems } from "@/ui/components/arena/useLeaderboardEmblems";
import {
  DAILY_WEIGHTS,
  EmblemBadge,
  MONEY_GOLD,
  PrizeLadder,
  computePayouts,
} from "@/ui/components/economy";
import ArcadeButton from "@/ui/components/shared/ArcadeButton";
import EmptyState from "@/ui/components/shared/EmptyState";
import InfoSheet from "@/ui/components/shared/InfoSheet";
import LoadingState from "@/ui/components/shared/LoadingState";
import { useThemeColors } from "@/ui/elements/theme-provider/hooks";
import { formatSolLamports } from "@/utils/currency";
import { truncatePublicKey } from "@/utils/solanaDisplay";

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
const ArenaDailyTab: React.FC = () => {
  const colors = useThemeColors();
  const { address } = useAccount();
  const daily = useDaily();
  const activeDailyRun = useActiveDailyAttempt();
  const { challenge, isLoading: challengeLoading } = useCurrentChallenge();
  const { entries: dailyEntries, isLoading: boardLoading } =
    useDailyLeaderboard(challenge?.challenge_id);
  const { entry: playerEntry } = usePlayerEntry(
    challenge?.challenge_id,
    address,
  );
  const navigate = useNavigationStore((state) => state.navigate);
  const setSpectateTarget = useNavigationStore(
    (state) => state.setSpectateTarget,
  );
  const [starting, setStarting] = useState(false);
  const [expandedRank, setExpandedRank] = useState<number | null>(null);

  const now = Math.floor(Date.now() / 1000);
  const hasActiveDailyRun = Boolean(activeDailyRun);
  const isActive = Boolean(
    challenge &&
    !challenge.settled &&
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

  const rankRows = useMemo(
    () =>
      dailyEntries.slice(0, 30).map((entry) => ({
        id: `daily-${entry.rank}`,
        rank: entry.rank,
        name: playerLabelWithWallet(entry.playerName, entry.player),
        score: entry.dailyScore ?? entry.score,
        dailyBonusTriggers: entry.dailyBonusTriggers ?? 0,
        engineScore: entry.engineScore ?? entry.score,
        moves: entry.moves ?? 0,
        playerAddress: entry.player,
        runId: entry.runId,
        finalizedAttempts: entry.finalizedAttempts,
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
        name: `You · ${playerLabelWithWallet(ranked.playerName, address)}`,
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

  const boardOwners = useMemo(
    () => rankRows.map((row) => row.playerAddress),
    [rankRows],
  );
  const emblems = useLeaderboardEmblems(boardOwners);

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

  const entryDisabled = Boolean(
    starting ||
    daily.action ||
    !entriesOpen ||
    !runAvailable,
  );

  if (challengeLoading || (daily.loading && !daily.daily)) {
    return (
      <LoadingState
        className="py-16"
        spinnerClassName="mb-4 h-8 w-8"
        label="Loading today's arena..."
      />
    );
  }

  // Prize amounts are computed client-side from the guaranteed pot; the chain
  // never stores a per-row prize. Top 5 pay, renormalized over occupied places.
  const dailyPot =
    daily.daily && typeof daily.daily.dailyPotLamports === "bigint"
      ? daily.daily.dailyPotLamports
      : null;
  const dailyPayouts =
    dailyPot !== null
      ? computePayouts(dailyPot, DAILY_WEIGHTS, dailyEntries.length)
      : null;

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
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-display text-sm font-black text-cyan-200">
                      {dailyScoringRuleName(scoringRule)}
                    </p>
                    <InfoSheet
                      label="Rules & rewards"
                      title="Daily Arena"
                      className="shrink-0"
                    >
                      <p>
                        Unlimited retries — your best score counts. Each retry
                        is a separate exact 0.02 SOL entry.
                      </p>
                      <DailyScoringRules
                        objectiveWeight={
                          scoringRule.bonusMultiplierX100 / 100
                        }
                      />
                    </InfoSheet>
                  </div>
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
            runAvailable &&
            entriesOpen && (
              <div className="flex flex-col gap-1.5">
                <ArcadeButton
                  disabled={entryDisabled}
                  onClick={() => void enter()}
                  accentOverride="#facc15"
                  className="text-[13px]"
                >
                  {starting
                    ? "Preparing owner signature…"
                    : `Enter ranked · ${(Number(daily.daily.entryLamports) / 1_000_000_000).toFixed(2)} SOL`}
                </ArcadeButton>
                <p className="text-center font-sans text-[10px] font-semibold text-white/45">
                  Every attempt requires a separate connected-wallet signature.
                </p>
              </div>
            )
          )}

          {/* ── Today's pot ── */}
          {dailyPot !== null && daily.daily && (
            <BoardPotHeader
              label="Today's Daily pot"
              potLamports={dailyPot}
              followingLamports={daily.daily.followingDailyLamports}
              followingLabel="Building tomorrow's Daily"
            >
              <PrizeLadder
                potLamports={dailyPot}
                weights={DAILY_WEIGHTS}
                occupied={dailyEntries.length}
              />
              <p className="mt-2 font-sans text-[11px] leading-relaxed text-white/50">
                Top 5 share the guaranteed pot, floored to 0.001 SOL. Prizes are
                pushed automatically; dust rolls into tomorrow.
              </p>
            </BoardPotHeader>
          )}

          {/* ── Today's rankings ── */}
          {boardLoading ? (
            <LoadingState
              className="py-10"
              spinnerClassName="mb-3"
              label="Loading rankings..."
            />
          ) : rankRows.length === 0 ? (
            <EmptyState
              icon={<Trophy className="h-12 w-12" />}
              title="No entries yet"
              hint="Finish a run to take rank #1."
              titleColor={colors.text}
              hintColor={colors.textMuted}
            />
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between px-1 pt-1">
                <p
                  className="font-sans text-[11px] font-black uppercase tracking-[0.18em]"
                  style={{ color: colors.textMuted }}
                >
                  Today&apos;s rankings
                </p>
                <p
                  className="font-sans text-[11px] font-bold"
                  style={{ color: colors.textMuted }}
                >
                  {dailyEntries.length} player
                  {dailyEntries.length !== 1 ? "s" : ""}
                </p>
              </div>

              <motion.div
                initial="hidden"
                animate="visible"
                className="space-y-2"
              >
                {rankRows.map((entry, index) => {
                  const expanded = expandedRank === entry.rank;
                  const baseBg =
                    entry.rank === 1
                      ? "rgba(255,215,0,0.2)"
                      : entry.rank === 2
                        ? "rgba(192,192,192,0.18)"
                        : entry.rank === 3
                          ? "rgba(205,127,50,0.18)"
                          : "rgba(255,255,255,0.06)";
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
                  const challengeBonus = Math.max(
                    0,
                    entry.score - entry.engineScore,
                  );
                  const belowCut = entry.rank > DAILY_WEIGHTS.length;
                  const prize =
                    dailyPayouts && !belowCut
                      ? dailyPayouts[entry.rank - 1]
                      : null;
                  const showCut =
                    belowCut &&
                    (index === 0 ||
                      rankRows[index - 1].rank <= DAILY_WEIGHTS.length);
                  const emblem = emblems.get(entry.playerAddress);

                  return (
                    <Fragment key={entry.id}>
                      {showCut && <PaidCutLine />}
                    <motion.div
                      custom={index}
                      variants={rowVariants}
                      className={`overflow-hidden rounded-2xl border backdrop-blur-xl ${entry.isYou ? "leaderboard-pulse" : ""} ${belowCut ? "opacity-50" : ""}`}
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
                            ? "rgba(255,255,255,0.28)"
                            : "rgba(255,255,255,0.12)",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedRank(expanded ? null : entry.rank)
                        }
                        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-transform active:scale-[0.99]"
                      >
                        <div
                          className="flex w-7 shrink-0 items-center justify-center font-sans text-base font-black"
                          style={{
                            color:
                              entry.rank <= 3
                                ? colors.accent2
                                : colors.textMuted,
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

                        {emblem ? (
                          <EmblemBadge
                            emblemId={emblem.featuredEmblem}
                            totalStars={emblem.totalStars}
                            size={24}
                            className="shrink-0"
                          />
                        ) : (
                          <span className="h-6 w-6 shrink-0 rounded-lg border border-white/10 bg-white/[0.04]" />
                        )}

                        <p
                          className="min-w-0 flex-1 truncate font-sans text-sm font-extrabold"
                          style={{
                            color: entry.isYou ? colors.accent : colors.text,
                          }}
                        >
                          {entry.isYou ? `You · ${entry.name}` : entry.name}
                        </p>

                        <div className="flex shrink-0 flex-col items-end leading-tight">
                          <span
                            className="font-sans text-[17px] font-black tracking-wide tabular-nums"
                            style={{ color: colors.text }}
                          >
                            {entry.score.toLocaleString()}
                          </span>
                          {prize !== null && prize > 0n && (
                            <span
                              className="font-sans text-[11px] font-bold tabular-nums"
                              style={{ color: MONEY_GOLD }}
                            >
                              {formatSolLamports(prize)} SOL
                            </span>
                          )}
                        </div>
                        <ChevronDown
                          size={16}
                          className={`shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
                          style={{ color: colors.textMuted }}
                        />
                      </button>

                      {expanded && (
                        <div className="border-t border-white/10 px-4 py-2.5">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-sans text-[11px] font-semibold text-white/55">
                            <span>
                              {entry.engineScore.toLocaleString()} engine
                            </span>
                            <span>
                              +{challengeBonus.toLocaleString()} challenge
                            </span>
                            <span>{entry.dailyBonusTriggers} bonus</span>
                            <span>{entry.moves} moves</span>
                            <span>
                              {entry.finalizedAttempts} finalized attempt
                              {entry.finalizedAttempts !== 1 ? "s" : ""}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              watch(entry.playerAddress, entry.runId)
                            }
                            className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.06] px-3 py-1.5 font-sans text-xs font-bold text-white/80 transition-colors hover:bg-white/[0.1]"
                          >
                            <Eye size={14} /> Watch run
                          </button>
                        </div>
                      )}
                    </motion.div>
                    </Fragment>
                  );
                })}

                {visiblePlayerRank && !isMyRankVisible && (
                  <>
                    <div className="py-1 text-center font-sans text-[10px] text-white/30">
                      ···
                    </div>
                    <div
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
                        className="flex w-7 shrink-0 items-center justify-center font-sans text-base font-black"
                        style={{ color: colors.accent }}
                      >
                        {visiblePlayerRank.rank}
                      </div>
                      <p
                        className="min-w-0 flex-1 truncate font-sans text-sm font-extrabold"
                        style={{ color: colors.accent }}
                      >
                        {visiblePlayerRank.name}
                      </p>
                      <span
                        className="shrink-0 font-sans text-[17px] font-black tracking-wide tabular-nums"
                        style={{ color: colors.text }}
                      >
                        {visiblePlayerRank.score.toLocaleString()}
                      </span>
                    </div>
                  </>
                )}

                {!visiblePlayerRank && rankRows.length > 0 && (
                  <div className="mt-1 rounded-2xl border border-white/[0.10] bg-white/[0.04] px-4 py-3 text-center">
                    <p className="font-sans text-xs font-semibold text-white/50">
                      You&apos;re not ranked yet. Finish a run to appear here!
                    </p>
                  </div>
                )}
              </motion.div>
            </div>
          )}
        </>
      )}

      {daily.error && (
        <p role="alert" className="text-center font-sans text-xs text-red-300">
          {daily.error}
        </p>
      )}
    </div>
  );
};

export default ArenaDailyTab;
