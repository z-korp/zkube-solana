import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "**/node_modules/**", "services/zkube-core/**", "tools/chain/idl/**",
      "build/**", "unity/**", "assets/**", "tools/art/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: globals.node } },
);
