// The Worker's source for the core's compiled module: the runtime hands an
// imported .wasm file over as a WebAssembly.Module.
// @ts-expect-error A .wasm import has no type outside the Worker bundle.
import module from "../zkube-core/zkube_core_bg.wasm";

export default module as WebAssembly.Module;
