import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, Loader2 } from "lucide-react";

import { getGuardianPortrait, getZoneGuardian } from "@/config/bossCharacters";
import { getMutatorDef } from "@/config/mutatorConfig";
import { ZONE_NAMES } from "@/config/profileData";
import { getThemeColors, getThemeId, getThemeImages } from "@/config/themes";
import { useDailyController } from "@/contexts/daily";
import useAccountCustom from "@/hooks/useAccountCustom";
import { useActiveDailyAttempt } from "@/hooks/useActiveDailyAttempt";
import { useCurrentChallenge } from "@/hooks/useCurrentChallenge";
import { useDailyLeaderboard } from "@/hooks/useDailyLeaderboard";
import { useNavigationStore } from "@/stores/navigationStore";
import TierContext from "@/ui/components/rewards/TierContext";
import ArcadeButton from "@/ui/components/shared/ArcadeButton";
import { useTheme } from "@/ui/elements/theme-provider/hooks";
import { truncatePublicKey } from "@/utils/solanaDisplay";

const CountdownText: React.FC<{ endTime: number }> = ({ endTime }) => {
  const [sec, setSec] = useState(() =>
    Math.max(0, endTime - Math.floor(Date.now() / 1000)),
  );

  useEffect(() => {
    const id = window.setInterval(() => {
      setSec(Math.max(0, endTime - Math.floor(Date.now() / 1000)));
    }, 1000);
    return () => window.clearInterval(id);
  }, [endTime]);

  const h = Math.floor(sec / 3600)
    .toString()
    .padStart(2, "0");
  const m = Math.floor((sec % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const s = (sec % 60).toString().padStart(2, "0");

  return <>{sec > 0 ? `${h}:${m}:${s}` : "ENDED"}</>;
};

const DailyChallengePage: React.FC = () => {
  const { account } = useAccountCustom();
  const { themeTemplate } = useTheme();
  const colors = getThemeColors(themeTemplate);
  const navigate = useNavigationStore((state) => state.navigate);
  const goBack = useNavigationStore((state) => state.goBack);
  const daily = useDailyController();
  const activeDailyRun = useActiveDailyAttempt();

  const { challenge, isLoading: challengeLoading } = useCurrentChallenge();
  const { entries: leaderboard } = useDailyLeaderboard(challenge?.challenge_id);
  const [starting, setStarting] = useState<"stars" | "usdc" | null>(null);

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

  const activeMutator = challenge?.active_mutator_id
    ? getMutatorDef(challenge.active_mutator_id)
    : null;
  const passiveMutator = challenge?.passive_mutator_id
    ? getMutatorDef(challenge.passive_mutator_id)
    : null;

  const playerRank = useMemo(() => {
    if (!leaderboard.length) return null;
    return (
      leaderboard.find((entry) => entry.player === account.address) ?? null
    );
  }, [account.address, leaderboard]);

  const openRun = useCallback(() => {
    if (!activeDailyRun) return;
    navigate("play", activeDailyRun.gameId);
  }, [activeDailyRun, navigate]);

  const enter = useCallback(
    async (payment: "stars" | "usdc") => {
      if (starting || hasActiveDailyRun) return;
      setStarting(payment);
      try {
        const run = await daily.enter(payment);
        navigate("play", run.runId);
      } catch {
        // The shared controller projects transaction failures into daily.error.
      } finally {
        setStarting(null);
      }
    },
    [daily, hasActiveDailyRun, navigate, starting],
  );

  const starAttemptDisabled = Boolean(
    starting ||
    daily.action ||
    !entriesOpen ||
    !runAvailable ||
    !daily.daily?.playerEligible ||
    daily.daily?.player?.freeAttemptUsed ||
    (daily.daily && daily.daily.playerStars < daily.daily.starEntryCost),
  );
  const usdcAttemptDisabled = Boolean(
    starting ||
    daily.action ||
    !entriesOpen ||
    !runAvailable ||
    !daily.daily?.playerEligible,
  );

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden pb-[100px] pt-12">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(5,10,18,0.12)_0%,rgba(5,10,18,0.05)_45%,rgba(5,10,18,0.56)_100%)]" />

      <div className="relative z-10 flex min-h-10 items-center justify-center px-6 pb-2">
        <div className="absolute left-6 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center">
          <button
            type="button"
            onClick={goBack}
            aria-label="Back"
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] shadow-lg backdrop-blur-md transition-all hover:bg-white/[0.08] active:scale-95"
          >
            <ChevronLeft size={20} className="text-white/80" />
          </button>
        </div>
        <h1 className="text-center font-display text-2xl font-bold tracking-wide text-white drop-shadow-[0_4px_12px_rgba(0,0,0,0.6)]">
          Daily Challenge
        </h1>
      </div>

      <div className="relative z-10 mx-4 mt-4 flex min-h-0 flex-1 flex-col overflow-y-auto pb-3 hide-scrollbar">
        <div className="mx-auto flex w-full max-w-[640px] flex-col gap-4">
          {challengeLoading && (
            <div className="flex flex-1 items-center justify-center py-16">
              <Loader2
                size={28}
                className="animate-spin"
                style={{ color: colors.accent }}
              />
            </div>
          )}

          {!challengeLoading && !challenge && (
            <div className="relative overflow-hidden rounded-2xl border border-white/[0.12] bg-white/[0.06] p-6 text-center backdrop-blur-xl">
              <img
                src={getGuardianPortrait(zoneId)}
                alt={guardian.name}
                className="mx-auto mb-3 h-24 w-24 rounded-2xl object-cover"
                style={{
                  border: `2px solid ${zoneColors.accent}44`,
                  boxShadow: `0 0 20px ${zoneColors.accent}22`,
                }}
                draggable={false}
              />
              <p className="font-display text-xl font-black text-white">
                {guardian.name}
              </p>
              <p
                className="font-sans text-[11px] font-semibold"
                style={{ color: zoneColors.accent }}
              >
                {guardian.title}
              </p>
              <p className="mt-2 font-sans text-sm text-white/60">
                Today&apos;s challenge has not been published yet.
              </p>
            </div>
          )}

          {challenge && (
            <>
              {/* Guardian panel — portrait, greeting, mutators, countdown */}
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
                <div className="relative z-10 px-4 pb-4 pt-3">
                  {/* Header — portrait + name + countdown */}
                  <div className="flex items-center gap-3">
                    <img
                      src={getGuardianPortrait(zoneId)}
                      alt={guardian.name}
                      className="h-14 w-14 shrink-0 rounded-xl object-cover"
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
                          {guardian.title}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-2">
                        <p className="font-sans text-[11px] font-semibold text-white/50">
                          {zoneName} · {challenge.total_entries.toString()}{" "}
                          player
                          {challenge.total_entries !== 1n ? "s" : ""}
                        </p>
                      </div>
                    </div>
                    {isActive ? (
                      <span
                        className="shrink-0 rounded-full px-3 py-1.5 font-sans text-xs font-bold tabular-nums text-white"
                        style={{ background: zoneColors.accent }}
                      >
                        <CountdownText endTime={challenge.end_time} />
                      </span>
                    ) : (
                      <span className="shrink-0 rounded-full bg-red-500 px-3 py-1.5 font-sans text-xs font-bold text-white">
                        ENDED
                      </span>
                    )}
                  </div>

                  {/* Greeting */}
                  <p className="mt-2.5 font-sans text-[14px] italic text-white/60">
                    &ldquo;{guardian.dailyGreeting}&rdquo;
                  </p>

                  {/* Mutators */}
                  {(activeMutator || passiveMutator) && (
                    <div className="mt-2.5 flex flex-col gap-1.5">
                      {activeMutator && activeMutator.id !== 0 && (
                        <p className="font-sans text-[14px] leading-relaxed text-white">
                          {activeMutator.icon}{" "}
                          <span
                            className="font-semibold"
                            style={{ color: zoneColors.accent }}
                          >
                            {activeMutator.name}
                          </span>{" "}
                          {activeMutator.description}
                        </p>
                      )}
                      {passiveMutator && passiveMutator.id !== 0 && (
                        <p className="font-sans text-[14px] leading-relaxed text-white">
                          {passiveMutator.icon}{" "}
                          <span
                            className="font-semibold"
                            style={{ color: zoneColors.accent }}
                          >
                            {passiveMutator.name}
                          </span>{" "}
                          {passiveMutator.description}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Your Position — score-based Solana daily ranking */}
              {playerRank && (
                <TierContext
                  colors={zoneColors}
                  myRank={playerRank.rank}
                  myScore={playerRank.score}
                  myName={`You · ${truncatePublicKey(playerRank.player)}`}
                  totalEntries={leaderboard.length}
                  entries={leaderboard.map((entry) => ({
                    rank: entry.rank,
                    score: entry.score,
                    name: truncatePublicKey(entry.player),
                  }))}
                  scoreLabel=" pts"
                />
              )}

              {!daily.daily?.playerEligible && (
                <p className="rounded-xl border border-yellow-300/20 bg-yellow-950/50 px-3 py-2 text-center text-xs font-semibold text-yellow-200">
                  Clear Campaign Map 1 to unlock the Daily Challenge.
                </p>
              )}
              {daily.error && (
                <p className="rounded-xl border border-red-300/20 bg-red-950/50 px-3 py-2 text-center text-xs text-red-200">
                  {daily.error}
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {/* Resume or choose the on-chain Daily entry payment. */}
      {!challengeLoading && hasActiveDailyRun && (
        <div className="relative z-20 mt-auto px-4 pb-3">
          <ArcadeButton onClick={openRun} accentOverride={zoneColors.accent}>
            {activeDailyRun?.settled ? "Finish previous Daily" : "Resume Daily"}
          </ArcadeButton>
        </div>
      )}
      {!challengeLoading &&
        challenge &&
        daily.daily &&
        !hasActiveDailyRun &&
        runAvailable &&
        entriesOpen && (
          <div className="relative z-20 mt-auto grid grid-cols-2 gap-3 px-4 pb-3">
            <ArcadeButton
              disabled={starAttemptDisabled}
              onClick={() => void enter("stars")}
              accentOverride="#facc15"
              className="text-[13px]"
            >
              {starting === "stars"
                ? "Preparing..."
                : `${daily.daily.starEntryCost.toString()} Stars`}
            </ArcadeButton>
            <ArcadeButton
              disabled={usdcAttemptDisabled}
              onClick={() => void enter("usdc")}
              accentOverride={zoneColors.accent}
              className="text-[13px]"
            >
              {starting === "usdc"
                ? "Preparing..."
                : `${formatUsdc(daily.daily.entryPrice)} USDC`}
            </ArcadeButton>
          </div>
        )}
    </div>
  );
};

function formatUsdc(amount: bigint): string {
  const whole = amount / 1_000_000n;
  const fraction = (amount % 1_000_000n)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export default DailyChallengePage;
