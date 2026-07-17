import { useEffect, useMemo } from "react";
import { ChevronLeft, Loader2 } from "lucide-react";

import { getZoneGuardian } from "@/config/bossCharacters";
import { getThemeColors, getThemeId, getThemeImages } from "@/config/themes";
import { useCampaign } from "@/contexts/campaign";
import { useMusicPlayer } from "@/contexts/hooks";
import { ConstraintType } from "@/game/constraint";
import { useActiveStoryAttempt } from "@/hooks/useActiveStoryAttempt";
import {
  rulesToGameLevelData,
  useGameLevel,
  type GameLevelData,
} from "@/hooks/useGameLevel";
import { useCampaignLauncher } from "@/play/useCampaignLauncher";
import { useNavigationStore } from "@/stores/navigationStore";
import { useTheme } from "@/ui/elements/theme-provider/hooks";

interface ConstraintDisplay {
  icon: string;
  title: string;
  description: string;
}

function toConstraintDisplay(
  type: ConstraintType,
  value: number,
  count: number,
): ConstraintDisplay {
  switch (type) {
    case ConstraintType.ComboLines:
      return {
        icon: "/assets/common/constraints/constraint-combo.png",
        title: `Clear ${count} combo line${count > 1 ? "s" : ""}`,
        description: `Make ${value}+ line clears in one move to build chain pressure`,
      };
    case ConstraintType.BreakBlocks:
      return {
        icon: "/assets/common/constraints/constraint-break-blocks.png",
        title: `Break ${count} size-${value} blocks`,
        description: "Target exact block sizes under intense board pressure",
      };
    case ConstraintType.ComboMeter:
      return {
        icon: "/assets/common/constraints/constraint-combo.png",
        title: `Reach ${value} on the Combo Meter`,
        description: "Multi-line clears add their cleared-line count to the meter",
      };
    default:
      return {
        icon: "/assets/common/constraints/constraint-clear-lines.png",
        title: "Adaptive objective",
        description: "Face a dynamic guardian condition this encounter",
      };
  }
}

function guardianConstraints(
  gameLevel: GameLevelData | null,
): ConstraintDisplay[] {
  if (!gameLevel) {
    return [
      {
        icon: "/assets/common/constraints/constraint-combo.png",
        title: "Combo pressure",
        description: "Stack line chains to survive the opening barrage",
      },
      {
        icon: "/assets/common/constraints/constraint-break-blocks.png",
        title: "Block destruction",
        description: "Target specific block sizes under intense pressure",
      },
    ];
  }

  const rows = [
    {
      type: gameLevel.constraintType,
      value: gameLevel.constraintValue,
      count: gameLevel.constraintCount,
    },
    {
      type: gameLevel.constraint2Type,
      value: gameLevel.constraint2Value,
      count: gameLevel.constraint2Count,
    },
  ]
    .filter((constraint) => constraint.type !== ConstraintType.None)
    .map((constraint) =>
      toConstraintDisplay(constraint.type, constraint.value, constraint.count),
    );

  return rows.length
    ? rows
    : [toConstraintDisplay(ConstraintType.ComboLines, 3, 2)];
}

const BossRevealPage: React.FC = () => {
  const { setThemeTemplate } = useTheme();
  const { playSfx, warmMusic } = useMusicPlayer();
  const campaign = useCampaign();
  const gameId = useNavigationStore((state) => state.gameId);
  const navigate = useNavigationStore((state) => state.navigate);
  const goBack = useNavigationStore((state) => state.goBack);
  const mapZoneId = useNavigationStore((state) => state.mapZoneId);
  const activeStoryRun = useActiveStoryAttempt();
  const { starting, startLevel } = useCampaignLauncher();

  const activeGameLevel = useGameLevel({ gameId: gameId ?? undefined });
  const map = campaign.campaign?.maps.find(
    (candidate) => candidate.mapId === mapZoneId,
  );
  const catalogGameLevel = useMemo(() => {
    const rules = map?.levels[9];
    return rules ? rulesToGameLevelData(rules, 10, gameId ?? 0n) : null;
  }, [gameId, map?.levels]);
  const gameLevel =
    activeGameLevel?.level === 10 ? activeGameLevel : catalogGameLevel;

  const themeId = getThemeId(map?.themeId ?? mapZoneId);
  const colors = getThemeColors(themeId);
  const themeImages = getThemeImages(themeId);
  const guardian = getZoneGuardian(mapZoneId);
  const constraints = useMemo(
    () => guardianConstraints(gameLevel),
    [gameLevel],
  );

  useEffect(() => {
    setThemeTemplate(themeId);
    playSfx("boss-intro");
    // Fetch the boss track now so the fight's crossfade starts instantly.
    warmMusic(["boss"]);
  }, [playSfx, setThemeTemplate, themeId, warmMusic]);

  const faceGuardian = () => {
    if (activeStoryRun?.zoneId === mapZoneId && activeStoryRun.level === 10) {
      navigate("play", activeStoryRun.gameId);
      return;
    }
    // Launch in place: the guardian's constraints stay on screen while the
    // run is created; navigation happens once it is live.
    void startLevel(mapZoneId, 10);
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col px-5 py-4">
      <button
        onClick={goBack}
        disabled={starting}
        className="absolute left-3 top-3 flex h-11 w-11 items-center justify-center rounded-lg transition-colors disabled:pointer-events-none disabled:opacity-50"
        style={{
          color: colors.accent,
          background: colors.surface,
          border: `1px solid ${colors.border}`,
        }}
      >
        <ChevronLeft size={20} />
      </button>

      <div className="mx-auto flex h-full w-full max-w-sm flex-col items-center justify-center">
        <div className="mb-2">
          <img
            src={themeImages.mapNodeBoss}
            alt="Guardian"
            className="h-20 w-20"
            style={{ filter: `drop-shadow(0 0 20px ${colors.accent}80)` }}
            draggable={false}
          />
        </div>

        <p
          className="font-['DM_Sans'] text-[10px] font-semibold uppercase tracking-[0.3em]"
          style={{ color: colors.accent }}
        >
          Guardian Trial
        </p>

        <h1
          className="mt-1 font-display text-[22px] font-black"
          style={{ color: colors.text, textShadow: colors.glow }}
        >
          {guardian.name}
        </h1>

        <p
          className="mt-1 font-sans text-[11px] font-semibold"
          style={{ color: colors.accent }}
        >
          {guardian.title}
        </p>

        <p
          className="mt-2 text-center font-sans text-[12px] leading-[1.5]"
          style={{ color: colors.textMuted }}
        >
          {guardian.trialIntro}
        </p>

        <div className="mt-5 flex w-full flex-col gap-2">
          {constraints.map((constraint) => (
            <div
              key={`${constraint.icon}-${constraint.title}`}
              className="flex items-center gap-2.5 rounded-[10px] px-3.5 py-2.5"
              style={{
                background: "rgba(255,59,59,0.08)",
                border: "1px solid rgba(255,59,59,0.2)",
              }}
            >
              <img
                src={constraint.icon}
                alt="Constraint"
                className="h-5 w-5"
                draggable={false}
              />
              <div>
                <p
                  className="font-display text-[11px] font-bold"
                  style={{ color: colors.text }}
                >
                  {constraint.title}
                </p>
                <p
                  className="font-['DM_Sans'] text-[9px]"
                  style={{ color: colors.textMuted }}
                >
                  {constraint.description}
                </p>
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={faceGuardian}
          disabled={starting}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl py-3.5 font-display text-sm font-extrabold tracking-[0.1em] text-white transition-opacity disabled:opacity-50"
          style={{
            background: "linear-gradient(135deg, #FF3B3B, #FF6B3B)",
            boxShadow: "0 0 30px rgba(255,59,59,0.4)",
          }}
        >
          {starting && <Loader2 size={16} className="animate-spin" />}
          {starting ? "PREPARING…" : "FACE GUARDIAN"}
        </button>
      </div>
    </div>
  );
};

export default BossRevealPage;
