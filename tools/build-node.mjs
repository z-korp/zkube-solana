import { cpSync } from "node:fs";

cpSync(new URL("../services/zkube-core", import.meta.url),
  new URL("../dist/services/zkube-core", import.meta.url), { recursive: true });
