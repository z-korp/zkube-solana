#!/usr/bin/env node
/**
 * Ladder tier frame generator — GPT Image 2, conditioned on the app icon.
 *
 * A frame, not a rim. Recolouring the guardian block's own sticker rim to
 * carry the tier fought the realm's colour and overwrote a border the block
 * already had; the rank instead gets its own ornament, sitting outside the
 * block the way a League of Legends level border sits outside a summoner
 * icon.
 *
 * The generated centre is deliberately not trusted: the client composites the
 * guardian block on top of it, so only the outer margin of each frame is ever
 * seen. What DOES matter is the background outside the ornament being cut
 * cleanly — `background: transparent` is honoured inconsistently, so
 * `--cut` re-keys a matte after the fact.
 *
 * Usage:
 *   node client/tools/sprites/generate-tier-frames.mjs --out /tmp/frames
 *   node client/tools/sprites/generate-tier-frames.mjs --out /tmp/frames --tier 4
 *
 * FAL_KEY is read from ~/zkube/.env or the environment. It is never printed.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = join(HERE, "..", "..");
const GPT_EDIT = "openai/gpt-image-2/edit";

/**
 * Shared brief. The opening is stated three ways on purpose — every early
 * attempt at this kind of prompt fills the middle with a character unless the
 * emptiness is over-specified.
 */
const HOUSE_STYLE =
  "The reference image shows this game's art language: chunky glossy shapes, " +
  "saturated colors, bold clean outlines, cel-shaded dimensional lighting. " +
  "Match that language — chunky and readable, never painterly or filigreed. " +
  "Draw ONLY an ornamental rank border: a decorative frame surrounding a " +
  "large empty square opening at the center. The opening is completely " +
  "empty: no character, no face, no animal, no portrait, no pattern, no " +
  "color and no background inside it — just empty transparent space taking " +
  "up the middle two thirds of the image. The ornament stays in the outer " +
  "margin and is perfectly symmetrical left to right. The area outside the " +
  "ornament is fully transparent. No text, no numerals, no letters, no " +
  "watermark, no drop shadow on the background.";

/** Five ranks, escalating in elaborateness the way the ladder escalates. */
const TIERS = [
  {
    index: 0,
    name: "slate",
    brief:
      "A plain frame of dark grey weathered steel: a clean rounded-square " +
      "band of uniform thickness with one small square stud at each of the " +
      "four corners, and nothing else at all. Deliberately austere — this is " +
      "the lowest rank and must look modest beside the others.",
  },
  {
    index: 1,
    name: "copper",
    brief:
      "A warm copper-bronze frame: a rounded-square band with modest curled " +
      "bronze flourishes sweeping outward from the two upper corners and a " +
      "small bronze crest centered on the bottom edge. Restrained.",
  },
  {
    index: 2,
    name: "jade",
    brief:
      "A jade-green frame: a rounded-square band of dark metal wrapped in " +
      "carved jade leaves that rise from the lower corners and curl outward " +
      "at the top, with one polished green gem centered on the bottom edge " +
      "and a soft green glow.",
  },
  {
    index: 3,
    name: "azure",
    brief:
      "An azure frame: a rounded-square band of polished blue steel with " +
      "swept wing-like fins flaring outward from the two upper corners, " +
      "glowing blue crystals set at the top center and bottom center, and a " +
      "clear blue glow around the ornament.",
  },
  {
    index: 4,
    name: "prism",
    brief:
      "A violet frame, the highest rank and the most elaborate: a " +
      "rounded-square band of dark metal with large sweeping violet crystal " +
      "wings flaring outward from all four corners, a crown of violet shards " +
      "at the top center, and a bright violet glow radiating from the whole " +
      "ornament.",
  },
];

function parseArgs(argv) {
  const args = { out: null, tiers: [], dryRun: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--out") args.out = argv[++i];
    else if (a === "--tier") args.tiers.push(Number(argv[++i]));
    else if (a === "--dry-run") args.dryRun = true;
    else throw new Error(`unknown arg: ${a}`);
  }
  if (!args.out) throw new Error("--out <dir> required");
  if (args.tiers.length === 0) args.tiers = TIERS.map((t) => t.index);
  for (const t of args.tiers) {
    if (!TIERS.some((tier) => tier.index === t)) throw new Error(`unknown tier ${t}`);
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
}

const { out, tiers, dryRun } = parseArgs(process.argv);
const key = loadFalKey();
mkdirSync(out, { recursive: true });

const reference = join(CLIENT_ROOT, "public", "assets", "pwa-512x512.png");

for (const index of tiers) {
  const tier = TIERS.find((t) => t.index === index);
  const prompt = `${HOUSE_STYLE} ${tier.brief}`;
  const outPath = join(out, `tier-${index}-${tier.name}.png`);
  console.log(`[tier ${index}] ${tier.name} -> ${outPath}`);
  if (dryRun) {
    console.log(`  prompt: ${prompt}`);
    continue;
  }
  await saveFirstImage(
    await falQueue(key, GPT_EDIT, {
      prompt,
      image_urls: [dataUri(reference)],
      image_size: { width: 1024, height: 1024 },
      quality: "high",
      output_format: "png",
      background: "transparent",
    }),
    outPath,
  );
  console.log("  saved");
}
