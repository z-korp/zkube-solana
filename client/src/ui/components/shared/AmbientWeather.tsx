import { useEffect, useRef } from "react";
import { useReducedMotion } from "motion/react";

import { getThemeColors } from "@/config/themes";
import { useTheme } from "@/ui/elements/theme-provider/hooks";
import { cn } from "@/ui/utils";

type Weather = "snow" | "petal" | "sand" | "rise" | "float";

/**
 * Per-zone ambient weather on a single lightweight canvas. Purely atmospheric
 * and pointer-transparent; it reads the active theme's particle palette so it
 * retints automatically when the zone changes (snow in Norse, blowing sand in
 * Egypt/Inca, drifting petals in Japan, rising motes in Tiki/China/Maya).
 * Disabled entirely under reduced-motion and paused while the tab is hidden.
 */
const WEATHER_BY_THEME: Record<string, Weather> = {
  "theme-1": "rise", // Tiki — sea spray / bubbles
  "theme-2": "sand", // Egypt — blowing sand
  "theme-3": "snow", // Norse — snow
  "theme-4": "float", // Greece — marble dust
  "theme-5": "rise", // China — jade embers
  "theme-6": "float", // Persia — cobalt motes
  "theme-7": "petal", // Japan — falling petals
  "theme-8": "rise", // Maya — fireflies
  "theme-9": "sand", // Tribal — dust
  "theme-10": "sand", // Inca — dust
};

interface Particle {
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
  a: number;
  sway: number;
  phase: number;
  rot: number;
  vr: number;
  color: string;
}

interface AmbientWeatherProps {
  /** Positioning/z layer. Defaults to a fixed full-screen layer behind content. */
  className?: string;
  /** Particle count; scaled down automatically on small screens. */
  density?: number;
}

const AmbientWeather: React.FC<AmbientWeatherProps> = ({
  className,
  density = 64,
}) => {
  const { themeTemplate } = useTheme();
  const reduce = useReducedMotion();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (reduce) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const kind = WEATHER_BY_THEME[themeTemplate] ?? "float";
    const themePalette = getThemeColors(themeTemplate).particles?.primary;
    const palette =
      themePalette && themePalette.length ? themePalette : ["#ffffff"];
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0;
    let h = 0;

    const rand = (a: number, b: number) => a + Math.random() * (b - a);
    const pick = () => palette[Math.floor(Math.random() * palette.length)]!;

    const spawn = (seeded: boolean): Particle => {
      const rising = kind === "rise";
      return {
        x: rand(0, w || 1),
        y: seeded ? rand(0, h || 1) : rising ? h + 10 : -10,
        r:
          kind === "sand"
            ? rand(0.6, 1.8)
            : rand(1.2, kind === "snow" ? 3.2 : 2.6),
        vx: kind === "sand" ? rand(0.5, 1.5) : rand(-0.25, 0.25),
        vy: rising
          ? rand(-0.7, -0.3)
          : rand(0.3, kind === "snow" ? 1.1 : 0.75),
        a: rand(0.22, 0.66),
        sway: rand(6, 22),
        phase: rand(0, Math.PI * 2),
        rot: rand(0, Math.PI * 2),
        vr: rand(-0.02, 0.02),
        color: pick(),
      };
    };

    const count = Math.max(
      16,
      Math.round(density * (window.innerWidth < 480 ? 0.55 : 1)),
    );
    let particles: Particle[] = [];

    const resize = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    particles = Array.from({ length: count }, () => spawn(true));

    let raf = 0;
    let last = 0;
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden) {
        last = 0;
        return;
      }
      const dt = last ? Math.min((t - last) / 16.67, 3) : 1;
      last = t;
      ctx.clearRect(0, 0, w, h);
      for (const p of particles) {
        p.phase += 0.01 * dt;
        p.x += (p.vx + Math.sin(p.phase) * (p.sway * 0.02)) * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        if (p.y < -14 || p.y > h + 14 || p.x < -24 || p.x > w + 24) {
          Object.assign(p, spawn(false));
        }
        ctx.globalAlpha = p.a;
        ctx.fillStyle = p.color;
        if (kind === "petal") {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.beginPath();
          ctx.ellipse(0, 0, p.r * 1.7, p.r * 0.7, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        } else {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    };
    raf = requestAnimationFrame(draw);
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [themeTemplate, reduce, density]);

  if (reduce) return null;
  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={cn(
        "pointer-events-none fixed inset-0 -z-10 h-full w-full",
        className,
      )}
    />
  );
};

export default AmbientWeather;
