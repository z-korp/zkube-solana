import AmbientWeather from "@/ui/components/shared/AmbientWeather";
import ConnectCta from "@/ui/components/shared/ConnectCta";
// import InfoSheet from "@/ui/components/shared/InfoSheet"; // restore with the parked "How it works" sheet below
import ThemeBackground from "@/ui/components/shared/ThemeBackground";
import { useTheme } from "@/ui/elements/theme-provider/hooks";
import ImageAssets from "@/ui/theme/ImageAssets";

interface ConnectScreenProps {
  /**
   * The boot reveal has handed over: show the connect action. While false this
   * screen is mounting behind the reveal overlay.
   */
  revealDone?: boolean;
}

/**
 * The surface for a player who is not connected. On a cold start it mounts
 * behind the boot reveal and inherits its settled title, so the wordmark the
 * animation lands is the wordmark that stays.
 */
export default function ConnectScreen({
  revealDone = true,
}: ConnectScreenProps) {
  const { themeTemplate } = useTheme();
  const images = ImageAssets(themeTemplate);

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#02050d]">
      <ThemeBackground />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(32,216,255,0.12),rgba(0,0,0,0.3)_48%,rgba(0,0,0,0.82)_100%)]" />
      <div className="relative flex h-full w-full items-center justify-center md:p-5">
        <div className="relative flex h-full min-h-0 w-full flex-col items-center justify-end overflow-hidden px-6 pb-[max(2rem,env(safe-area-inset-bottom))] md:max-w-[min(90vw,55vh,680px)] md:rounded-[34px] md:border md:border-white/[0.16] md:shadow-[0_30px_80px_rgba(0,0,0,0.6)]">
          <div
            className="absolute inset-0 bg-cover bg-center opacity-70"
            style={{ backgroundImage: `url('${images.loadingBackground}')` }}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/35 to-black/95" />
          <AmbientWeather
            className="absolute inset-0 z-[1] h-full w-full"
            density={80}
          />

          {/* The wordmark belongs to the boot reveal, which keeps owning it
              rather than handing it over — see BootReveal's onFinished. */}

          <div className="absolute bottom-0 left-1/2 z-10 flex w-full max-w-sm -translate-x-1/2 flex-col items-center gap-2.5 px-6 pb-[max(2rem,env(safe-area-inset-bottom))]">
            {revealDone ? (
              <div className="br-rise-in flex w-full flex-col items-center">
                <ConnectCta label="Connect wallet" />
              </div>
            ) : null}
            {/*
             * "How it works" is parked while mobile onboarding is being
             * validated: the landing should carry the connect action and the
             * install affordance only. Restore this InfoSheet when the copy is
             * revisited.
             */}
            {/* <InfoSheet title="How it works">
              <p>
                Connect your Solana wallet to play. You stay signed in on this
                device, so play stays smooth.
              </p>
              <p>zKube never asks for your seed phrase or private key.</p>
            </InfoSheet> */}
          </div>
        </div>
      </div>
    </div>
  );
}
