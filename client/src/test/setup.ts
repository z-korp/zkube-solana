import { beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import "@testing-library/jest-dom";
import { vi } from "vitest";
import { initializeZkubeCoreSync } from "@/core/zkubeCore";

initializeZkubeCoreSync(
  readFileSync(resolve(process.cwd(), "src/core/generated/zkube_core_bg.wasm")),
);

beforeEach(() => {
  vi.spyOn(Math, "random").mockImplementation(() => 0.5);
  vi.spyOn(Date, "now").mockImplementation(() => 1234567890);
});

afterEach(() => {
  vi.restoreAllMocks();
});
