#!/usr/bin/env node
/**
 * Standalone game art generator — GPT Image 2, conditioned on the app icon.
 *
 * Covers every piece of art that is not a guardian rig frame: the Kredit
 * token, the ladder tier borders, and the two Campaign mastery crests. They
 * share one brief (the block furniture the app icon established) and one set
 * of fal plumbing, so a fourth subject is a table entry rather than a fourth
 * copy of this file.
 *
 * **Output is always opaque.** The fal edit endpoint ignores
 * `background: "transparent"` — verified across a dozen generations, it comes
 * back either matted on white or with a checkerboard *painted into the
 * pixels*. Every subject here therefore goes through `matte-alpha.mjs`
 * (BiRefNet v2) before install. Do not chroma-key it: that leaves fringes and
 * eats the white highlights inside the ornament.
 *
 * Usage:
 *   node client/tools/sprites/generate-art.mjs --out /tmp/art
 *   node client/tools/sprites/generate-art.mjs --out /tmp/art --subject tier-3
 *   node client/tools/sprites/generate-art.mjs --out /tmp/art --list
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
 * What every piece of art in this game has in common.
 *
 * Note what is NOT here: any mention of transparency. Asking for a
 * transparent background makes the model *draw* one — that is where the
 * painted checkerboards came from. Backgrounds are cut afterwards by a real
 * matting model, so the prompt asks for a plain background and stops.
 */
const HOUSE_STYLE =
  "The reference image shows this game's art language: chunky glossy shapes, " +
  "saturated colors, bold clean outlines, cel-shaded dimensional lighting. " +
  "Match that language — chunky and readable, never painterly or filigreed. " +
  "Place the subject alone and centered on a plain flat mid-grey background " +
  "with nothing else in the frame. No text, no numerals, no letters, no " +
  "watermark.";

/** A rank border: ornament only, with a large empty middle. */
const frame = (brief) =>
  "Draw ONLY an ornamental rank border: a decorative frame surrounding a " +
  "large square opening at the center. The opening is completely empty — no " +
  "character, no face, no animal, no portrait, no pattern — showing the plain " +
  "background through the middle two thirds of the image. The ornament stays " +
  "in the outer margin and is perfectly symmetrical left to right. " +
  brief;

const SUBJECTS = {
  "kredit-block":
    "Draw a single arcade token coin, perfectly circular, filling the frame, " +
    "viewed straight on with no perspective tilt. Rich gold body: bright warm " +
    "gold highlight at the top left falling to deep amber at the bottom " +
    "right, a thick bevelled rim catching light, and one broad glossy " +
    "highlight arc across the upper third. At its center one chunky " +
    "rounded-square game block is embossed in relief, filling roughly half " +
    "the coin's diameter, gold like the rest and defined by its bevel and " +
    "shadow. Keep it BOLD and SIMPLE — it will be displayed as small as " +
    "sixteen pixels, so no fine filigree, no small repeating ornament, no " +
    "engraved texture. No animal, creature, face or mask, and no cultural or " +
    "regional ornament of any kind.",

  "tier-0": frame(
    "A plain frame of dark grey weathered steel: a clean rounded-square band " +
      "of uniform thickness with one small square stud at each of the four " +
      "corners, and nothing else at all. Deliberately austere — this is the " +
      "lowest rank and must look modest beside the others.",
  ),
  "tier-1": frame(
    "A warm copper-bronze frame: a rounded-square band with modest curled " +
      "bronze flourishes sweeping outward from the two upper corners and a " +
      "small bronze crest centered on the bottom edge. Restrained.",
  ),
  "tier-2": frame(
    "A jade-green frame: a rounded-square band of dark metal wrapped in " +
      "carved jade leaves that rise from the lower corners and curl outward " +
      "at the top, with one polished green gem centered on the bottom edge " +
      "and a soft green glow.",
  ),
  "tier-3": frame(
    "An azure frame: a rounded-square band of polished blue steel with swept " +
      "wing-like fins flaring outward from the two upper corners, glowing " +
      "blue crystals set at the top center and bottom center, and a clear " +
      "blue glow around the ornament.",
  ),
  "tier-4": frame(
    "A violet frame, the highest rank and the most elaborate: a " +
      "rounded-square band of dark metal with large sweeping violet crystal " +
      "wings flaring outward from all four corners, a crown of violet shards " +
      "at the top center, and a bright violet glow radiating from the whole " +
      "ornament.",
  ),

  // The two Campaign mastery crests. Medallions, not frames: they hang on the
  // realm rack beside ten guardian blocks and are read at around thirty
  // pixels, so each needs one silhouette that survives at that size.
  "crest-realm":
    "Draw a single ornate gold medallion badge, filling the frame, viewed " +
    "straight on. A thick bevelled gold ring encloses a deep emerald-green " +
    "center, and a bold gold crown sits at the top of the ring, its points " +
    "rising clear above it. Two small gold laurel branches curve up the left " +
    "and right sides of the ring. Rich warm gold with a strong glossy " +
    "highlight across the upper left. This badge means every realm has been " +
    "conquered — it must read as a trophy at a glance. Bold and simple, no " +
    "fine filigree, no small repeating ornament, no animal and no face.",

  "crest-world":
    "Draw a single ornate medallion badge, filling the frame, viewed straight " +
    "on. A thick bevelled silver-white metal ring, and inside it one large " +
    "faceted gold star whose points reach the ring, seated on a solid deep " +
    "violet disc that completely fills the ring's interior. Small violet gems " +
    "are set into the ring at the top, bottom, left and right. Cool polished " +
    "silver-white metal with a strong glossy highlight across the upper left. " +
    "Every part of the badge is solid and opaque — no rays, no beams, no " +
    "glow spilling outside the ring, no wisps and no sparkles around it, " +
    "because anything detached from the badge is lost when the background is " +
    "removed. This badge means a perfect clear of the entire game — it must " +
    "read as the rarest thing a player owns. Bold and simple, no fine " +
    "filigree, no small repeating ornament, no animal and no face.",
};

function parseArgs(argv) {
  const args = { out: null, subjects: [], dryRun: false, list: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--out") args.out = argv[++i];
    else if (a === "--subject") args.subjects.push(argv[++i]);
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--list") args.list = true;
    else throw new Error(`unknown arg: ${a}`);
  }
  if (args.list) return args;
  if (!args.out) throw new Error("--out <dir> required");
  if (args.subjects.length === 0) args.subjects = Object.keys(SUBJECTS);
  for (const s of args.subjects) {
    if (!SUBJECTS[s]) {
      throw new Error(`unknown subject ${s}; have: ${Object.keys(SUBJECTS).join(", ")}`);
    }
  }
  return args;
}

function loadFalKey() {
  if (process.env.FAL_KEY) return process.env.FAL_KEY;
  const line = readFileSync(join(process.env.HOME, "zkube", ".env"), "utf8")
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

const { out, subjects, dryRun, list } = parseArgs(process.argv);
if (list) {
  console.log(Object.keys(SUBJECTS).join("\n"));
  process.exit(0);
}

const key = loadFalKey();
mkdirSync(out, { recursive: true });
const reference = join(CLIENT_ROOT, "public", "assets", "pwa-512x512.png");

for (const name of subjects) {
  const prompt = `${HOUSE_STYLE} ${SUBJECTS[name]}`;
  const outPath = join(out, `${name}.png`);
  console.log(`[art] ${name} -> ${outPath}`);
  if (dryRun) {
    console.log(`  prompt: ${prompt}`);
    continue;
  }
  const result = await falQueue(key, GPT_EDIT, {
    prompt,
    image_urls: [dataUri(reference)],
    image_size: { width: 1024, height: 1024 },
    quality: "high",
    output_format: "png",
  });
  const url = result?.images?.[0]?.url;
  if (!url) throw new Error(`no image in result: ${JSON.stringify(Object.keys(result ?? {}))}`);
  const image = await fetch(url);
  if (!image.ok) throw new Error(`image download failed: ${image.status}`);
  writeFileSync(outPath, Buffer.from(await image.arrayBuffer()));
  console.log("  saved (opaque — run matte-alpha.mjs next)");
}
