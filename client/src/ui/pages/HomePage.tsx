import { useEffect, useMemo, useState } from "react";
import { Settings } from "lucide-react";
import { motion } from "motion/react";

import { useConnectedPlayer } from "@/chain/connectedPlayerContext";
import { getThemeId } from "@/config/themes";
import { useDaily } from "@/contexts/daily";
import { DEV_BYPASS_ACTIVE } from "@/dev/devBypass";
import useAccount from "@/hooks/useAccount";
import { useActiveDailyAttempt } from "@/hooks/useActiveDailyAttempt";
import { useNowTick } from "@/hooks/useNowTick";
import { useZoneProgress } from "@/hooks/useZoneProgress";
import { useNavigationStore } from "@/stores/navigationStore";
import { computeArcadeLifecycle } from "@/ui/components/arcade";
import CampaignDoor from "@/ui/components/arcade/CampaignDoor";
import DailyMarquee from "@/ui/components/arcade/DailyMarquee";
import {
  KreditCoin,
  KreditShopSheet,
  MONEY_GOLD,
  SolMark,
} from "@/ui/components/economy";
import EnterCoinKey from "@/ui/components/arcade/EnterCoinKey";
import {
  GuardianPrizeResult,
  InsertCoinSheet,
} from "@/ui/components/settlement";
import ZoneBackdrop from "@/ui/components/shared/ZoneBackdrop";
import {
  useTheme,
  useThemeColors,
} from "@/ui/elements/theme-provider/hooks";
import { formatSolBalance, formatSolBalanceLamports } from "@/utils/currency";

/** Opaque block furniture — the menu chrome never uses glass blur. */
const PLATE_STYLE: React.CSSProperties = {
  background: "linear-gradient(180deg, #101A2E 0%, #0A1120 100%)",
  border: "1px solid rgba(255,255,255,0.10)",
  boxShadow: "0 3px 0 #04070F, inset 0 1px 0 rgba(255,255,255,0.08)",
};

/**
 * Home — the lobby after connection. The same surface as the landing: the
 * app title large above the guardian, the marquee owning the screen, the
 * campaign door beneath. Connection put PLAY in the gold slot and lit the
 * plates. PLAY opens the Arcade — entering a ranked run stays an Arcade act.
 */
const HomePage: React.FC = () => {
  const navigate = useNavigationStore((state) => state.navigate);
  const openSettings = useNavigationStore((state) => state.openSettings);
  const player = useConnectedPlayer();
  const { address } = useAccount();
  const daily = useDaily();
  const activeDaily = useActiveDailyAttempt();
  const { totalStars, zones } = useZoneProgress(address);
  const { setThemeTemplate } = useTheme();
  const themeColors = useThemeColors();

  const view = daily.daily;
  const zoneId = view?.mapId ?? 1;

  // Tint the whole surface with today's zone accent (never persisted).
  useEffect(() => {
    setThemeTemplate(getThemeId(zoneId), false);
  }, [zoneId, setThemeTemplate]);

  const nowUnix = Math.floor(useNowTick(60_000) / 1_000);
  const lifecycle = computeArcadeLifecycle({
    view,
    hasActiveRun: activeDaily !== null,
    nowUnix,
  });

  // The Campaign door carries the realm the player is currently conquering.
  const campaignZoneId = useMemo(() => {
    const unlocked = zones.filter((zone) => zone.unlocked);
    if (unlocked.length === 0) return 1;
    return unlocked.reduce((max, zone) => Math.max(max, zone.zoneId), 1);
  }, [zones]);

  // DEV-ONLY prize-ceremony preview (?demo=prize with the wallet bypass):
  // renders the settlement surface with fixture values and no chain state.
  // The whole branch folds to null in production builds.
  const demoSheet =
    import.meta.env.DEV && DEV_BYPASS_ACTIVE
      ? new URLSearchParams(window.location.search).get("demo")
      : null;
  const [demoPrizeOpen, setDemoPrizeOpen] = useState(demoSheet === "prize");
  // Buying is owner work, and the balance readout is where a player looks
  // when they wonder whether they can play — so it is also the shop door.
  const [shopOpen, setShopOpen] = useState(false);
  // Entering from the lobby directly: the Arcade round trip existed only to
  // reach a second key.
  const [coinSheetOpen, setCoinSheetOpen] = useState(false);

  // One key, and it names the single best next action. It used to say "Play"
  // in every state and then navigate to the Arcade so a second key could be
  // pressed — two taps for one intent, with the price hidden until screen two.
  const busy = daily.action !== null;
  const alreadyEntered =
    address !== undefined &&
    address !== null &&
    (view?.leaderboard.some((entry) => entry.player.toBase58() === address) ??
      false);
  const entrySol = view ? formatSolBalanceLamports(view.entryLamports) : null;

  let playLabel = "Play";
  let playAmount: string | null = null;
  let playDisabled = false;
  let playOnClick: () => void = () => navigate("arcade");

  if (lifecycle === "resume") {
    playLabel = "Resume run";
    playOnClick = () => {
      if (activeDaily) navigate("play", activeDaily.gameId);
    };
  } else if (lifecycle === "entries-open") {
    if (daily.action === "enter:kredit") {
      playLabel = "Entering…";
      playDisabled = true;
    } else if (daily.action === "buy:kredits") {
      playLabel = "Buying…";
      playDisabled = true;
    } else if (view?.followingDailyLamports === null) {
      playLabel = "Ranked paused";
      playDisabled = true;
    } else if ((view?.kreditBalance ?? 0n) === 0n) {
      playLabel = "Play";
      playAmount = entrySol;
      playDisabled = busy || !player.wallet;
      playOnClick = () => setShopOpen(true);
    } else {
      playLabel = alreadyEntered ? "Play again" : "Play";
      playDisabled = busy || !player.wallet;
      playOnClick = () => setCoinSheetOpen(true);
    }
  } else if (lifecycle === "entries-closed") {
    playLabel = "See results";
  } else {
    playLabel =
      lifecycle === "delayed" || lifecycle === "stale"
        ? "Keeper catching up"
        : "Daily being prepared";
    playDisabled = true;
  }

  const balance =
    player.balanceLamports !== null
      ? formatSolBalance(player.balanceLamports)
      : null;

  return (
    // min-h-full, not h-full: tall screens stretch and the spacers distribute
    // the free height; short screens grow past the viewport and scroll inside
    // PageNavigator's page container instead of clipping the door.
    <div className="relative flex min-h-full flex-col pb-[104px] pt-7">
      <ZoneBackdrop zoneId={zoneId} />

      {/* The crown row: balance and gear sit on the title's line, centred on
          the middle of the big zKube. */}
      <div className="relative z-10 grid grid-cols-[1fr_auto_1fr] items-center px-4">
        <span className="flex items-center gap-1.5 justify-self-start">
          {balance !== null && (
            <motion.button
              type="button"
              onClick={() => navigate("profile")}
              whileTap={{ y: 2, boxShadow: "0 1px 0 #04070F" }}
              className="flex items-center gap-1.5 rounded-xl px-2 py-2 font-mono text-xs font-bold tabular-nums"
              style={{ ...PLATE_STYLE, color: themeColors.text }}
            >
              {balance}
              <SolMark size={11} />
            </motion.button>
          )}
          {view && (
            <motion.button
              type="button"
              aria-label="Buy Kredits"
              onClick={() => setShopOpen(true)}
              whileTap={{ y: 2, boxShadow: "0 1px 0 #04070F" }}
              className="flex items-center gap-1 rounded-xl px-2 py-2 font-mono text-xs font-bold tabular-nums"
              style={{ ...PLATE_STYLE, color: MONEY_GOLD }}
            >
              <KreditCoin size={15} />
              {view.kreditBalance.toString()}
            </motion.button>
          )}
        </span>
        <span
          className="text-center font-display text-[46px] leading-none"
          style={{
            color: "#FFF4D7",
            textShadow: "0 4px 20px rgba(0,0,0,0.7)",
          }}
        >
          zKube
        </span>
        <span className="justify-self-end">
          <motion.button
            type="button"
            aria-label="Settings"
            onClick={openSettings}
            whileTap={{ y: 2, boxShadow: "0 1px 0 #04070F" }}
            className="flex h-9 w-9 items-center justify-center rounded-xl"
            style={{ ...PLATE_STYLE, color: themeColors.text }}
          >
            <Settings size={15} />
          </motion.button>
        </span>
      </div>

      {/* The pinned totem. The free height splits 1:2 around it — the room
          above the guardian scales with the screen while the scenery below
          keeps the larger share; min-height covers the block's overlap. */}
      <div className="relative z-10 flex min-h-0 flex-1 flex-col px-5">
        <div className="min-h-[64px] flex-1" />
        <DailyMarquee zoneId={zoneId} view={view} address={address ?? null}>
          <EnterCoinKey
            label={playLabel}
            amountSol={playAmount}
            disabled={playDisabled}
            onClick={playOnClick}
          />
        </DailyMarquee>
        <CampaignDoor
          zoneId={campaignZoneId}
          totalStars={totalStars}
          onClick={() => navigate("campaign")}
        />
        <div className="flex-[2]" />
      </div>

      {view && (
        <InsertCoinSheet
          open={coinSheetOpen}
          onClose={() => setCoinSheetOpen(false)}
          zoneId={zoneId}
          entryLamports={view.entryLamports}
          busy={daily.action === "enter:kredit"}
          onConfirm={() => {
            void daily
              .enter()
              .then((active) => navigate("play", active.runId))
              .catch(() => setCoinSheetOpen(false));
          }}
        />
      )}

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

      {import.meta.env.DEV && demoPrizeOpen && (
        <GuardianPrizeResult
          open
          onDismiss={() => setDemoPrizeOpen(false)}
          zoneId={2}
          amountLamports={310_000_000n}
          periodLabel="Score"
          bestPrizeRank={2}
        />
      )}
    </div>
  );
};

export default HomePage;
