import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";

import { getGuardianPortrait } from "@/config/bossCharacters";
import { GUARDIAN_FACE_CROPS } from "@/config/guardianBlocks";
import { useThemeColors } from "@/ui/elements/theme-provider/hooks";
import { BEATS, BootRevealScene } from "@/ui/components/shared/bootRevealScene";

import "./bootReveal.css";

/**
 * The boot reveal: the app icon assembles itself, the hero block slides in to
 * complete it, and the finished composition detonates into confetti while the
 * app appears underneath.
 *
 * It renders as a full-screen overlay rather than inside a screen, so the
 * debris can carry over whatever mounted behind it — the landing lobby for a
 * new player, or the app itself for one who is already connected.
 *
 * The three blocks are the same guardians, in the same arrangement, as the
 * shipped app icon: tapping the icon and watching it assemble is one gesture.
 * The wordmark is deliberately NOT part of the ceremony: the zKube title is
 * static page chrome above the marquee, and it never moves or hands over.
 */

// zone ids of the icon trio — Mamba (Tribal), Kitsune (Japan), Sobek (Egypt)
const MAMBA_ZONE = 9;
const KITSUNE_ZONE = 7;
const SOBEK_ZONE = 2;

// Crops come from the shared guardian-block config: full head, top and bottom
// always inside the window.
const BLOCKS = [
  {
    zone: MAMBA_ZONE,
    crop: GUARDIAN_FACE_CROPS[MAMBA_ZONE],
    base: "#2FCFC0",
    x: 4,
    y: 4,
    s: 82,
    rot: -13,
    role: "dropA" as const,
  },
  {
    zone: KITSUNE_ZONE,
    crop: GUARDIAN_FACE_CROPS[KITSUNE_ZONE],
    base: "#E8455E",
    x: 114,
    y: 114,
    s: 82,
    rot: 12,
    role: "dropB" as const,
  },
  {
    zone: SOBEK_ZONE,
    crop: GUARDIAN_FACE_CROPS[SOBEK_ZONE],
    base: "#E8C86A",
    x: 50,
    y: 52,
    s: 100,
    rot: -3,
    role: "slide" as const,
  },
];

/**
 * The boot clock belongs to the page load, not to a mount.
 *
 * React remounts the tree in development, which would otherwise restart the
 * reveal partway through — blocks falling, then snapping back to the beginning.
 * Production does not double-mount, so the bug is invisible there, which is
 * precisely why it is worth removing: what is seen locally should be what
 * ships. Anchoring the clock here also means a remount after the reveal has
 * finished resumes at the end rather than replaying it.
 */
let bootClockStart: number | null = null;

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
  /** Nothing of the reveal remains to be drawn, so it can be torn down. */
  onFinished: () => void;
}

export default function BootReveal({ onSettled, onFinished }: BootRevealProps) {
  const colours = useThemeColors();
  const reduceMotion = useReducedMotion();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scrimRef = useRef<HTMLDivElement | null>(null);
  const settledRef = useRef(false);
  const skipRef = useRef(false);
  const [failed, setFailed] = useState(false);
  /**
   * The reveal has drawn its last frame. The canvas and scrim come out at that
   * point — the canvas is a full-viewport layer worth releasing.
   */
  const [drawn, setDrawn] = useState(false);

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
      setDrawn(true);
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

      bootClockStart ??= performance.now();
      const started = bootClockStart;
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
        if (t >= BEATS.settle) fire();
        if (t < BEATS.end) raf = requestAnimationFrame(frame);
        else {
          setDrawn(true);
          finish.current();
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
    </div>
  );
}
