import { useEffect } from "react";

import { getThemeId } from "@/config/themes";
import { useDaily } from "@/contexts/daily";
import CampaignDoor, {
  type CampaignShelfItem,
} from "@/ui/components/arcade/CampaignDoor";
import DailyMarquee from "@/ui/components/arcade/DailyMarquee";
import { MONEY_GOLD } from "@/ui/components/economy";
import ConnectCta from "@/ui/components/shared/ConnectCta";
import ThemeBackground from "@/ui/components/shared/ThemeBackground";
import ZoneBackdrop from "@/ui/components/shared/ZoneBackdrop";
import { useTheme } from "@/ui/elements/theme-provider/hooks";
import { SleepingDock } from "@/ui/navigation/BottomNav";

interface ConnectScreenProps {
  /**
   * The boot reveal has handed over: show the lobby. While false this screen
   * is mounting behind the reveal overlay.
   */
  revealDone?: boolean;
}

// Pre-wallet there is no progress to wear: the first realm's block alone
// stands on the locked door.
const LOCKED_SHELF: readonly CampaignShelfItem[] = [
  { zoneId: 1, rim: "white" },
];

/**
 * The landing — the same lobby a connected player stands in. The marquee
 * renders today's public chain state (pot, entry window, players, podium)
 * through the exact furniture Home uses; the differences are the verb in the
 * gold slot, the missing plates, the locked campaign door, and that nothing
 * here can spend.
 */
export default function ConnectScreen({
  revealDone = true,
}: ConnectScreenProps) {
  const daily = useDaily();
  const view = daily.daily;
  const zoneId = view?.mapId ?? 1;
  const { setThemeTemplate } = useTheme();

  // Tint the surface with today's zone accent, exactly as Home does, so the
  // connect transition changes nothing but the chrome.
  useEffect(() => {
    setThemeTemplate(getThemeId(zoneId), false);
  }, [zoneId, setThemeTemplate]);

  return (
    // The exact shell PageNavigator gives the connected app — themed backdrop
    // behind a framed card on desktop — so landing and Home present alike.
    <div className="fixed inset-0 overflow-hidden bg-[#02050d]">
      <ThemeBackground />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.03),rgba(0,0,0,0.2)_45%,rgba(0,0,0,0.65)_100%)]" />
      <div className="relative flex h-full w-full items-center justify-center p-0 md:p-5">
        <div className="relative h-full min-h-0 w-full overflow-hidden md:max-w-[min(90vw,55vh,680px)] md:rounded-[34px] md:border md:border-white/[0.16] md:shadow-[0_30px_80px_rgba(0,0,0,0.6)]">
          <ZoneBackdrop zoneId={zoneId} />
          {revealDone ? (
            <div className="relative h-full overflow-y-auto">
              <div className="br-rise-in relative flex min-h-full flex-col pb-[104px] pt-7">
              {/* The crown row — the title alone; Home's plates join it on
                  the same line after connection. */}
              <div className="text-center">
                <span
                  className="font-display text-[46px] leading-none"
                  style={{
                    color: "#FFF4D7",
                    textShadow: "0 4px 20px rgba(0,0,0,0.7)",
                  }}
                >
                  zKube
                </span>
              </div>
              {/* The pinned totem, minus the campaign door — the dock below
                  already names Campaign. Free height splits 1:2 around it so
                  the room above the guardian scales with the screen. */}
              <div className="relative z-10 flex min-h-0 flex-1 flex-col px-5">
                <div className="min-h-[64px] flex-1" />
                <DailyMarquee zoneId={zoneId} view={view}>
                  <ConnectCta
                    label="Connect wallet"
                    accentOverride={MONEY_GOLD}
                  />
                </DailyMarquee>
                <CampaignDoor shelf={LOCKED_SHELF} locked />
                <div className="flex-[2]" />
              </div>
            </div>
            </div>
          ) : null}
          {revealDone ? <SleepingDock /> : null}
        </div>
      </div>
    </div>
  );
}
