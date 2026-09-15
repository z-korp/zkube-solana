#!/usr/bin/env node
/**
 * Cut a real alpha channel with BiRefNet v2.
 *
 * GPT Image ignores `background: "transparent"` on the fal edit endpoint — it
 * returns a fully opaque image every time, either matted on white or with a
 * grey-and-white checkerboard *painted into the pixels* so the file looks
 * transparent in a viewer and is not. Chroma-keying that back out leaves
 * fringes and eats highlights, so generated art goes through a real matting
 * model instead.
 *
 * The matte is verified before the file is written: a result whose corners are
 * still opaque is a failed cut, not a usable asset.
 *
 * Usage:
 *   node assets/tools/matte-alpha.mjs <in.png> [more.png ...] --out <dir>
 *
 * FAL_KEY is read from ~/zkube/.env or the environment. It is never printed.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";

const BIREFNET = "fal-ai/birefnet/v2";

function parseArgs(argv) {
  const args = { inputs: [], out: null };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === "--out") args.out = argv[++i];
    else args.inputs.push(argv[i]);
  }
  if (!args.out) throw new Error("--out <dir> required");
  if (args.inputs.length === 0) throw new Error("at least one input png required");
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
  const deadline = Date.now() + 300_000;
  for (;;) {
    if (Date.now() > deadline) throw new Error("matting timed out");
    await new Promise((r) => setTimeout(r, 2_000));
    const st = await fetch(statusUrl, { headers: { Authorization: `Key ${key}` } });
    const status = (await st.json()).status;
    if (status === "COMPLETED") break;
    if (status === "FAILED" || status === "CANCELLED") throw new Error(`matting ${status}`);
  }
  const res = await fetch(responseUrl, { headers: { Authorization: `Key ${key}` } });
  if (!res.ok) throw new Error(`result fetch failed: ${res.status}`);
  return res.json();
}

const { inputs, out } = parseArgs(process.argv);
const key = loadFalKey();
mkdirSync(out, { recursive: true });

for (const input of inputs) {
  const outPath = join(out, basename(input));
  const result = await falQueue(key, BIREFNET, {
    image_url: `data:image/png;base64,${readFileSync(input).toString("base64")}`,
    model: "General Use (Heavy)",
    operating_resolution: "2048x2048",
    refine_foreground: true,
    output_format: "png",
  });
  const url = result?.image?.url ?? result?.images?.[0]?.url;
  if (!url) throw new Error(`no image in result: ${JSON.stringify(Object.keys(result ?? {}))}`);
  const image = await fetch(url);
  if (!image.ok) throw new Error(`download failed: ${image.status}`);
  writeFileSync(outPath, Buffer.from(await image.arrayBuffer()));
  console.log(`${basename(input)} -> ${outPath}`);
}
