import { useEffect, useState, type ReactNode } from "react";

import { useConnectedPlayer } from "@/chain/connectedPlayerContext";
import { getThemeId } from "@/config/themes";
import { useDaily } from "@/contexts/daily";
import useAccount from "@/hooks/useAccount";
import { useActiveDailyAttempt } from "@/hooks/useActiveDailyAttempt";
import { useDailyLeaderboard } from "@/hooks/useDailyLeaderboard";
import { useMyDailyRank } from "@/hooks/useMyDailyRank";
import { useNavigationStore } from "@/stores/navigationStore";
import {
  DailyChallengeCard,
  EntriesCountdown,
  PracticeChip,
  computeArcadeLifecycle,
  formatUtcClock,
} from "@/ui/components/arcade";
import { DailyPot } from "@/ui/components/economy";
import {
  GuardianPrizeResult,
  InsertCoinSheet,
  usePrizeDeltaTrigger,
} from "@/ui/components/settlement";
import ArcadeButton from "@/ui/components/shared/ArcadeButton";
import PageHeader from "@/ui/components/shared/PageHeader";
import ZoneBackdrop from "@/ui/components/shared/ZoneBackdrop";
import { useTheme } from "@/ui/elements/theme-provider/hooks";
import { formatSolLamports } from "@/utils/currency";

const META_CLASS =
  "font-sans text-xs font-semibold uppercase tracking-[0.14em] text-white/60";

/**
 * Arcade home — the Guardian's Trial. Today's zone art shows through a shared
 * ZoneBackdrop, with glass panels layered over it: the challenge card (guardian
 * + rule on painted art), the simplified Daily pot with the player's rank, a
 * free Practice chip, and one ranked CTA. The body reshapes across five
 * lifecycle states (the connect-gate is handled globally by App).
 */
const HomePage: React.FC = () => {
  const navigate = useNavigationStore((state) => state.navigate);
  const player = useConnectedPlayer();
  const { address } = useAccount();
  const daily = useDaily();
  const activeDaily = useActiveDailyAttempt();
  const { setThemeTemplate } = useTheme();

  // The ranked-entry confirm ("insert coin") sits before the owner signature.
  const [coinSheetOpen, setCoinSheetOpen] = useState(false);
  // Data-available celebration for a grown per-period reward record.
  const { prize, dismiss: dismissPrize } = usePrizeDeltaTrigger();

  const view = daily.daily;
  const practiceView = daily.practiceDaily;
  // Today's zone drives the guardian, the surface accent, and the background;
  // fall back to yesterday's Practice zone while today's Daily is unprepared.
  const zoneId = view?.mapId ?? practiceView?.mapId ?? 1;

  // Tint the whole app surface with today's zone accent (never persisted).
  useEffect(() => {
    setThemeTemplate(getThemeId(zoneId), false);
  }, [zoneId, setThemeTemplate]);

  // The player's standing in today's Daily — highlights their prize rung.
  const { entries } = useDailyLeaderboard(view?.dayId);
  const myRank = useMyDailyRank({
    entries,
    address,
    potLamports: view?.dailyPotLamports ?? null,
  });

  const nowUnix = Math.floor(Date.now() / 1_000);
  const lifecycle = computeArcadeLifecycle({
    view,
    hasActiveRun: activeDaily !== null,
    nowUnix,
  });

  const scoringRule = view?.scoringRule ?? practiceView?.scoringRule ?? null;
  const runsCloseLabel = view ? formatUtcClock(view.runsCloseAt) : "23:30 UTC";
  const entrySol = view ? formatSolLamports(view.entryLamports) : "0.02";
  const busy = daily.action !== null;
  const preparingPractice = daily.action === "practice";

  const enterRanked = async () => {
    const active = await daily.enter();
    navigate("play", active.runId);
  };
  // Confirmed from the coin sheet: success navigates away (the sheet unmounts);
  // a failure closes the sheet and surfaces the error banner on the home body.
  const confirmRanked = () =>
    void enterRanked().catch(() => setCoinSheetOpen(false));
  const enterPractice = async () => {
    const active = await daily.practice();
    navigate("play", active.runId);
  };
  const startPractice = () => void enterPractice().catch(() => undefined);

  // Hero status line per lifecycle state.
  let meta: ReactNode;
  if (lifecycle === "resume") {
    meta = (
      <span className={META_CLASS}>Run in progress · scores {runsCloseLabel}</span>
    );
  } else if (lifecycle === "entries-open" && view) {
    meta = <EntriesCountdown endsAt={view.entriesCloseAt} />;
  } else if (lifecycle === "entries-closed") {
    meta = <span className={META_CLASS}>Entries closed</span>;
  } else {
    meta = <span className={META_CLASS}>New Daily opens 00:00 UTC</span>;
  }

  // Primary CTA + secondary Practice chip per state.
  let primaryLabel = `Enter ranked · ${entrySol} SOL`;
  let primaryDisabled = false;
  let primaryOnClick: () => void = () => {};
  let showPracticeChip = false;

  if (lifecycle === "resume") {
    primaryLabel = "Resume ranked run";
    primaryOnClick = () => {
      if (activeDaily) navigate("play", activeDaily.gameId);
    };
  } else if (lifecycle === "entries-open") {
    primaryLabel =
      daily.action === "enter:sol"
        ? "Preparing owner signature…"
        : `Enter ranked · ${entrySol} SOL`;
    primaryDisabled = busy || !player.wallet;
    // Tap the CTA → confirm sheet → owner signature → play.
    primaryOnClick = () => setCoinSheetOpen(true);
    showPracticeChip = daily.practiceAvailable;
  } else if (daily.practiceAvailable) {
    // entries-closed or practice-only with Practice enterable → Practice leads.
    primaryLabel = preparingPractice ? "Preparing…" : "Play free practice";
    primaryDisabled = busy;
    primaryOnClick = startPractice;
  } else {
    // Nothing actionable: ranked closed, or the Daily is still being prepared.
    primaryLabel =
      lifecycle === "entries-closed" ? "Entries closed" : "Daily being prepared";
    primaryDisabled = true;
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden pb-[100px] pt-10">
      <ZoneBackdrop zoneId={zoneId} />

      <div className="relative z-10">
        <PageHeader title="Arcade" />
      </div>

      <div className="relative z-10 mx-4 min-h-0 flex-1 space-y-3 overflow-y-auto pb-4 hide-scrollbar">
        <DailyChallengeCard
          zoneId={zoneId}
          scoringRule={scoringRule}
          status={meta}
        />

        {view ? (
          <>
            {lifecycle === "entries-closed" && (
              <div className="rounded-2xl border border-yellow-400/30 bg-yellow-400/[0.08] px-3 py-2 backdrop-blur-xl">
                <p className="font-sans text-[11px] font-bold uppercase tracking-[0.12em] text-yellow-200">
                  Settling
                </p>
                <p className="mt-0.5 font-sans text-xs font-semibold text-white/60">
                  Runs score {runsCloseLabel} · prizes push automatically
                </p>
              </div>
            )}
            <DailyPot
              potLamports={view.dailyPotLamports}
              followingDailyLamports={view.followingDailyLamports}
              entryLamports={view.entryLamports}
              myRank={myRank}
            />
          </>
        ) : (
          <div className="rounded-3xl border border-white/[0.1] bg-black/30 p-5 backdrop-blur-xl">
            <p className="font-sans text-[11px] font-bold uppercase tracking-[0.12em] text-white/45">
              Today&apos;s pot
            </p>
            <p className="mt-2 font-display text-lg font-black text-white">
              Daily being prepared
            </p>
            <p className="mt-1 font-sans text-xs font-semibold text-white/55">
              Opens 00:00 UTC
            </p>
          </div>
        )}

        {showPracticeChip && (
          <PracticeChip
            onClick={startPractice}
            busy={preparingPractice}
            disabled={busy && !preparingPractice}
          />
        )}

        {daily.error && (
          <p role="alert" className="text-center text-xs font-semibold text-red-300">
            {daily.error}
          </p>
        )}
      </div>

      <div className="relative z-20 px-4 pb-3">
        <ArcadeButton disabled={primaryDisabled} onClick={primaryOnClick}>
          {primaryLabel}
        </ArcadeButton>
      </div>

      {view && (
        <InsertCoinSheet
          open={coinSheetOpen}
          onClose={() => setCoinSheetOpen(false)}
          entryLamports={view.entryLamports}
          onConfirm={confirmRanked}
          busy={daily.action === "enter:sol"}
        />
      )}

      {prize && (
        <GuardianPrizeResult
          open
          onDismiss={dismissPrize}
          zoneId={zoneId}
          amountLamports={prize.amountLamports}
          periodLabel={prize.periodLabel}
          bestPrizeRank={prize.bestPrizeRank}
        />
      )}
    </div>
  );
};

export default HomePage;
