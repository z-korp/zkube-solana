import ThemeBackground from "@/ui/components/shared/ThemeBackground";
import { useTheme } from "@/ui/elements/theme-provider/hooks";
import ImageAssets from "@/ui/theme/ImageAssets";

/**
 * First-paint screen shown until the initial on-chain snapshot resolves. It
 * renders the themed background so the swap into the app is already the right
 * image (no flash), under the wordmark.
 *
 * The wordmark is set in the display face rather than drawn from a logo image:
 * the boot reveal lands the same lettering, so a player who waits here sees the
 * title they just watched arrive rather than a second, different mark.
 */
const Loading = () => {
  const { themeTemplate } = useTheme();
  const imgAssets = ImageAssets(themeTemplate);

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#02050d]">
      <ThemeBackground />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.03),rgba(0,0,0,0.2)_45%,rgba(0,0,0,0.65)_100%)]" />
      <div className="relative flex h-full w-full items-center justify-center p-0 md:p-5">
        <div className="relative flex h-full min-h-0 w-full flex-col items-center overflow-hidden md:max-w-[min(90vw,55vh,680px)] md:rounded-[34px] md:border md:border-white/[0.16] md:shadow-[0_30px_80px_rgba(0,0,0,0.6)]">
          <div className="absolute inset-0 z-10 overflow-hidden">
            <div
              className="animate-zoom-in-out absolute inset-0 bg-cover bg-center"
              style={{
                backgroundImage: `url('${imgAssets.loadingBackground}')`,
              }}
            />
          </div>
          <div className="z-30 flex flex-1 flex-col items-center justify-center px-6 pb-12">
            <span className="font-display text-[3.25rem] leading-none text-[#fff4d7] [text-shadow:0_3px_22px_rgba(0,0,0,0.6)] sm:text-[3.75rem]">
              zKube
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Loading;
