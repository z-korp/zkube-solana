import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
const probe = vi.hoisted(() => ({ raw: null as string | null, failRead: false, failWrite: false, writes: [] as Array<[string, string]> }));
vi.mock("@/platform/storage", () => ({ appStorage: () => ({
  getItem: () => { if (probe.failRead) throw new Error("read failed"); return probe.raw; },
  setItem: (key: string, value: string) => { probe.writes.push([key, value]); if (probe.failWrite) throw new Error("write failed"); probe.raw = value; },
}) }));
vi.mock("howler", () => ({ Howl: class {}, Howler: {} }));
vi.mock("@/contexts/hooks", () => ({ useMusicPlayer: () => { throw new Error("No component render in audio oracle"); } }));
vi.mock("@/ui/elements/theme-provider/hooks", () => ({ useThemeColors: () => { throw new Error("No component render in audio oracle"); } }));
import { produce, policyCode } from "./audio-fixtures";
describe("actual AudioManager persistence reference", () => {
  it("emits deterministic defaults, coercion, channel writes and generated policy", () => {
    const root = process.env.ZKUBE_AUDIO_REPO_ROOT ?? resolve(__dirname, "../../..");
    const fixture = produce(root, probe); const text = JSON.stringify(fixture, null, 2) + "\n";
    expect(JSON.stringify(produce(root, probe), null, 2) + "\n").toBe(text);
    const outputs = [
      [process.env.ZKUBE_AUDIO_FIXTURE_PATH ?? resolve(root, "fixtures/unity-audio-v1.json"), text],
      [process.env.ZKUBE_AUDIO_POLICY_PATH ?? resolve(root, "unity/Assets/ZKube/Generated/AudioPolicy.g.cs"), policyCode(fixture.policy)],
    ];
    for (const [path, contents] of outputs) {
      if (process.env.ZKUBE_WRITE_UNITY_FIXTURES === "1") writeFileSync(path, contents);
      expect(readFileSync(path, "utf8")).toBe(contents);
    }
    expect(fixture.changes.at(-1)?.failed).toBe(true);
    expect(fixture.changes.at(-1)?.expected.effectsVolume).toBe(.62);
  });
});
