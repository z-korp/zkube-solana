import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { decodeLocalProductState, emptyLocalProductState, localProductStorage, normalizeLocalName } from "@/backend/local/localPersistence";

const units = (value: string | null) => value === null ? null : Array.from({ length: value.length }, (_, index) => value.charCodeAt(index));
export function produce(root: string) {
  const cases: Array<{ name: string; raw: string | null }> = [];
  const add = (name: string, value: unknown) => cases.push({ name, raw: JSON.stringify(value) });
  const raw = (name: string, value: string | null) => cases.push({ name, raw: value });
  raw("missing", null);
  for (const [name, value] of Object.entries({ empty: "", truncated: '{"version":1', trailing: '{"version":1} false', singleQuotes: "{'version':1}", unquoted: '{version:1}', comment: '{"version":1/*x*/}', trailingObject: '{"version":1,}', trailingArray: '{"version":1,"stars":[1,]}', undefined: '{"version":1,"name":undefined}', nan: '{"version":1,"streak":NaN}', infinity: '{"version":1,"streak":Infinity}', leadingZero: '{"version":01}', hex: '{"version":0x1}', plus: '{"version":+1}', decimal: '{"version":1.}', badEscape: '{"version":1,"name":"\\x41"}', control: '{"version":1,"name":"x\ny"}', bom: '\ufeff{"version":1}' })) raw(name, value);
  for (const [index, value] of [null, [], true, 1, "text", {}, { version: 2 }, { version: "1" }, { version: true }, { version: 1 }].entries()) add(`root-${index}`, value);
  add("default", emptyLocalProductState());
  add("full", { version: 1, name: "  Mira  ", stars: [0, 1, 2, 3], dailyAttempt: { dayId: 20705, realm: 8, objectiveKind: 5, objectiveValue: 4, dailyScore: 987, objectiveTotal: "18446744073709551615", finished: true }, streak: 7, lastAttemptDayId: 20705, bestDailyScore: 999, wornEmblem: 10, campaignOwned: true, campaignPrice: "  ¥100  ", ignored: "discard" });
  const values: unknown[] = [undefined, null, false, true, "1", [], {}, -1, -0, 0, 0.5, 1, 3, 10, 100, 4294967295, 4294967296, 9007199254740991, 9007199254740992, 1e30];
  values.forEach((value, index) => add(`field-types-${index}`, { version: 1, name: value, stars: [value], dailyAttempt: { dayId: value, realm: value, objectiveKind: value, objectiveValue: value, dailyScore: value, objectiveTotal: value, finished: value }, streak: value, lastAttemptDayId: value, bestDailyScore: value, wornEmblem: value, campaignOwned: value, campaignPrice: value }));
  add("star-width", { version: 1, stars: Array.from({ length: 103 }, (_, i) => i % 7), lastAttemptDayId: null });
  for (const value of [null, [], "x", true, 4, {}]) add(`attempt-${JSON.stringify(value)}`, { version: 1, dailyAttempt: value });
  for (const [index, value] of ["", "0", "00012", "18446744073709551616", "1\n", "1\r", "1\u2028", "1\r\n", "١", "１", "-1", "+1", "1.0", " 1 "].entries()) add(`objective-text-${index}`, { version: 1, dailyAttempt: { objectiveTotal: value } });
  const strings = ["\ufeff \tMira\u00a0", "\u0085Mira\u0085", "\u180eMira\u180e", "\u200bMira\u200b", "\u1680\u2000\u2028Mira\u205f\u3000", "a".repeat(23) + "😀", "😀".repeat(21), "x".repeat(39) + "😀", "\ud800", "\udc00", "\u0000", "\ufeff\n "];
  strings.forEach((value, index) => add(`utf16-${index}`, { version: 1, name: value, campaignPrice: value }));
  raw("duplicate-last-wins", '{"version":2,"version":1,"name":"first","name":"last","stars":[3],"stars":[2]}');
  raw("floating-rounding", '{"version":1.00000000000000001,"streak":9007199254740990.5,"bestDailyScore":1.00000000000000001,"dailyAttempt":{"objectiveValue":1e400}}');
  raw("underflow", '{"version":1,"streak":-1e-999,"bestDailyScore":1e-999}');
  for (const [index, number] of ["1e400", "-1e400", "1e99999999999999999999", "1e-99999999999999999999", "0e99999999999999999999", "1.7976931348623159e308", "5e-324", "2.4703282292062327e-324"].entries())
    raw(`number-range-${index}`, `{"version":1,"name":"Mira","streak":${number},"stars":[2],"dailyAttempt":{"objectiveValue":${number}}}`);
  add("deep-ignored", { version: 1, ignored: Array.from({ length: 250 }, () => 0).reduce<unknown>(value => [value], 1) });
  const decoded = cases.map(item => { const expected = decodeLocalProductState(item.raw); return { ...item, expected, nameUnits: units(expected.name), priceUnits: units(expected.campaignPrice) }; });
  const names = [...strings, null, 1, true, {}, [], "", "  "].map((value, index) => {
    try { return { name: `name-${index}`, input: typeof value === "string" ? units(value) : null, expected: units(normalizeLocalName(value)), error: null }; }
    catch (error) { return { name: `name-${index}`, input: typeof value === "string" ? units(value) : null, expected: null, error: (error as Error).message }; }
  });
  const writes: Array<[string, string]> = [];
  const storage = localProductStorage({ getItem: () => null, setItem: (key, value) => { writes.push([key, value]); }, removeItem: () => {} });
  storage.write(current => ({ ...current, name: "  Mira  ", stars: [9, 2], wornEmblem: 99, campaignPrice: "  €0.99  " }));
  const source = "client/src/backend/local/localPersistence.ts";
  return { schemaVersion: 1, authority: source, sourceSha256: createHash("sha256").update(readFileSync(resolve(root, source))).digest("hex"), cases: decoded, names, writes };
}
