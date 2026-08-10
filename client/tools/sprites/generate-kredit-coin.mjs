#!/usr/bin/env node
/**
 * Kredit token generator — GPT Image 2, conditioned on the shipped app icon.
 *
 * The Kredit is the one piece of currency art that must belong to no realm.
 * A guardian-mask token reads as that guardian's realm, which privileges one
 * of ten; the token instead wears the game's own block furniture, the same
 * language the app icon and every guardian block already speak.
 *
 * It also has to survive being drawn at 15px in a balance chip, so the brief
 * is deliberately low-detail: one silhouette, one emblem, one gloss.
 *
 * Usage:
 *   node client/tools/sprites/generate-kredit-coin.mjs --out /tmp/kredit
 *   node client/tools/sprites/generate-kredit-coin.mjs --out /tmp/kredit --variant block
 *
 * FAL_KEY is read from ~/zkube/.env or the environment. It is never printed.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = join(HERE, "..", "..");
const GPT_EDIT = "openai/gpt-image-2/edit";

/** Shared across variants: what makes it ours, and what makes it legible. */
const HOUSE_STYLE =
  "The reference image shows this game's art language: glossy chunky blocks " +
  "with thick white sticker rims, saturated colors, bold clean outlines, " +
  "cel-shaded dimensional gloss. Match that language exactly. Draw a single " +
  "arcade token coin, perfectly circular, filling the frame, viewed straight " +
  "on with no perspective tilt. Rich gold body: bright warm gold highlight " +
  "at the top left falling to deep amber at the bottom right, a thick " +
  "bevelled rim catching light, and one broad glossy highlight arc across " +
  "the upper third. Keep it BOLD and SIMPLE — it will be displayed as small " +
  "as sixteen pixels, so no fine filigree, no small repeating ornament, no " +
  "engraved texture, no lettering and no numerals anywhere. Do not include " +
  "any animal, creature, face, mask or character. No cultural or regional " +
  "ornament of any kind. Fully transparent background outside the coin's " +
  "circle. No text, no watermark, no drop shadow on the background.";

const VARIANTS = {
  /** The game's own furniture, embossed. Reads as "this buys a game". */
  block:
    "At the center of the coin, one chunky rounded-square game block is " +
    "embossed in relief, filling roughly half the coin's diameter — the same " +
    "rounded-square silhouette as the blocks in the reference image, raised " +
    "from the gold surface and catching the same light as the rim. The block " +
    "is gold like the rest of the coin, defined by its bevel and shadow " +
    "rather than by a different color.",
  /** Three blocks falling — the game's verb rather than its noun. */
  stack:
    "At the center of the coin, three chunky rounded-square game blocks are " +
    "embossed in relief in a descending diagonal, together filling roughly " +
    "two thirds of the coin's diameter. They are gold like the rest of the " +
    "coin, defined by bevel and shadow rather than by a different color.",
  /** A plain struck token: rim, inner ring, nothing else. */
  plain:
    "The coin's face is plain struck gold: a thick outer bevelled rim, one " +
    "smooth recessed inner disc, and nothing else on it at all — no emblem, " +
    "no symbol, no pattern.",
};

function parseArgs(argv) {
  const args = { out: null, variants: [], dryRun: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--out") args.out = argv[++i];
    else if (a === "--variant") args.variants.push(argv[++i]);
    else if (a === "--dry-run") args.dryRun = true;
    else throw new Error(`unknown arg: ${a}`);
  }
  if (!args.out) throw new Error("--out <dir> required");
  if (args.variants.length === 0) args.variants = Object.keys(VARIANTS);
  for (const v of args.variants) {
    if (!VARIANTS[v]) {
      throw new Error(`unknown variant ${v}; have: ${Object.keys(VARIANTS).join(", ")}`);
    }
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

const { out, variants, dryRun } = parseArgs(process.argv);
const key = loadFalKey();
mkdirSync(out, { recursive: true });

const reference = join(CLIENT_ROOT, "public", "assets", "pwa-512x512.png");

for (const name of variants) {
  const prompt = `${HOUSE_STYLE} ${VARIANTS[name]}`;
  const outPath = join(out, `${name}.png`);
  console.log(`[kredit] ${name} -> ${outPath}`);
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
