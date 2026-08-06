#!/usr/bin/env node
/**
 * Guardian expression-frame generator (Ace-Attorney talk sprites).
 *
 * Generates per-guardian expression frames by conditioning fal.ai flux-2-pro
 * on the SHIPPED boss portrait (client/public/assets/theme-N/boss/portrait.png),
 * so every frame keeps the canonical identity, composition and palette. Frames
 * land next to the portrait as boss/<state>.png and are picked up by
 * getGuardianFrame() with a graceful fallback to the static portrait.
 *
 * Usage:
 *   node client/tools/sprites/generate-guardian-frames.mjs --zone 2 --state talk-open
 *   node client/tools/sprites/generate-guardian-frames.mjs --zone 2 --all
 *
 * FAL_KEY is read from ~/zkube/.env (the asset-pipeline home) or the
 * environment. It is never printed.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = join(HERE, "..", "..");

// NOTE: plain flux-2-pro is text-to-image ONLY (no image input in its schema).
// Every entry here is a verified reference-image editor on fal; input shapes
// differ per endpoint (checked against fal's OpenAPI).
const MODELS = {
  flux2: {
    endpoint: "fal-ai/flux-2-pro/edit",
    input: (prompt, reference, seed) => ({
      prompt,
      image_urls: [reference],
      image_size: { width: 512, height: 512 },
      seed,
      output_format: "png",
    }),
  },
  kontext: {
    endpoint: "fal-ai/flux-pro/kontext",
    input: (prompt, reference, seed) => ({
      prompt,
      image_url: reference,
      aspect_ratio: "1:1",
      seed,
      output_format: "png",
    }),
  },
  banana: {
    endpoint: "fal-ai/nano-banana/edit",
    input: (prompt, reference, seed) => ({
      prompt,
      image_urls: [reference],
      aspect_ratio: "1:1",
      seed,
      output_format: "png",
    }),
  },
};

const BIREFNET = "fal-ai/birefnet/v2";

/**
 * What changes per state, relative to the shipped portrait. Everything else is
 * pinned by the edit preamble below. Wording is per-guardian-agnostic where
 * possible; guardian-specific anatomy (jaws vs beak) comes from the subject.
 */
const STATES = {
  idle: "the mouth is fully closed and both eyes are open, calm and watchful",
  "talk-open": "the mouth is open wide, showing teeth",
  "talk-mid": "the mouth is slightly parted",
  blink: "both eyes are fully closed",
  celebrate:
    "the head is raised triumphantly, eyes blazing bright, the aura around it flaring stronger",
  satisfied:
    "the mouth is fully closed and both eyes are half-closed in a contented, satisfied expression",
  greeting:
    "the head is tilted slightly downward in a welcoming bow, eyes open and warm, a calm inviting expression",
  defeated:
    "the head hangs low, eyes dimmed and half-closed, the aura around it faded, a humbled defeated expression",
};

// Beaked guardians: "mouth … showing teeth" destroys bird anatomy (Noctua once
// grew a giant toothy maw where its face was). Their talk states speak beak.
const STATE_OVERRIDES = {
  4: {
    "talk-open":
      "the beak is open wide mid-call, in the exact same crisp cel-shaded style with bold clean outlines as the reference, not painterly",
    "talk-mid":
      "the beak is slightly parted, in the exact same crisp cel-shaded style with bold clean outlines as the reference, not painterly",
  },
  10: {
    "talk-open": "the beak is open wide mid-call",
    "talk-mid": "the beak is slightly parted",
  },
};

// Hard style lock. Loose wording here restyles the moody painted portraits
// into flat sticker cartoons and goes full-body ("mid-speech" once conjured a
// speech bubble) — keep this preamble aggressive about preserving the source.
const EDIT_PREAMBLE =
  "Edit the reference image. Keep the exact same character, identity, pose, composition, framing, scale, background, colors, lighting, shading and painting style — the moody dark painted look must be preserved exactly. Do not restyle, simplify, cartoonify, brighten, or redraw the body. Never add speech bubbles, text, or new objects. The ONLY change:";

function parseArgs(argv) {
  const args = {
    zone: null,
    states: [],
    dryRun: false,
    model: "flux2",
    suffix: null,
    cutout: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--zone") args.zone = Number(argv[++i]);
    else if (a === "--state") args.states.push(argv[++i]);
    else if (a === "--all") args.states = Object.keys(STATES);
    else if (a === "--model") args.model = argv[++i];
    else if (a === "--suffix") args.suffix = argv[++i];
    else if (a === "--cutout") args.cutout = true;
    else if (a === "--dry-run") args.dryRun = true;
    else throw new Error(`unknown arg: ${a}`);
  }
  if (!args.zone || args.zone < 1 || args.zone > 10) {
    throw new Error("--zone 1..10 required");
  }
  if (args.states.length === 0) throw new Error("--state <name> or --all required");
  for (const s of args.states) {
    if (!STATES[s]) throw new Error(`unknown state ${s}; have: ${Object.keys(STATES).join(", ")}`);
  }
  if (!MODELS[args.model]) {
    throw new Error(`unknown model ${args.model}; have: ${Object.keys(MODELS).join(", ")}`);
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

function portraitDataUri(zone) {
  const path = join(CLIENT_ROOT, "public", "assets", `theme-${zone}`, "boss", "portrait.png");
  const bytes = readFileSync(path);
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

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
  const deadline = Date.now() + 240_000;
  for (;;) {
    if (Date.now() > deadline) throw new Error("generation timed out");
    await new Promise((r) => setTimeout(r, 2_500));
    const st = await fetch(statusUrl, { headers: { Authorization: `Key ${key}` } });
    const status = (await st.json()).status;
    if (status === "COMPLETED") break;
    if (status === "FAILED" || status === "CANCELLED") {
      throw new Error(`generation ${status}`);
    }
  }
  const res = await fetch(responseUrl, { headers: { Authorization: `Key ${key}` } });
  if (!res.ok) throw new Error(`result fetch failed: ${res.status}`);
  return res.json();
}

const { zone, states, dryRun, model, suffix, cutout } = parseArgs(process.argv);
const key = loadFalKey();
const reference = portraitDataUri(zone);
const outDir = join(CLIENT_ROOT, "public", "assets", `theme-${zone}`, "boss");
mkdirSync(outDir, { recursive: true });

for (const state of states) {
  const stateText = STATE_OVERRIDES[zone]?.[state] ?? STATES[state];
  const prompt = `${EDIT_PREAMBLE} ${stateText}.`;
  const stem = suffix ? `${state}.${suffix}` : state;
  const outPath = join(outDir, `${stem}.png`);
  console.log(`[zone ${zone}] ${state} (${model}) -> ${outPath}`);
  if (dryRun) {
    console.log(`  prompt: ${prompt}`);
    continue;
  }
  // One stable seed per guardian keeps reruns reproducible.
  const spec = MODELS[model];
  const result = await falQueue(
    key,
    spec.endpoint,
    spec.input(prompt, reference, 700 + zone),
  );
  const url = result?.images?.[0]?.url;
  if (!url) throw new Error(`no image in result: ${JSON.stringify(Object.keys(result ?? {}))}`);
  const img = await fetch(url);
  if (!img.ok) throw new Error(`image download failed: ${img.status}`);
  writeFileSync(outPath, Buffer.from(await img.arrayBuffer()));
  console.log(`  saved (${existsSync(outPath) ? readFileSync(outPath).length : 0} bytes)`);

  if (cutout) {
    // Chain BiRefNet on the fal-hosted result URL (no re-upload needed) for a
    // transparent character cutout alongside the painted frame.
    const matte = await falQueue(key, BIREFNET, {
      image_url: url,
      model: "General Use (Heavy)",
      operating_resolution: "1024x1024",
      refine_foreground: true,
      output_format: "png",
    });
    const matteUrl = matte?.image?.url;
    if (!matteUrl) throw new Error("no cutout in BiRefNet result");
    const alpha = await fetch(matteUrl);
    if (!alpha.ok) throw new Error(`cutout download failed: ${alpha.status}`);
    const alphaPath = join(outDir, `${stem}-alpha.png`);
    writeFileSync(alphaPath, Buffer.from(await alpha.arrayBuffer()));
    console.log(`  cutout saved -> ${alphaPath}`);
  }
}
