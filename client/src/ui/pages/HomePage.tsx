import { useEffect, useState, type ReactNode } from "react";

import { useConnectedPlayer } from "@/chain/connectedPlayerContext";
import { getThemeId } from "@/config/themes";
import { useDaily } from "@/contexts/daily";
import useAccount from "@/hooks/useAccount";
import { useActiveDailyAttempt } from "@/hooks/useActiveDailyAttempt";
import { useDailyLeaderboard } from "@/hooks/useDailyLeaderboard";
import { useMyDailyRank } from "@/hooks/useMyDailyRank";
import { useNowTick } from "@/hooks/useNowTick";
import { useNavigationStore } from "@/stores/navigationStore";
import {
  DailyChallengeCard,
  EntriesCountdown,
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
 * + rule on painted art), the simplified Daily pot with the player's rank,
 * and one ranked CTA. The body reshapes across five
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
  const zoneId = view?.mapId ?? 1;

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

  const nowUnix = Math.floor(useNowTick(60_000) / 1_000);
  const lifecycle = computeArcadeLifecycle({
    view,
    hasActiveRun: activeDaily !== null,
    nowUnix,
  });

  const scoringRule = view?.scoringRule ?? null;
  const runsCloseLabel = view ? formatUtcClock(view.runsCloseAt) : "23:59 UTC";
  const entrySol = view ? formatSolLamports(view.entryLamports) : "0.01";
  const busy = daily.action !== null;
  const arcadeDiscoveryReady =
    daily.run.watchStatus?.phase === "subscribed";

  const enterRanked = async () => {
    const active = await daily.enter();
    navigate("play", active.runId);
  };
  // Confirmed from the coin sheet: success navigates away (the sheet unmounts);
  // a failure closes the sheet and surfaces the error banner on the home body.
  const confirmRanked = () =>
    void enterRanked().catch(() => setCoinSheetOpen(false));
  // Hero status line per lifecycle state.
  let meta: ReactNode;
  if (lifecycle === "resume") {
    meta = (
      <span className={META_CLASS}>
        {activeDaily?.mode === "practice"
          ? "Legacy Practice in progress"
          : `Run in progress · scores ${runsCloseLabel}`}
      </span>
    );
  } else if (lifecycle === "entries-open" && view) {
    meta = <EntriesCountdown endsAt={view.entriesCloseAt} />;
  } else if (lifecycle === "entries-closed") {
    meta = <span className={META_CLASS}>Entries closed</span>;
  } else if (lifecycle === "delayed") {
    meta = <span className={META_CLASS}>Today&apos;s Daily is running late</span>;
  } else if (lifecycle === "stale") {
    meta = <span className={META_CLASS}>Waiting for today&apos;s Daily</span>;
  } else {
    meta = <span className={META_CLASS}>Opens 00:00 UTC</span>;
  }

  // Primary CTA per state.
  let primaryLabel = `Enter ranked · ${entrySol} SOL`;
  let primaryDisabled = false;
  let primaryOnClick: () => void = () => {};

  if (lifecycle === "resume") {
    primaryLabel =
      activeDaily?.mode === "practice"
        ? "Resume legacy Practice"
        : "Resume ranked run";
    primaryOnClick = () => {
      if (activeDaily) navigate("play", activeDaily.gameId);
    };
  } else if (lifecycle === "entries-open") {
    if (!arcadeDiscoveryReady) {
      primaryLabel = "Checking active Arcade run…";
      primaryDisabled = true;
    } else if (view?.followingDailyLamports === null) {
      primaryLabel = "Ranked paused · next Daily preparing";
      primaryDisabled = true;
    } else {
      primaryLabel =
        daily.action === "enter:sol"
          ? "Preparing owner signature…"
          : `Enter ranked · ${entrySol} SOL`;
      primaryDisabled = busy || !player.wallet;
      // Tap the CTA → confirm sheet → owner signature → play.
      primaryOnClick = () => setCoinSheetOpen(true);
    }
  } else {
    // Nothing actionable: ranked closed, or the Daily is still being prepared.
    primaryLabel =
      lifecycle === "entries-closed"
        ? "Entries closed"
        : lifecycle === "delayed" || lifecycle === "stale"
          ? "Keeper catching up"
          : "Daily being prepared";
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

        {view && lifecycle !== "delayed" && lifecycle !== "stale" ? (
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
              {lifecycle === "delayed"
                ? "Today’s Daily is running late"
                : lifecycle === "stale"
                  ? "Yesterday’s Daily is still visible"
                  : "Daily being prepared"}
            </p>
            <p className="mt-1 font-sans text-xs font-semibold text-white/55">
              {lifecycle === "delayed" || lifecycle === "stale"
                ? "The keeper is catching up. Entries open as soon as today’s Daily is ready."
                : "Opens 00:00 UTC"}
            </p>
          </div>
        )}

        {daily.error && (
          <p
            role="alert"
            className="text-center text-xs font-semibold text-red-300"
          >
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
