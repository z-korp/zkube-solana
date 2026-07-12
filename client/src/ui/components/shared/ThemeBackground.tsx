import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useTheme } from "@/ui/elements/theme-provider/hooks";
import ImageAssets from "@/ui/theme/ImageAssets";

/**
 * Themed full-screen background. The visible theme only advances once the next
 * theme's image has decoded (preload), and the swap crossfades over a solid
 * base — so a theme change (e.g. entering a run's zone) never shows a blank or
 * half-loaded frame. `initial={false}` suppresses a fade on first paint.
 */
const ThemeBackground: React.FC = () => {
  const { themeTemplate } = useTheme();
  const [ready, setReady] = useState(themeTemplate);

  useEffect(() => {
    if (ready === themeTemplate) return;
    const src = ImageAssets(themeTemplate).imageBackground;
    let cancelled = false;
    const commit = () => {
      if (!cancelled) setReady(themeTemplate);
    };
    const img = new Image();
    img.onload = commit;
    img.onerror = commit; // never stall the swap on a missing asset
    img.src = src;
    if (img.complete) commit();
    return () => {
      cancelled = true;
    };
  }, [themeTemplate, ready]);

  return (
    <>
      <div className="fixed inset-0 -z-20 bg-[#02050d]">
        <AnimatePresence initial={false}>
          <motion.img
            key={ready}
            src={ImageAssets(ready).imageBackground}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            data-theme={ready}
            draggable={false}
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.82 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5, ease: "easeInOut" }}
          />
        </AnimatePresence>
      </div>
      <div className="fixed inset-0 -z-10 bg-[linear-gradient(180deg,rgba(4,8,18,0.78)_0%,rgba(4,8,18,0.62)_40%,rgba(4,8,18,0.92)_100%)]" />
    </>
  );
};

export default ThemeBackground;
