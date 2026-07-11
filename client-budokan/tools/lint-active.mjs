import { spawnSync } from "node:child_process";
import path from "node:path";

const cwd = process.cwd();
const tsc = path.join(cwd, "node_modules", ".bin", "tsc");
const eslint = path.join(cwd, "node_modules", ".bin", "eslint");
const projects = ["tsconfig.app.json", "tsconfig.tools.json"];
const outputs = projects.map((project) => spawnSync(
  tsc,
  ["-p", project, "--listFilesOnly", "--pretty", "false"],
  { cwd, encoding: "utf8" },
));
for (const listed of outputs) {
  if (listed.status !== 0) {
    process.stderr.write(listed.stderr || listed.stdout);
    process.exit(listed.status ?? 1);
  }
}
const roots = [
  path.join(cwd, "src") + path.sep,
  path.join(cwd, "api") + path.sep,
  path.join(cwd, "tools") + path.sep,
];
const files = [...new Set(outputs.flatMap((listed) => listed.stdout
  .split(/\r?\n/)
  .filter((file) => roots.some((root) => file.startsWith(root)))
  .filter((file) => /\.(ts|tsx)$/.test(file) && !file.endsWith(".d.ts"))))];
const result = spawnSync(eslint, [
  ...files,
  "--report-unused-disable-directives",
  "--max-warnings",
  "0",
], { cwd, stdio: "inherit" });
process.exit(result.status ?? 1);
