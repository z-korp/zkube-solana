import type { BackendLayer } from "./runtime";

export declare const SELECTED_BACKEND_SENTINEL: string;
export declare const SELECTED_BUILD_SENTINEL: string | undefined;
export declare function makeSelectedBackend(): BackendLayer;
