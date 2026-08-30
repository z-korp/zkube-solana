import { useEffect, useMemo, useState } from "react";
import { Plus, Settings, Timer, Users } from "lucide-react";
import { motion } from "motion/react";

import { useConnectedPlayer, useDaily } from "@/backend/client";
import { getThemeId } from "@/config/themes";
import { dailyThemeName } from "@/core/dailyRules";
import { dailyThemeDescription } from "@/game/constraint";
import { DEV_BYPASS_ACTIVE } from "@/dev/devBypass";
import { PlaytestDailyControls } from "@/backend/local/PlaytestControls";
import { PLAYTEST_ACTIVE } from "@/backend/local/playtest";
import useAccount from "@/hooks/useAccount";
import { useActiveDailyAttempt } from "@/hooks/useActiveDailyAttempt";
import { useActiveStoryAttempt } from "@/hooks/useActiveStoryAttempt";
import { useCountdown, useNowTick } from "@/hooks/useNowTick";
import { usePrizeCeremony } from "@/hooks/usePrizeState";
import { useZoneProgress } from "@/hooks/useZoneProgress";
import { useNavigationStore } from "@/stores/navigationStore";
import {
  DailyStatusPanel,
  computeArcadeLifecycle,
  formatUtcClock,
} from "@/ui/components/arcade";
import EnterCoinKey from "@/ui/components/arcade/EnterCoinKey";
import CampaignDoor from "@/ui/components/arcade/CampaignDoor";
import InfoTip from "@/ui/components/shared/InfoTip";
import {
  KreditCoin,
  GuardianFaceBlock,
  KreditShopSheet,
  MONEY_GOLD,
  SolMark,
} from "@/ui/components/economy";
import {
  GuardianPrizeResult,
  InsertCoinSheet,
} from "@/ui/components/settlement";
import DailyBoard from "@/ui/components/arcade/DailyBoard";
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

/**
 * The Arcade — pot and boards on one scroll. Today's zone art shows through a
 * shared ZoneBackdrop, with opaque block panels layered over it: the challenge card
 * (guardian + rule), the Daily pot with the player's rank, then the Daily board.
 * The ranked entry CTA stays pinned at the bottom — the board is the sales floor.
 * The body reshapes across five lifecycle states (the connect-gate is
 * handled globally by App).
 */
const ArcadePage: React.FC = () => {
  const navigate = useNavigationStore((state) => state.navigate);
  const openSettings = useNavigationStore((state) => state.openSettings);
  const setMapZoneId = useNavigationStore((state) => state.setMapZoneId);
  const player = useConnectedPlayer();
  const { address } = useAccount();
  const daily = useDaily();
  const activeDaily = useActiveDailyAttempt();
  const activeStory = useActiveStoryAttempt();
  const { totalStars, zones } = useZoneProgress(address);
  const { setThemeTemplate } = useTheme();

  // Spending an already-owner-funded Kredit is device-session authorized.
  const [coinSheetOpen, setCoinSheetOpen] = useState(false);
  // Buying is owner work, so the shop is its own surface rather than a verb.
  const [shopOpen, setShopOpen] = useState(false);
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
  // Data-available celebration for a grown per-period reward record.
  const { prize, dismissPrize } = usePrizeCeremony();

  const view = daily.daily;
  const zoneId = view?.mapId ?? 1;
  const campaignZoneId = useMemo(() => {
    if (activeStory) return activeStory.zoneId;
    return zones.reduce(
      (highest, zone) =>
        zone.unlocked ? Math.max(highest, zone.zoneId) : highest,
      1,
    );
  }, [activeStory, zones]);
  const openCampaign = () => {
    setMapZoneId(campaignZoneId);
    navigate("map");
  };

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

  const dailyTheme = view?.dailyTheme ?? null;
  const runsCloseLabel = view ? formatUtcClock(view.runsCloseAt) : "23:59 UTC";
  const busy = daily.action !== null;
  const arcadeDiscoveryReady = daily.run.watchStatus?.phase === "subscribed";

  const enterRanked = async () => {
    const active = await daily.enter();
    navigate("play", active.runId);
  };
  // Confirmed from the coin sheet: success navigates away (the sheet unmounts);
  // a failure closes the sheet and surfaces the error banner on the home body.
  const confirmRanked = () =>
    void enterRanked().catch(() => setCoinSheetOpen(false));
  const entrySeconds = useCountdown(view?.runsCloseAt);

  // The pinned key: one verb per lifecycle. An entry is always exactly one
  // Kredit, and the SOL price of a Kredit lives in the shop — a key labelled
  // "Enter" priced in SOL conflated the two currencies.
  let primaryLabel = "Enter";
  let primaryToken: "kredit" | "sol" | undefined;
  let primaryDisabled = false;
  let primaryOnClick: () => void = () => {};

  if (lifecycle === "resume") {
    primaryLabel = "Resume run";
    primaryOnClick = () => {
      if (activeDaily) navigate("play", activeDaily.gameId);
    };
  } else if (lifecycle === "entries-open") {
    if (!arcadeDiscoveryReady) {
      primaryLabel = "Checking run…";
      primaryDisabled = true;
    } else if (view?.followingDailyLamports === null) {
      primaryLabel = "Ranked paused";
      primaryDisabled = true;
    } else if (daily.action === "enter:kredit") {
      primaryLabel = "Spending Kredit…";
      primaryDisabled = true;
    } else if (daily.action === "buy:kredits") {
      primaryLabel = "Buying Kredits…";
      primaryDisabled = true;
    } else if ((view?.kreditBalance ?? 0n) === 0n) {
      primaryLabel = "Get Kredits";
      primaryDisabled = busy || !player.wallet;
      primaryOnClick = () => setShopOpen(true);
    } else {
      primaryToken = "kredit";
      primaryDisabled = busy || !player.wallet;
      // Tap the key → confirm one prepaid Kredit → session-authorized play.
      primaryOnClick = () => setCoinSheetOpen(true);
    }
  } else {
    primaryLabel =
      lifecycle === "entries-closed"
        ? "Entries closed"
        : lifecycle === "delayed" || lifecycle === "stale"
          ? "Keeper catching up"
          : "Daily being prepared";
    primaryDisabled = true;
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden pb-[100px] pt-7">
      <ZoneBackdrop zoneId={zoneId} />

      <div className="relative z-10 grid grid-cols-[1fr_auto_1fr] items-center px-4">
        <span />
        <h1
          className="text-center font-display text-[46px] leading-none"
          style={{
            color: "#FFF4D7",
            textShadow: "0 4px 20px rgba(0,0,0,0.7)",
          }}
        >
          Arcade
        </h1>
        <button
          type="button"
          aria-label="Settings"
          onClick={openSettings}
          className="grid h-9 w-9 justify-self-end place-items-center rounded-xl border border-white/10 bg-black/40 text-white/70"
        >
          <Settings size={15} />
        </button>
      </div>

      <div className="relative z-10 mx-4 mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto pb-4 hide-scrollbar">
        <>
          {PLAYTEST_ACTIVE && <PlaytestDailyControls />}
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
                    Score and Theme split the pot equally. Rank-weighted places
                    extend while the last payout covers one Kredit.
                  </InfoTip>
                </div>
                <div className="mt-2.5 flex gap-1.5">
                  <span className={`${CHIP_CLASS} flex-1`}>
                    <Users size={12} className="text-white/50" />
                    {view.uniquePlayers}
                  </span>
                  <motion.button
                    type="button"
                    onClick={() => setShopOpen(true)}
                    whileTap={{ y: 2 }}
                    className={`${CHIP_CLASS} flex-1`}
                    style={{ color: MONEY_GOLD }}
                    aria-label="Buy Kredits"
                  >
                    <KreditCoin size={15} />
                    {view.kreditBalance.toString()}
                    <Plus size={12} className="text-white/45" />
                  </motion.button>
                  {dailyTheme && (
                    <span className={`${CHIP_CLASS} min-w-0 flex-1 flex-col`}>
                      <span className="truncate text-[9px] uppercase tracking-[0.1em] text-white/45">
                        Today's Theme · {dailyThemeName(dailyTheme)}
                      </span>
                      <span className="w-full truncate text-[10px] text-cyan-100/85">
                        {dailyThemeDescription(dailyTheme)}
                      </span>
                    </span>
                  )}
                </div>
              </section>

              {lifecycle === "entries-closed" && (
                <section className="rounded-2xl p-3" style={PANEL_STYLE}>
                  <p className={SECTION_CLASS}>Settling</p>
                  <p className="mt-1 font-sans text-xs font-semibold text-white/60">
                    Runs score {runsCloseLabel} · rewards collectable for 30
                    days
                  </p>
                </section>
              )}

              {/* The board IS the prize surface: priced rungs into ranks. */}
              <DailyBoard view={view} address={address ?? null} />
            </>
          ) : (
            <DailyStatusPanel
              lifecycle={lifecycle}
              onPlayCampaign={openCampaign}
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
      </div>

      <div className="relative z-20 px-4 pb-2">
        <CampaignDoor
          zoneId={campaignZoneId}
          totalStars={totalStars}
          onClick={openCampaign}
        />
      </div>

      <div className="relative z-20 px-4 pb-3">
        <EnterCoinKey
          label={primaryLabel}
          token={primaryToken}
          disabled={primaryDisabled}
          onClick={primaryOnClick}
        />
      </div>

      {view && (
        <KreditShopSheet
          open={shopOpen}
          onClose={() => setShopOpen(false)}
          balance={view.kreditBalance}
          unitLamports={view.entryLamports}
          busy={daily.action === "buy:kredits"}
          onBuy={(kredits) => {
            void daily
              .buyKredits(kredits)
              .then(() => setShopOpen(false))
              .catch(() => undefined);
          }}
        />
      )}

      {view && (
        <InsertCoinSheet
          open={coinSheetOpen}
          onClose={() => setCoinSheetOpen(false)}
          zoneId={zoneId}
          entryLamports={view.entryLamports}
          onConfirm={confirmRanked}
          busy={daily.action === "enter:kredit"}
          dailyTheme={view.dailyTheme}
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
