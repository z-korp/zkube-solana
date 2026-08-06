import { useEffect, useState } from "react";
import { Timer, Users } from "lucide-react";

import { useConnectedPlayer } from "@/chain/connectedPlayerContext";
import { getThemeId } from "@/config/themes";
import { dailyScoringRuleName } from "@/chain/dailyRules";
import { useDaily } from "@/contexts/daily";
import { DEV_BYPASS_ACTIVE } from "@/dev/devBypass";
import useAccount from "@/hooks/useAccount";
import { useActiveDailyAttempt } from "@/hooks/useActiveDailyAttempt";
import { useCountdown, useNowTick } from "@/hooks/useNowTick";
import { useNavigationStore } from "@/stores/navigationStore";
import {
  DailyStatusPanel,
  computeArcadeLifecycle,
  formatUtcClock,
} from "@/ui/components/arcade";
import EnterCoinKey from "@/ui/components/arcade/EnterCoinKey";
import InfoTip from "@/ui/components/shared/InfoTip";
import {
  GuardianFaceBlock,
  MONEY_GOLD,
  SolMark,
} from "@/ui/components/economy";
import {
  GuardianPrizeResult,
  InsertCoinSheet,
  usePrizeDeltaTrigger,
} from "@/ui/components/settlement";
import DailyBoard from "@/ui/components/arcade/DailyBoard";
import SeasonTab from "@/ui/components/arena/SeasonTab";
import WeeklyTab from "@/ui/components/arena/WeeklyTab";
import SegmentedTabs from "@/ui/components/shared/SegmentedTabs";
import ZoneBackdrop from "@/ui/components/shared/ZoneBackdrop";
import { useTheme } from "@/ui/elements/theme-provider/hooks";
import { formatSolBalanceLamports } from "@/utils/currency";
import { formatCountdown } from "@/utils/time";

/** Opaque block furniture — same recipe as every menu panel. */
const PANEL_STYLE: React.CSSProperties = {
  background: "linear-gradient(180deg, #131F35 0%, #0D1626 100%)",
  border: "1px solid rgba(255,255,255,0.10)",
  boxShadow:
    "0 12px 30px rgba(0,0,0,0.4), inset 0 1.5px 0 rgba(255,255,255,0.09)",
};
const SECTION_CLASS =
  "font-sans text-[10px] font-bold uppercase tracking-[0.22em] text-white/45";
const CHIP_CLASS =
  "flex items-center justify-center gap-1.5 rounded-full border border-white/[0.08] bg-black/40 px-2.5 py-1.5 font-mono text-[11px] font-bold tabular-nums text-white";

const BOARDS = ["Daily", "Weekly", "Season"] as const;

/**
 * The Arcade — pot and boards on one scroll. Today's zone art shows through a
 * shared ZoneBackdrop, with opaque block panels layered over it: the challenge card
 * (guardian + rule), the Daily pot with the player's rank, then the Daily /
 * Weekly / Season boards inline behind one segmented switch. The ranked entry
 * CTA stays pinned at the bottom on every board — the board is the sales
 * floor. The body reshapes across five lifecycle states (the connect-gate is
 * handled globally by App).
 */
const ArcadePage: React.FC = () => {
  const navigate = useNavigationStore((state) => state.navigate);
  const player = useConnectedPlayer();
  const { address } = useAccount();
  const daily = useDaily();
  const activeDaily = useActiveDailyAttempt();
  const { setThemeTemplate } = useTheme();

  // The ranked-entry confirm ("insert coin") sits before the owner signature.
  const [coinSheetOpen, setCoinSheetOpen] = useState(false);
  // DEV-ONLY sheet preview (?demo=coin with the wallet bypass) — the coin
  // sheet lives here, so its fixture preview does too. Folds away in prod.
  useEffect(() => {
    if (
      import.meta.env.DEV &&
      DEV_BYPASS_ACTIVE &&
      new URLSearchParams(window.location.search).get("demo") === "coin"
    ) {
      setCoinSheetOpen(true);
    }
  }, []);
  // Which board shows under the pot — the boards share the page's one scroll.
  const [activeBoard, setActiveBoard] =
    useState<(typeof BOARDS)[number]>("Daily");
  // Data-available celebration for a grown per-period reward record.
  const { prize, dismiss: dismissPrize } = usePrizeDeltaTrigger();

  const view = daily.daily;
  const zoneId = view?.mapId ?? 1;

  // Tint the whole app surface with today's zone accent (never persisted).
  useEffect(() => {
    setThemeTemplate(getThemeId(zoneId), false);
  }, [zoneId, setThemeTemplate]);

  const nowUnix = Math.floor(useNowTick(60_000) / 1_000);
  const lifecycle = computeArcadeLifecycle({
    view,
    hasActiveRun: activeDaily !== null,
    nowUnix,
  });

  const scoringRule = view?.scoringRule ?? null;
  const runsCloseLabel = view ? formatUtcClock(view.runsCloseAt) : "23:59 UTC";
  const entrySol = view ? formatSolBalanceLamports(view.entryLamports) : "0.010";
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
  const entrySeconds = useCountdown(view?.entriesCloseAt);

  // The pinned key: one verb per lifecycle; only "Enter" carries the coin.
  let primaryLabel = "Enter";
  let primaryAmount: string | null = entrySol;
  let primaryDisabled = false;
  let primaryOnClick: () => void = () => {};

  if (lifecycle === "resume") {
    primaryLabel =
      activeDaily?.mode === "practice" ? "Resume Practice" : "Resume run";
    primaryAmount = null;
    primaryOnClick = () => {
      if (activeDaily) navigate("play", activeDaily.gameId);
    };
  } else if (lifecycle === "entries-open") {
    if (!arcadeDiscoveryReady) {
      primaryLabel = "Checking run…";
      primaryAmount = null;
      primaryDisabled = true;
    } else if (view?.followingDailyLamports === null) {
      primaryLabel = "Ranked paused";
      primaryAmount = null;
      primaryDisabled = true;
    } else if (daily.action === "enter:sol") {
      primaryLabel = "Preparing signature…";
      primaryAmount = null;
      primaryDisabled = true;
    } else {
      primaryDisabled = busy || !player.wallet;
      // Tap the key → confirm sheet → owner signature → play.
      primaryOnClick = () => setCoinSheetOpen(true);
    }
  } else {
    primaryLabel =
      lifecycle === "entries-closed"
        ? "Entries closed"
        : lifecycle === "delayed" || lifecycle === "stale"
          ? "Keeper catching up"
          : "Daily being prepared";
    primaryAmount = null;
    primaryDisabled = true;
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden pb-[100px] pt-7">
      <ZoneBackdrop zoneId={zoneId} />

      {/* The crown title, like every tab page. */}
      <h1
        className="relative z-10 text-center font-display text-[46px] leading-none"
        style={{ color: "#FFF4D7", textShadow: "0 4px 20px rgba(0,0,0,0.7)" }}
      >
        Arcade
      </h1>

      {/* The period switch owns the top — Daily / Weekly / Season. */}
      <div className="relative z-10 mx-4 mt-3">
        <SegmentedTabs
          tabs={BOARDS}
          active={activeBoard}
          onChange={setActiveBoard}
          layoutId="arcade-board-indicator"
        />
      </div>

      <div className="relative z-10 mx-4 mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto pb-4 hide-scrollbar">
        {activeBoard === "Daily" && (
          <>
            {view && lifecycle !== "delayed" && lifecycle !== "stale" ? (
              <>
                {/* The floor header: chips, not sentences. */}
                <section className="rounded-2xl p-3.5" style={PANEL_STYLE}>
                  <div className="flex items-center gap-2.5">
                    <GuardianFaceBlock zoneId={zoneId} size={44} />
                    <div className="flex min-w-0 flex-1 items-center gap-1.5">
                      <span
                        className="money flex-none font-display text-[32px] leading-none tabular-nums"
                        style={{ color: MONEY_GOLD }}
                      >
                        {formatSolBalanceLamports(view.dailyPotLamports)}
                      </span>
                      <SolMark size={15} />
                      <span className="ml-1 truncate font-sans text-[9px] font-bold uppercase tracking-[0.2em] text-white/40">
                        daily pot
                      </span>
                    </div>
                    <span className={CHIP_CLASS}>
                      <Timer size={12} className="text-white/50" />
                      {entrySeconds > 0
                        ? formatCountdown(entrySeconds)
                        : "Closed"}
                    </span>
                    <InfoTip label="Daily rules">
                      Top 5 split the pot 45 / 25 / 15 / 10 / 5%, floored to
                      0.001 SOL. Pts is the Season points each rank earns
                      today — your best 20 dailies count toward the Season.
                    </InfoTip>
                  </div>
                  <div className="mt-2.5 flex gap-1.5">
                    <span className={`${CHIP_CLASS} flex-1`}>
                      <Users size={12} className="text-white/50" />
                      {view.uniquePlayers}
                    </span>
                    <span className={`${CHIP_CLASS} flex-1`}>
                      {entrySol}
                      <SolMark size={10} />
                      entry
                    </span>
                    {scoringRule && (
                      <span className={`${CHIP_CLASS} flex-1 truncate`}>
                        {dailyScoringRuleName(scoringRule)}
                      </span>
                    )}
                  </div>
                </section>

                {lifecycle === "entries-closed" && (
                  <section className="rounded-2xl p-3" style={PANEL_STYLE}>
                    <p className={SECTION_CLASS}>Settling</p>
                    <p className="mt-1 font-sans text-xs font-semibold text-white/60">
                      Runs score {runsCloseLabel} · prizes push automatically
                    </p>
                  </section>
                )}

                {/* The board IS the prize surface: priced rungs into ranks. */}
                <DailyBoard view={view} address={address ?? null} />
              </>
            ) : (
              <DailyStatusPanel
                lifecycle={lifecycle}
                onPlayCampaign={() => navigate("campaign")}
              />
            )}

            {daily.error && (
              <p
                role="alert"
                className="text-center text-xs font-semibold text-red-300"
              >
                {daily.error}
              </p>
            )}
          </>
        )}
        {activeBoard === "Weekly" && (
          <div className="mx-auto max-w-[640px]">
            <WeeklyTab zoneId={zoneId} />
          </div>
        )}
        {activeBoard === "Season" && <SeasonTab zoneId={zoneId} />}
      </div>

      <div className="relative z-20 px-4 pb-3">
        <EnterCoinKey
          label={primaryLabel}
          amountSol={primaryAmount}
          disabled={primaryDisabled}
          onClick={primaryOnClick}
        />
      </div>

      {view && (
        <InsertCoinSheet
          open={coinSheetOpen}
          onClose={() => setCoinSheetOpen(false)}
          zoneId={zoneId}
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

export default ArcadePage;
