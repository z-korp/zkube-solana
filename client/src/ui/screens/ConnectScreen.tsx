import { motion } from "motion/react";

import { useConnectedPlayer } from "@/chain/connectedPlayerContext";
import ConnectCta from "@/ui/components/shared/ConnectCta";
import ThemeBackground from "@/ui/components/shared/ThemeBackground";
import { useTheme } from "@/ui/elements/theme-provider/hooks";
import ImageAssets from "@/ui/theme/ImageAssets";

/** The only application surface available before wallet + session readiness. */
export default function ConnectScreen() {
  const player = useConnectedPlayer();
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

          <div className="relative z-10 flex w-full max-w-sm flex-1 flex-col items-center justify-center text-center">
            <motion.img
              src={images.logo}
              alt="zKube"
              draggable={false}
              className="w-56 max-w-[75vw] drop-shadow-2xl"
              animate={{ y: [0, -4, 0] }}
              transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
            />
            <p className="mt-7 font-sans text-sm font-semibold leading-6 text-white/75">
              Connect your Solana wallet to enter. The same approval enables
              seven days of silent gameplay on this device.
            </p>
          </div>

          <div className="relative z-10 w-full max-w-sm space-y-3">
            <ConnectCta label="CONNECT & ENABLE" />
            {player.error && (
              <p role="alert" className="text-center font-sans text-xs leading-5 text-red-200">
                {player.error}
              </p>
            )}
            <p className="text-center font-sans text-[11px] leading-4 text-white/45">
              zKube never requests your seed phrase or wallet private key.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
