// Where the core's compiled module comes from on Node: the file beside the
// generated binding. The Worker build swaps this one file for
// zkubeCoreWasm.worker.ts, which imports the same module instead.
import { readFileSync } from "node:fs";

export default readFileSync(new URL("../zkube-core/zkube_core_bg.wasm", import.meta.url)) as BufferSource;
