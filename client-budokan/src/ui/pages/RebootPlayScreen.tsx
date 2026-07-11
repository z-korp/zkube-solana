import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ChevronUp, Star } from "lucide-react";
import { BonusType } from "@/solana/reboot/bonusTypes";
import { getThemeColors, getThemeImages, getThemeId } from "@/config/themes";
import { useMusicPlayer } from "@/contexts/hooks";
import { useNavigationStore } from "@/stores/navigationStore";
import { transformDataContractIntoBlock } from "@/utils/gridUtils";
import Grid from "@/ui/components/Grid";
import NextLine from "@/ui/components/NextLine";
import { useRebootRun } from "@/solana/reboot/useRebootRun";
import { useRebootCampaign } from "@/solana/reboot/useRebootCampaign";
import { toDisplayGrid } from "@/solana/reboot/rebootGrid";
import RebootProgressPanel from "@/ui/components/reboot/RebootProgressPanel";
import RebootGameHud from "@/ui/components/hud/RebootGameHud";
import { estimateStars } from "@/ui/components/hud/runDisplay";
import RebootGameActionBar from "@/ui/components/actionbar/RebootGameActionBar";
import "../../grid.css";

const ROWS = 10;
const COLS = 8;

const subscribeResize = (onChange: () => void) => {
  window.addEventListener("resize", onChange);
  window.addEventListener("orientationchange", onChange);
  return () => {
    window.removeEventListener("resize", onChange);
    window.removeEventListener("orientationchange", onChange);
  };
};

export default function RebootPlayScreen() {
  const navigate = useNavigationStore((state) => state.navigate);
  const zone = useNavigationStore((state) => state.mapZoneId);
  const navigationDaily = useNavigationStore((state) => state.isDailyMap);
  const previewLevel = useNavigationStore((state) => state.pendingPreviewLevel);
  const run = useRebootRun();
  const campaign = useRebootCampaign();
  const [mapId, setMapId] = useState(Math.min(10, Math.max(1, zone)));
  const [level, setLevel] = useState(previewLevel ?? 1);
  const [gridBusy, setGridBusy] = useState(false);
  const [selectedBonus, setSelectedBonus] = useState(BonusType.None);
  const [nextLineConsumed, setNextLineConsumed] = useState(false);
  const runId = run.activeRun?.runId;
  useEffect(() => {
    setNextLineConsumed(false);
  }, [runId]);

  const viewportHeight = useSyncExternalStore(
    subscribeResize,
    () => window.innerHeight,
  );
  const { playSfx, setMusicContext } = useMusicPlayer();
  const lifecycle = run.activeRun?.lifecycle ?? null;
  const isBossLevel =
    (run.activeRun?.rules.bossId ?? 0) > 0 || run.activeRun?.level === 10;
  const isFinalBoss =
    isBossLevel && run.activeRun?.mapId === 10 && run.activeRun?.level === 10;
  const inPlay =
    Boolean(run.activeRun) && lifecycle !== null && !isTerminal(lifecycle);
  useEffect(() => {
    if (!inPlay) return;
    setMusicContext(isBossLevel ? "boss" : "level");
    return () => setMusicContext("main");
  }, [inPlay, isBossLevel, setMusicContext]);

  // End-of-level fanfares — only on a transition observed during play, never
  // when resuming straight into a terminal lifecycle.
  const prevLifecycleRef = useRef<string | null>(null);
  useEffect(() => {
    const previous = prevLifecycleRef.current;
    prevLifecycleRef.current = lifecycle;
    if (!lifecycle || previous === null || previous === lifecycle) return;
    if (lifecycle === "levelComplete") {
      playSfx(isFinalBoss ? "victory" : isBossLevel ? "boss-defeat" : "levelup");
      window.setTimeout(() => playSfx("star"), 350);
      window.setTimeout(() => playSfx("coin"), 650);
    } else if (lifecycle === "finished") {
      playSfx("over");
    }
  }, [lifecycle, isBossLevel, isFinalBoss, playSfx]);
  const effectiveMapId = run.activeRun?.mapId ?? mapId;
  const isDailyRun =
    navigationDaily ||
    run.activeRun?.mode === "daily" ||
    run.receipt?.mode === "daily";
  const themeId = getThemeId(effectiveMapId);
  const colors = getThemeColors(themeId);
  const images = getThemeImages(themeId);
  const selectedMap = campaign.campaign?.maps.find(
    (entry) => entry.mapId === mapId,
  );
  const mapUnlocked = campaign.campaign
    ? selectedMap?.enabled === true && selectedMap.unlocked
    : mapId === 1;

  useEffect(() => {
    if (campaign.campaign) {
      if (!selectedMap?.enabled) {
        const fallback =
          campaign.campaign.maps.find(
            (entry) => entry.enabled && entry.unlocked,
          ) ?? campaign.campaign.maps.find((entry) => entry.enabled);
        if (fallback) setMapId(fallback.mapId);
      }
    } else if (!campaign.loading && mapId !== 1) {
      // A player account is initialized by the first sponsored Map 1 run.
      setMapId(1);
    }
  }, [campaign.campaign, campaign.loading, mapId, selectedMap?.enabled]);
  const grid = useMemo(
    () =>
      transformDataContractIntoBlock(toDisplayGrid(run.activeRun?.grid ?? [])),
    [run.activeRun?.grid],
  );
  const nextRow = useMemo(
    () =>
      run.activeRun?.nextRow
        ? transformDataContractIntoBlock([run.activeRun.nextRow])
        : [],
    [run.activeRun?.nextRow],
  );
  const playMove = run.playMove;
  const onMove = useCallback(
    async (row: number, start: number, destination: number) => {
      const active = await playMove(row, start, destination);
      return {
        blocks: toDisplayGrid(active.grid),
        nextRow: active.nextRow ?? [],
        over: isTerminal(active.lifecycle),
      };
    },
    [playMove],
  );
  const applyBonus = run.applyBonus;
  const onBonus = useCallback(
    async (row: number, column: number) => {
      const active = await applyBonus(row, column);
      setSelectedBonus(BonusType.None);
      return {
        blocks: toDisplayGrid(active.grid),
        nextRow: active.nextRow ?? [],
        over: isTerminal(active.lifecycle),
      };
    },
    [applyBonus],
  );

  if (run.phase === "none" || run.phase === "missing") {
    if (isDailyRun) {
      return (
        <Surface background={images.background} color={colors.background}>
          <Panel>
            <h1 className="text-2xl font-black text-white">Daily Arena</h1>
            <p className="text-center text-sm text-white/60">
              Choose today’s Stars or USDC attempt from the authoritative Daily
              challenge.
            </p>
            {run.error && (
              <p className="max-w-sm text-center text-xs text-red-300">
                {run.error}
              </p>
            )}
            <button
              onClick={() => navigate("daily")}
              className="rounded-xl bg-cyan-600 px-7 py-3 font-bold text-white"
            >
              Back to Daily Arena
            </button>
          </Panel>
        </Surface>
      );
    }
    return (
      <Surface background={images.background} color={colors.background}>
        <button
          onClick={() => navigate("home")}
          className="absolute left-4 top-4 text-sm text-white/60"
        >
          ← Home
        </button>
        <Panel>
          <h1 className="text-2xl font-black text-white">New Campaign Run</h1>
          <div className="flex w-full items-center justify-between text-xs text-white/60">
            <span>Campaign v{campaign.campaign?.contentVersion ?? "new"}</span>
            <span>
              {campaign.campaign
                ? `${campaign.campaign.starsBalance} Stars`
                : "Map 1 starts free"}
            </span>
          </div>
          <label className="flex w-full items-center justify-between gap-4 text-sm text-white/70">
            Map
            <select
              value={mapId}
              onChange={(event) => setMapId(Number(event.target.value))}
              className="rounded bg-black/50 px-3 py-2 text-white"
            >
              {campaign.campaign ? (
                campaign.campaign.maps
                  .filter((entry) => entry.enabled)
                  .map((entry) => (
                    <option key={entry.mapId} value={entry.mapId}>
                      {entry.mapId}
                      {entry.unlocked ? "" : " · locked"}
                    </option>
                  ))
              ) : (
                <option value={1}>1</option>
              )}
            </select>
          </label>
          <label className="flex w-full items-center justify-between gap-4 text-sm text-white/70">
            Level
            <select
              value={level}
              onChange={(event) => setLevel(Number(event.target.value))}
              className="rounded bg-black/50 px-3 py-2 text-white"
            >
              {Array.from({ length: 10 }, (_, index) => (
                <option key={index + 1}>{index + 1}</option>
              ))}
            </select>
          </label>
          {selectedMap && (
            <div
              className="grid w-full grid-cols-10 gap-1"
              aria-label={`Map ${mapId} level Stars`}
            >
              {selectedMap.levelStars.map((stars, index) => (
                <button
                  key={index + 1}
                  type="button"
                  onClick={() => setLevel(index + 1)}
                  className={`rounded px-1 py-1 text-[9px] ${level === index + 1 ? "bg-cyan-600 text-white" : "bg-white/10 text-white/60"}`}
                  title={`Level ${index + 1}: ${stars} Stars`}
                >
                  {index + 1}
                  <span className="block text-yellow-300">{stars}★</span>
                </button>
              ))}
            </div>
          )}
          {selectedMap && !selectedMap.unlocked && (
            <div className="flex w-full flex-col gap-2 rounded-xl border border-yellow-300/20 bg-yellow-950/30 p-3 text-center">
              <p className="text-xs text-yellow-100">
                Map {mapId} is locked on-chain.
              </p>
              <div className="flex justify-center gap-2">
                <button
                  type="button"
                  disabled={
                    campaign.unlocking ||
                    campaign.campaign!.starsBalance < selectedMap.starCost
                  }
                  onClick={() => runAction(campaign.unlock(mapId, "stars"))}
                  className="rounded-lg bg-yellow-500 px-3 py-2 text-xs font-bold text-black disabled:opacity-40"
                >
                  Unlock · {selectedMap.starCost} Stars
                </button>
                <button
                  type="button"
                  disabled={campaign.unlocking}
                  onClick={() => runAction(campaign.unlock(mapId, "usdc"))}
                  className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-40"
                >
                  Buy · {formatTokenAmount(selectedMap.usdcCost, 6)} USDC
                </button>
              </div>
            </div>
          )}
          {(run.error || campaign.error) && (
            <p className="max-w-sm text-center text-xs text-red-300">
              {run.error ?? campaign.error}
            </p>
          )}
          <RebootProgressPanel />
          <button
            disabled={
              run.busy || campaign.loading || campaign.unlocking || !mapUnlocked
            }
            onClick={() => runAction(run.startCampaignRun(mapId, level))}
            className="rounded-xl bg-cyan-600 px-7 py-3 font-bold text-white disabled:opacity-50"
          >
            {run.busy
              ? "Preparing on-chain run…"
              : campaign.loading
                ? "Loading campaign…"
                : mapUnlocked
                  ? "Play"
                  : "Unlock map to play"}
          </button>
        </Panel>
      </Surface>
    );
  }

  if (run.phase === "settled" && run.receipt) {
    return (
      <Surface background={images.background} color={colors.background}>
        <Panel>
          <h1 className="text-3xl font-black text-yellow-300">
            {run.receipt.mode === "daily"
              ? "Daily result settled"
              : "Run settled"}
          </h1>
          <p className="text-white">
            Score <strong>{run.receipt.score}</strong>
          </p>
          <p className="text-white/70">
            {run.receipt.moves} moves
            {run.receipt.mode === "daily"
              ? " · best score updated on-chain"
              : ` · ${run.receipt.levelStars} Stars`}
          </p>
          {run.error && (
            <p className="max-w-sm text-center text-xs text-red-300">
              {run.error}
            </p>
          )}
          <button
            disabled={run.busy}
            onClick={() =>
              runAction(
                cleanupAndContinue(run.cleanup, run.receipt!.mode, navigate),
              )
            }
            className="rounded-xl bg-cyan-600 px-7 py-3 font-bold text-white disabled:opacity-50"
          >
            {run.busy
              ? "Recovering rent…"
              : run.receipt.mode === "daily"
                ? "Collect rent & view leaderboard"
                : "Collect rent & continue"}
          </button>
        </Panel>
      </Surface>
    );
  }

  if (!run.activeRun || run.phase === "base") {
    return (
      <Surface background={images.background} color={colors.background}>
        <Panel>
          <p className="animate-pulse text-lg font-bold text-cyan-300">
            Resolving MagicBlock run…
          </p>
          <p className="text-xs text-white/50">
            {run.watchStatus?.phase ?? run.phase}
          </p>
          {run.error && (
            <p className="max-w-sm text-center text-xs text-red-300">
              {run.error}
            </p>
          )}
        </Panel>
      </Surface>
    );
  }

  if (!run.sessionAuthorized) {
    return (
      <Surface background={images.background} color={colors.background}>
        <Panel>
          <h1 className="text-xl font-black text-purple-300">
            Session expired
          </h1>
          <p className="max-w-sm text-center text-sm text-white/60">
            Authorize a fresh run-bound session to resume this exact run.
          </p>
          <button
            disabled={run.busy}
            onClick={() => runAction(run.recoverSession())}
            className="rounded-xl bg-purple-600 px-7 py-3 font-bold text-white disabled:opacity-50"
          >
            Renew session
          </button>
        </Panel>
      </Surface>
    );
  }

  const terminal = isTerminal(run.activeRun.lifecycle);
  const activeRun = run.activeRun;
  const gridSize = Math.max(
    24,
    Math.min(52, Math.floor((viewportHeight - 300) / 11)),
  );
  return (
    <Surface background={images.background} color={colors.background}>
      <div className="flex h-full min-h-0 w-full flex-col bg-black/15">
        <RebootGameHud run={activeRun} onBack={() => navigate("home")} />
        {run.error && (
          <div className="bg-red-950/80 px-3 py-1 text-center text-xs text-red-200">
            {run.error}
          </div>
        )}
        {terminal ? (
          <div className="flex flex-1 items-center justify-center">
            <Panel>
              <div className="text-4xl" aria-hidden="true">
                {activeRun.lifecycle === "levelComplete" ? "🏆" : "🏁"}
              </div>
              <h2 className="text-3xl font-black text-yellow-300">
                {run.activeRun.lifecycle === "levelComplete"
                  ? "Level complete"
                  : "Run finished"}
              </h2>
              {activeRun.lifecycle === "levelComplete" &&
                activeRun.mode !== "daily" && (
                  <div
                    className="flex gap-1 text-yellow-300"
                    aria-label="Stars earned"
                  >
                    {Array.from({ length: 3 }, (_, index) => (
                      <Star
                        key={index}
                        size={28}
                        fill={
                          index <
                          estimateStars(
                            activeRun.rules.maxMoves,
                            activeRun.moves,
                            activeRun.rules.starThresholdModifier,
                          )
                            ? "currentColor"
                            : "none"
                        }
                      />
                    ))}
                  </div>
                )}
              <div className="grid w-full grid-cols-3 gap-2 text-center">
                <ResultMetric label="Score" value={activeRun.score} />
                <ResultMetric label="Moves" value={activeRun.moves} />
                <ResultMetric label="Best combo" value={`×${activeRun.maxCombo}`} />
              </div>
              <p className="text-center text-xs leading-5 text-white/55">
                The result is verified on the MagicBlock rollup. Settlement
                commits it atomically to your permanent Solana career.
              </p>
              <button
                disabled={run.busy}
                onClick={() => runAction(run.settle())}
                className="rounded-xl bg-emerald-600 px-7 py-3 font-bold text-white disabled:opacity-50"
              >
                {run.busy ? "Committing…" : "Settle result"}
              </button>
            </Panel>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center p-2">
            <Grid
              key={`run-${run.activeRun.runId}`}
              gameId={run.activeRun.runId}
              initialData={grid}
              nextLineData={nextRow}
              setNextLineHasBeenConsumed={setNextLineConsumed}
              gridSize={gridSize}
              gridHeight={ROWS}
              gridWidth={COLS}
              bonus={selectedBonus}
              isTxProcessing={gridBusy}
              setIsTxProcessing={setGridBusy}
              levelTransitionPending={false}
              onMove={onMove}
              onBonus={onBonus}
              themeId={themeId}
            />
            <div className="mt-1 flex items-center gap-1 text-[10px] uppercase tracking-[0.2em] text-white/50">
              <ChevronUp size={14} /> Next row
            </div>
            <NextLine
              nextLineData={nextLineConsumed ? [] : nextRow}
              gridSize={gridSize}
              gridHeight={1}
              gridWidth={COLS}
              themeId={themeId}
            />
          </div>
        )}
        {!terminal && (
          <RebootGameActionBar
            bonusType={activeRun.bonusType}
            bonusCharges={activeRun.bonusCharges}
            activeBonus={selectedBonus}
            bonusTriggerType={activeRun.rules.bonusTriggerType}
            bonusThreshold={activeRun.rules.bonusThreshold}
            startingCharges={activeRun.rules.startingCharges}
            onToggleBonus={() =>
              setSelectedBonus((current) =>
                current === activeRun.bonusType
                  ? BonusType.None
                  : (activeRun.bonusType as BonusType),
              )
            }
            onExit={() => navigate("home")}
          />
        )}
      </div>
    </Surface>
  );
}

function isTerminal(lifecycle: string): boolean {
  return lifecycle === "levelComplete" || lifecycle === "finished";
}

function runAction(action: Promise<unknown>): void {
  void action.catch(() => {
    // The hook has already projected the user-facing error into screen state.
  });
}

async function cleanupAndContinue(
  cleanup: () => Promise<string | null>,
  mode: string,
  navigate: (page: "daily") => void,
): Promise<void> {
  await cleanup();
  if (mode === "daily") navigate("daily");
}

function formatTokenAmount(amount: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const whole = amount / scale;
  const fraction = (amount % scale)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function Surface({
  background,
  color,
  children,
}: {
  background: string;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="relative flex h-full min-h-0 w-full items-center justify-center"
      style={{
        backgroundImage: `url(${background})`,
        backgroundColor: color,
        backgroundPosition: "center",
        backgroundSize: "cover",
      }}
    >
      {children}
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex w-[min(390px,92vw)] flex-col items-center gap-4 rounded-2xl border border-white/10 bg-black/70 p-8 backdrop-blur-md">
      {children}
    </div>
  );
}

function ResultMetric({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.05] px-2 py-3">
      <strong className="block text-lg text-cyan-200">{value}</strong>
      <span className="text-[8px] uppercase tracking-widest text-white/40">
        {label}
      </span>
    </div>
  );
}
