import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const pairs = [
  ["target/idl/solana.json", "client/src/chain/idl/solana.json"],
  ["target/types/solana.ts", "client/src/chain/idl/solana.ts"],
];
const check = process.argv.includes("--check");

for (const [sourceRelative, destinationRelative] of pairs) {
  const source = resolve(root, sourceRelative);
  const destination = resolve(root, destinationRelative);
  const generated = await readFile(source, "utf8");
  if (check) {
    const committed = await readFile(destination, "utf8").catch(() => "");
    if (committed !== generated) {
      throw new Error(`${destinationRelative} is stale; run pnpm idl:sync after anchor build`);
    }
  } else {
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, generated);
  }
}
