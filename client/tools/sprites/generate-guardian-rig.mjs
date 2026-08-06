#!/usr/bin/env node
/**
 * Guardian rig generator — GPT Image 2 full-scene pipeline.
 *
 * Stages, each conditioned on the previous stage's output:
 *   base  portrait.png -> base.png       canonical 1024 full-scene master
 *   map   base.png     -> map.png        3x3 expression sheet (reference only)
 *   rig   base (+ map) -> <state>.png    one full-scene frame per rig state
 *
 * The master IS the idle frame (copied, not regenerated). Flip frames
 * (blink, talk-mid, talk-open) edit the master ALONE — a single reference
 * leaves the model nothing to reconcile framing against. Generated frames
 * are NOT pixel-stable on their own: after the rig stage, flip and
 * face-only frames must go through the scale-aware feathered-ellipse
 * compositor (composite-flips.py) against base.png before install, and every
 * frame is verified at full resolution by eye. Never slice map cells as
 * frames; never trust the API's mask_url for stability.
 *
 * Usage:
 *   node client/tools/sprites/generate-guardian-rig.mjs --zone 1 --out /tmp/mako --stage base
 *   node client/tools/sprites/generate-guardian-rig.mjs --zone 1 --out /tmp/mako --stage map
 *   node client/tools/sprites/generate-guardian-rig.mjs --zone 1 --out /tmp/mako --stage rig [--state idle ...]
 *
 * FAL_KEY is read from ~/zkube/.env (the asset-pipeline home) or the
 * environment. It is never printed.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = join(HERE, "..", "..");

const GPT_EDIT = "openai/gpt-image-2/edit";

/**
 * Rig states — the nine the client's GuardianFrameId union consumes. `map`
 * is the cell label lettered onto the expression sheet; `change` is the one
 * edit applied to the base when rendering the frame. Order here is the 3x3
 * sheet's reading order.
 */
const STATES = {
  idle: {
    map: "IDLE",
    change: "the mouth is fully closed and both eyes are open, calm and watchful",
  },
  blink: { map: "BLINK", flip: true, change: "both eyes are fully closed" },
  "talk-mid": {
    map: "TALK-MID",
    flip: true,
    change: "the mouth is slightly parted mid-word",
  },
  "talk-open": {
    map: "TALK-OPEN",
    flip: true,
    change: "the mouth is open wide mid-speech",
  },
  greeting: {
    map: "GREETING",
    change:
      "the head tilts slightly downward in a welcoming bow, eyes open and warm",
  },
  satisfied: {
    map: "SATISFIED",
    change:
      "the mouth is closed and both eyes are half-closed in a contented, satisfied expression",
  },
  celebrate: {
    map: "CELEBRATE",
    change:
      "the head is raised triumphantly, eyes blazing bright, the aura flaring stronger",
  },
  defeated: {
    map: "DEFEATED",
    change:
      "the head hangs low, eyes dimmed and half-closed, the aura faded, humbled",
  },
  surprised: {
    map: "SURPRISED",
    change: "both eyes wide open, mouth slightly agape in surprise",
  },
};

/**
 * Real-animal anatomy per guardian, injected into map and rig prompts.
 * flux once gave beaked Noctua a toothy maw and turtle Mako a shark grin —
 * the mouth is where expression edits break a species.
 */
const ANATOMY = {
  1: "sea-turtle anatomy: a beak-like mouth with no teeth",
  2: "crocodile anatomy: a long armored snout with interlocking teeth",
  3: "wolf anatomy: a canine muzzle with fangs",
  4: "owl anatomy: a beak, never a toothed mouth",
  5: "dragon anatomy: a scaled reptilian muzzle on exactly one head",
  6: "winged-lion anatomy: a feline muzzle and exactly one pair of wings, each wing one connected structure",
  7: "fox anatomy: a slender canine muzzle",
  8: "jaguar anatomy: a feline muzzle with fangs",
  9: "snake anatomy: a fanged serpent mouth with a forked tongue",
  10: "condor anatomy: a hooked beak, never a toothed mouth",
};

const BASE_PROMPT =
  "Re-render the reference image as a clean master character sprite. Keep the " +
  "exact same character, identity, pose, composition, framing, colors and " +
  "crisp cel-shaded style with bold clean outlines and glowing accents — do " +
  "not restyle, simplify or go painterly. Depict the character exactly once " +
  "with its exact anatomy — one head, and if winged exactly one pair of " +
  "wings; never split, add or duplicate body parts. Neutral stance: both " +
  "eyes open, mouth fully closed. No text, no speech bubbles, no watermarks.";

const mapPrompt = (cells, anatomy) =>
  "Create a character expression animation sheet of the exact character in " +
  "the reference image, preserving its identity, colors and crisp cel-shaded " +
  "style with bold clean outlines exactly. A 3x3 grid of 9 equal square " +
  "cells, each a bust close-up of the character's head and upper chest. The " +
  "cells are animation frames meant to overlay each other exactly: the head " +
  "sits at the IDENTICAL position and scale in every cell, the same plain " +
  "dark background with the character's faint aura fills every cell " +
  "identically, and ONLY the facial expression changes between cells. " +
  "Absolutely no text, labels, captions or grid lines anywhere. Facial " +
  "geometry, proportions, colors and markings must remain identical in " +
  "every cell. Depict the character once per cell — one head, never " +
  "duplicated body parts. Every cell respects the character's real " +
  anatomy +
  ". The nine cells in reading order (left to right, top to bottom): " +
  cells.map((c, i) => `${i + 1}. ${c.map}: ${c.change}`).join("; ") +
  ".";

/** Flip frames edit the bust master alone — nothing to reconcile against. */
const flipPrompt = (state, anatomy) =>
  "The reference image is the character's bust master sprite. Redraw it " +
  "keeping the exact same character, identity, framing, scale, background, " +
  "aura, colors, lighting and crisp cel-shaded style — change nothing " +
  `except: ${state.change}. Depict the character exactly once — one head, ` +
  "and if winged exactly one pair of wings; never duplicate any body part. " +
  "Respect the character's real " +
  anatomy +
  ".";

const framePrompt = (state, anatomy) =>
  "Two reference images: the FIRST is the master character sprite, the SECOND " +
  "is that character's labeled expression sheet. Redraw the first image " +
  "keeping the exact same character, identity, pose, composition, framing, " +
  "scale, background, colors, lighting and crisp cel-shaded style — do not " +
  "restyle, simplify, go painterly, or add text, speech bubbles or new " +
  `objects. The ONLY change: ${state.change}, matching the expression shown ` +
  `in the sheet cell labeled "${state.map}". Depict the character exactly ` +
  "once — one head, and if winged exactly one pair of wings; never " +
  "duplicate any body part. Respect the character's real " +
  anatomy +
  ".";

function parseArgs(argv) {
  const args = { zone: null, stage: null, out: null, states: [], dryRun: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--zone") args.zone = Number(argv[++i]);
    else if (a === "--stage") args.stage = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--state") args.states.push(argv[++i]);
    else if (a === "--dry-run") args.dryRun = true;
    else throw new Error(`unknown arg: ${a}`);
  }
  if (!args.zone || args.zone < 1 || args.zone > 10) throw new Error("--zone 1..10 required");
  if (!["base", "map", "rig"].includes(args.stage)) throw new Error("--stage base|map|rig required");
  if (!args.out) throw new Error("--out <dir> required");
  if (args.states.length === 0 && args.stage === "rig") args.states = Object.keys(STATES);
  for (const s of args.states) {
    if (!STATES[s]) throw new Error(`unknown state ${s}; have: ${Object.keys(STATES).join(", ")}`);
  }
  return args;
}

function loadFalKey() {
  if (process.env.FAL_KEY) return process.env.FAL_KEY;
  const envPath = join(process.env.HOME, "zkube", ".env");
  const line = readFileSync(envPath, "utf8")
    .split("\n")
    .find((l) => l.startsWith("FAL_KEY="));
  if (!line) throw new Error("FAL_KEY not found in env or ~/zkube/.env");
  return line.slice("FAL_KEY=".length).trim().replace(/^["']|["']$/g, "");
}

const dataUri = (path) =>
  `data:image/png;base64,${readFileSync(path).toString("base64")}`;

async function falQueue(key, endpoint, input) {
  const submit = await fetch(`https://queue.fal.run/${endpoint}`, {
    method: "POST",
    headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!submit.ok) {
    throw new Error(`submit failed: ${submit.status} ${await submit.text()}`);
  }
  const { status_url: statusUrl, response_url: responseUrl } = await submit.json();
  const deadline = Date.now() + 360_000;
  for (;;) {
    if (Date.now() > deadline) throw new Error("generation timed out");
    await new Promise((r) => setTimeout(r, 2_500));
    const st = await fetch(statusUrl, { headers: { Authorization: `Key ${key}` } });
    const status = (await st.json()).status;
    if (status === "COMPLETED") break;
    if (status === "FAILED" || status === "CANCELLED") throw new Error(`generation ${status}`);
  }
  const res = await fetch(responseUrl, { headers: { Authorization: `Key ${key}` } });
  if (!res.ok) throw new Error(`result fetch failed: ${res.status}`);
  return res.json();
}

async function saveFirstImage(result, outPath) {
  const url = result?.images?.[0]?.url;
  if (!url) throw new Error(`no image in result: ${JSON.stringify(Object.keys(result ?? {}))}`);
  const img = await fetch(url);
  if (!img.ok) throw new Error(`image download failed: ${img.status}`);
  writeFileSync(outPath, Buffer.from(await img.arrayBuffer()));
  return url;
}

const { zone, stage, out, states, dryRun } = parseArgs(process.argv);
const key = loadFalKey();
mkdirSync(out, { recursive: true });

if (stage === "base") {
  const portrait = join(CLIENT_ROOT, "public", "assets", `theme-${zone}`, "boss", "portrait.png");
  const input = {
    prompt: BASE_PROMPT,
    image_urls: [dataUri(portrait)],
    image_size: { width: 1024, height: 1024 },
    quality: "high",
    output_format: "png",
  };
  console.log(`[zone ${zone}] base -> ${join(out, "base.png")}`);
  if (dryRun) {
    console.log(`  prompt: ${input.prompt}`);
  } else {
    await saveFirstImage(await falQueue(key, GPT_EDIT, input), join(out, "base.png"));
    console.log("  saved");
  }
} else if (stage === "map") {
  const input = {
    prompt: mapPrompt(Object.values(STATES), ANATOMY[zone]),
    image_urls: [dryRun ? "" : dataUri(join(out, "base.png"))],
    image_size: { width: 1536, height: 1536 },
    quality: "high",
    output_format: "png",
  };
  console.log(`[zone ${zone}] map -> ${join(out, "map.png")}`);
  if (dryRun) {
    console.log(`  prompt: ${input.prompt}`);
  } else {
    await saveFirstImage(await falQueue(key, GPT_EDIT, input), join(out, "map.png"));
    console.log("  saved");
  }
} else {
  const base = dryRun ? "" : dataUri(join(out, "base.png"));
  const map = dryRun ? "" : dataUri(join(out, "map.png"));
  for (const name of states) {
    const outPath = join(out, `${name}.png`);
    if (name === "idle") {
      // The bust master IS the idle frame.
      console.log(`[zone ${zone}] rig:idle (copy of base) -> ${outPath}`);
      if (!dryRun) writeFileSync(outPath, readFileSync(join(out, "base.png")));
      continue;
    }
    const state = STATES[name];
    const input = {
      prompt: state.flip
        ? flipPrompt(state, ANATOMY[zone])
        : framePrompt(state, ANATOMY[zone]),
      image_urls: state.flip ? [base] : [base, map],
      image_size: { width: 1024, height: 1024 },
      quality: "high",
      output_format: "png",
    };
    console.log(`[zone ${zone}] rig:${name} -> ${outPath}`);
    if (dryRun) {
      console.log(`  prompt: ${input.prompt}`);
      continue;
    }
    await saveFirstImage(await falQueue(key, GPT_EDIT, input), outPath);
    console.log("  saved");
  }
}
