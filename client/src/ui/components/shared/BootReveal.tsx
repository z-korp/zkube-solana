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
   * The sequence has handed over: show the connect action, or let a connected
   * player through. Debris is still falling at this point.
   */
  onSettled: () => void;
  /**
   * Every last particle has cleared and the overlay can be torn down. Kept
   * separate from `onSettled` because the world's fade outlasts the handoff,
   * and unmounting mid-fade would drop it in a single frame.
   */
  onFinished: () => void;
}

export default function BootReveal({ onSettled, onFinished }: BootRevealProps) {
  const colours = useThemeColors();
  const reduceMotion = useReducedMotion();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scrimRef = useRef<HTMLDivElement | null>(null);
  const wordRef = useRef<HTMLSpanElement | null>(null);
  const settledRef = useRef(false);
  const skipRef = useRef(false);
  const [failed, setFailed] = useState(false);

  const settle = useRef(onSettled);
  settle.current = onSettled;
  const finish = useRef(onFinished);
  finish.current = onFinished;
  // once handed over, taps must reach the connect action underneath
  const [handedOver, setHandedOver] = useState(false);

  useEffect(() => {
    // Reduced motion never plays the ceremony: resolve immediately and let the
    // screen underneath present itself.
    if (reduceMotion) {
      settle.current();
      finish.current();
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
        if (wordRef.current) {
          const w = BootRevealScene.wordmark(t);
          // This title stays for the overlay's whole life. The screen
          // underneath renders the identical title only once the overlay is
          // gone, so the swap lands at full opacity with no scrim over it.
          wordRef.current.style.opacity = String(w.opacity);
          wordRef.current.style.transform = `scale(${w.scale.toFixed(3)}) translateY(${w.y.toFixed(2)}px)`;
          wordRef.current.style.filter = w.blur
            ? `blur(${w.blur.toFixed(2)}px)`
            : "none";
        }
        if (t >= BEATS.settle) fire();
        if (t < BEATS.end) raf = requestAnimationFrame(frame);
        else finish.current();
      };
      raf = requestAnimationFrame(frame);
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [reduceMotion, colours.accent]);

  if (reduceMotion || failed) return null;

  return (
    <div
      className={handedOver ? "br-root br-inert" : "br-root"}
      onPointerDown={() => {
        skipRef.current = true;
      }}
    >
      <div ref={scrimRef} className="br-scrim" />
      <canvas ref={canvasRef} className="br-canvas" />
      <div className="br-wordmark">
        <span ref={wordRef} className={WORDMARK_CLASS} style={{ opacity: 0 }}>
          zKube
        </span>
      </div>
    </div>
  );
}

/** The settled title, shown by the connect screen once the reveal resolves. */
export function BootTitle() {
  return (
    <div className="br-title">
      <span className={WORDMARK_CLASS}>zKube</span>
    </div>
  );
}
