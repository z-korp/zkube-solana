import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AudioManager } from "@/audio/AudioManager";
import { saveAudioSettings } from "@/config/themes";
import { AUDIO_ON_LEVEL } from "@/ui/components/settings/AudioSettingsControls";

export interface StorageProbe { raw: string | null; failRead: boolean; failWrite: boolean; writes: Array<[string, string]> }
export function produce(root: string, storage: StorageProbe) {
  const reset = (raw: string | null, failRead = false) => {
    storage.raw = raw; storage.failRead = failRead; storage.failWrite = false; storage.writes = [];
  };
  const value = (audio: AudioManager) => ({ musicVolume: audio.musicVolume, effectsVolume: audio.effectsVolume });
  reset(null); const defaults = value(new AudioManager()); saveAudioSettings(defaults);
  const storageKey = storage.writes[0][0];
  const policy = { storageKey, ...defaults, toggleOnLevel: AUDIO_ON_LEVEL };
  const inputs: Array<{ name: string; raw: string | null; failRead?: boolean }> = [
    { name: "absent", raw: null }, { name: "empty", raw: "" }, { name: "read-failed", raw: '{"musicVolume":1}', failRead: true },
  ];
  for (const [index, raw] of ["null", "[]", "true", "5", '"text"', "{}", "{", '{"musicVolume":.2}', '{"musicVolume":1,}', '{"musicVolume":1/*x*/}', "{'musicVolume':1}",
    '{"musicVolume":1e400,"effectsVolume":-1e400}', '{"musicVolume":1e9999999999999999,"effectsVolume":1e-9999999999999999}',
    '{"musicVolume":0.8,"musicVolume":0.25,"effectsVolume":0.9}', '{"musicVolume":0e9999999999999999,"effectsVolume":5e-324}'].entries())
    inputs.push({ name: `raw-${index}`, raw });
  for (const [index, field] of [undefined, null, false, true, 0, -1, 2, .125, "", "  .42 ", "01.", "+.5e0", "-0", "Infinity", "-Infinity", "NaN", "no", "0x0", "0x1", "0b1", "0o7", "+0x1", "\ufeff.6\u00a0", "\u0085.6\u0085", [], [.45], [[.55]], [null], [1, 2], {}, { toString: null }].entries())
    inputs.push({ name: `coercion-${index}`, raw: JSON.stringify({ musicVolume: field, effectsVolume: .8 }) });
  const cases = inputs.map(input => {
    reset(input.raw, input.failRead); const audio = new AudioManager(); const initial = value(audio);
    const commands = [{ channel: "effects", value: .73 }, { channel: "music", value: .31 }];
    for (const command of commands) {
      if (command.channel === "music") audio.setMusicVolume(command.value); else audio.setEffectsVolume(command.value);
    }
    return { ...input, initial, commands, final: value(audio), writes: storage.writes.map(([key, text]) => ({ key, value: JSON.parse(text) })) };
  });
  reset(null); const audio = new AudioManager();
  const changes = [
    { channel: "music", input: "0.27" }, { channel: "effects", input: "0.91" },
    { channel: "music", input: "NaN" }, { channel: "effects", input: "Infinity" },
    { channel: "music", input: "-Infinity" }, { channel: "effects", input: "-5" },
    { channel: "music", input: "8" }, { channel: "effects", input: "0.62", failWrite: true },
  ].map(change => {
    storage.failWrite = !!change.failWrite; let failed = false;
    try { if (change.channel === "music") audio.setMusicVolume(Number(change.input)); else audio.setEffectsVolume(Number(change.input)); }
    catch { failed = true; }
    const [key, text] = storage.writes.at(-1)!;
    return { ...change, failed, expected: value(audio), write: { key, value: JSON.parse(text) } };
  });
  const sources = ["client/src/config/themes.ts", "client/src/audio/AudioManager.ts", "client/src/ui/components/settings/AudioSettingsControls.tsx"];
  return { schemaVersion: 1, policy, sources: sources.map(file => ({ file, sha256: createHash("sha256").update(readFileSync(resolve(root, file))).digest("hex") })), cases, changes };
}

export function policyCode(policy: ReturnType<typeof produce>["policy"]) {
  return `// Generated from actual TypeScript audio settings calls; do not edit.\nnamespace ZKube.Core.Generated\n{\n    public static class AudioPolicy\n    {\n        public const string StorageKey = ${JSON.stringify(policy.storageKey)};\n        public const double DefaultMusicVolume = ${policy.musicVolume};\n        public const double DefaultEffectsVolume = ${policy.effectsVolume};\n        public const double ToggleOnLevel = ${policy.toggleOnLevel};\n    }\n}\n`;
}
