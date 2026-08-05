import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";

import { getGuardianPortrait } from "@/config/bossCharacters";
import { useThemeColors } from "@/ui/elements/theme-provider/hooks";
import { BEATS, BootRevealScene } from "@/ui/components/shared/bootRevealScene";

import "./bootReveal.css";

/**
 * The boot reveal: the app icon assembles itself, the hero block slides in to
 * complete it, and the finished composition detonates into confetti while the
 * wordmark lands and the app appears underneath.
 *
 * It renders as a full-screen overlay rather than inside a screen, so the
 * debris can carry over whatever mounted behind it — the connect screen for a
 * new player, or the app itself for one who is already connected.
 *
 * The three blocks are the same guardians, in the same arrangement, as the
 * shipped app icon: tapping the icon and watching it assemble is one gesture.
 */

// zone ids of the icon trio — Mamba (Tribal), Kitsune (Japan), Sobek (Egypt)
const MAMBA_ZONE = 9;
const KITSUNE_ZONE = 7;
const SOBEK_ZONE = 2;

const BLOCKS = [
  {
    zone: MAMBA_ZONE,
    crop: [244, 32, 414, 212] as const,
    base: "#2FCFC0",
    x: 4,
    y: 4,
    s: 82,
    rot: -13,
    role: "dropA" as const,
  },
  {
    zone: KITSUNE_ZONE,
    crop: [170, 40, 370, 240] as const,
    base: "#E8455E",
    x: 114,
    y: 114,
    s: 82,
    rot: 12,
    role: "dropB" as const,
  },
  {
    zone: SOBEK_ZONE,
    crop: [86, 140, 428, 406] as const,
    base: "#E8C86A",
    x: 50,
    y: 52,
    s: 100,
    rot: -3,
    role: "slide" as const,
  },
];

const WORDMARK_CLASS =
  "font-display text-[3.25rem] leading-none sm:text-[3.75rem]";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`boot reveal: ${src} failed`));
    img.src = src;
  });
}

interface BootRevealProps {
  /**
   * Whether the title belongs on screen. A player who is already connected
   * lands straight in the app and does not need a title card in the way; one
   * who is not gets the wordmark, which the connect screen then inherits.
   *
   * Read live rather than at mount: on the first frame nobody knows yet, since
   * the silent reconnect this animation covers has not resolved.
   */
  showWordmark: boolean;
  /**
   * The sequence has handed over: show the connect action, or let a connected
   * player through. Debris is still falling at this point.
   */
  onSettled: () => void;
  /**
   * Nothing of the reveal remains to be drawn, so it can be torn down. This is
   * deliberately NOT the end of the animation: while the title is still wanted
   * the overlay stays mounted and keeps owning it.
   *
   * The alternative — handing the title to the screen underneath — cannot be
   * made invisible. Two elements at identical geometry still rasterise text
   * differently, because whether the browser uses subpixel or grayscale
   * antialiasing depends on the compositing of the layer the glyphs land in,
   * which is not something the swap can match. Measured across the hand-over,
   * roughly 2500 pixels of the wordmark changed while the rest of the screen
   * was pixel-identical, and that is what reads as the title's brightness
   * shifting when the animation ends.
   */
  onFinished: () => void;
}

export default function BootReveal({
  showWordmark,
  onSettled,
  onFinished,
}: BootRevealProps) {
  const colours = useThemeColors();
  const reduceMotion = useReducedMotion();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scrimRef = useRef<HTMLDivElement | null>(null);
  const wordRef = useRef<HTMLSpanElement | null>(null);
  const settledRef = useRef(false);
  const skipRef = useRef(false);
  const [failed, setFailed] = useState(false);
  /**
   * The reveal has drawn its last frame. The canvas and scrim come out at that
   * point — the canvas is a full-viewport layer worth releasing — while the
   * title stays, owned by this component for as long as it is wanted.
   */
  const [drawn, setDrawn] = useState(false);

  const settle = useRef(onSettled);
  settle.current = onSettled;
  const wantsWordmark = useRef(showWordmark);
  wantsWordmark.current = showWordmark;
  const finish = useRef(onFinished);
  finish.current = onFinished;
  // once handed over, taps must reach the connect action underneath
  const [handedOver, setHandedOver] = useState(false);

  useEffect(() => {
    // Reduced motion never plays the ceremony: resolve immediately and let the
    // screen underneath present itself.
    if (reduceMotion) {
      // No ceremony, but the title is still this component's to hold.
      setDrawn(true);
      settle.current();
      if (!wantsWordmark.current) finish.current();
      return;
    }
    let raf = 0;
    let scene: BootRevealScene | null = null;
    let disposed = false;
    const onResize = () => scene?.resize();

    const fire = () => {
      if (settledRef.current) return;
      settledRef.current = true;
      setHandedOver(true);
      settle.current();
    };

    (async () => {
      let scenery: BootRevealScene;
      try {
        const imgs = await Promise.all(
          BLOCKS.map((b) => loadImage(getGuardianPortrait(b.zone))),
        );
        if (disposed) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        scenery = new BootRevealScene(
          canvas,
          BLOCKS.map((b, i) => ({ ...b, img: imgs[i] })),
          { accent: colours.accent },
        );
      } catch {
        // Art or context unavailable — never hold the app behind the intro.
        if (!disposed) {
          setFailed(true);
          fire();
          finish.current();
        }
        return;
      }
      scene = scenery;
      window.addEventListener("resize", onResize);

      const started = performance.now();
      /*
       * The title is gated, not switched. If the reconnect resolves while the
       * wordmark is already up, snapping it away would read as a glitch;
       * easing it out over a quarter second reads as it stepping aside for the
       * app underneath.
       */
      const gate = { value: wantsWordmark.current ? 1 : 0, from: 0, at: 0 };
      gate.from = gate.value;
      let lastWanted = wantsWordmark.current;
      const frame = (now: number) => {
        if (disposed) return;
        // a tap fast-forwards to the resolved moment
        const t = skipRef.current
          ? BEATS.settle
          : Math.min((now - started) / 1000, BEATS.end);
        scenery.draw(t);
        if (scrimRef.current) {
          scrimRef.current.style.opacity = String(
            BootRevealScene.scrimOpacity(t),
          );
        }
        if (wantsWordmark.current !== lastWanted) {
          lastWanted = wantsWordmark.current;
          gate.from = gate.value;
          gate.at = t;
        }
        gate.value =
          gate.from +
          ((lastWanted ? 1 : 0) - gate.from) *
            Math.min(1, Math.max(0, (t - gate.at) / 0.25));
        if (wordRef.current) {
          const w = BootRevealScene.wordmark(t);
          // This title stays for the overlay's whole life. The screen
          // underneath renders the identical title only once the overlay is
          // gone, so the swap lands at full opacity with no scrim over it.
          wordRef.current.style.opacity = String(w.opacity * gate.value);
          wordRef.current.style.transform = `scale(${w.scale.toFixed(3)}) translateY(${w.y.toFixed(2)}px)`;
          wordRef.current.style.filter = w.blur
            ? `blur(${w.blur.toFixed(2)}px)`
            : "none";
        }
        if (t >= BEATS.settle) fire();
        if (t < BEATS.end) raf = requestAnimationFrame(frame);
        else {
          setDrawn(true);
          // Hold the overlay while the title is wanted; the title's own fade
          // (below) releases it once it is not.
          if (!wantsWordmark.current) finish.current();
        }
      };
      raf = requestAnimationFrame(frame);
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [reduceMotion, colours.accent]);

  if (failed) return null;

  return (
    <div
      className={handedOver || drawn ? "br-root br-inert" : "br-root"}
      onPointerDown={() => {
        skipRef.current = true;
      }}
    >
      {/* Released once the reveal has drawn its last frame: a full-viewport
          canvas and an invisible scrim are not worth keeping around. */}
      {drawn ? null : (
        <>
          <div ref={scrimRef} className="br-scrim" />
          <canvas ref={canvasRef} className="br-canvas" />
        </>
      )}
      <div className="br-wordmark">
        <span
          ref={wordRef}
          className={WORDMARK_CLASS}
          // Once drawn, the title is a plain fading element: it holds while it
          // is wanted and releases the overlay when it is not, so no other
          // element ever has to reproduce its exact pixels.
          style={
            drawn
              ? {
                  opacity: showWordmark ? 1 : 0,
                  transition: reduceMotion ? undefined : "opacity 0.25s linear",
                }
              : { opacity: 0 }
          }
          onTransitionEnd={() => {
            if (!showWordmark) finish.current();
          }}
        >
          zKube
        </span>
      </div>
    </div>
  );
}
