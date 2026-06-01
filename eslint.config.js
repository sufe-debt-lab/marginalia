import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

const browserGlobals = {
  document: "readonly",
  fetch: "readonly",
  requestAnimationFrame: "readonly",
  setTimeout: "readonly",
  window: "readonly"
};

const nodeGlobals = {
  Buffer: "readonly",
  console: "readonly",
  module: "readonly",
  process: "readonly",
  setTimeout: "readonly"
};

export default tseslint.config(
  { ignores: ["**/dist/**", "**/dist-electron/**", "**/node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["apps/**/*.{js,cjs,mjs}"],
    languageOptions: {
      globals: {
        ...browserGlobals,
        ...nodeGlobals
      }
    }
  },
  {
    files: ["apps/**/*.{ts,tsx}"],
    languageOptions: {
      globals: {
        ...browserGlobals,
        ...nodeGlobals
      }
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // Test/agent code uses `as any` bridges and intentionally-unused `_`-prefixed vars.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }
      ],
      "require-yield": "off"
    }
  }
);
