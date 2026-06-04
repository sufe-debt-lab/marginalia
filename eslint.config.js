import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

const sharedGlobals = { ...globals.browser, ...globals.node };

export default tseslint.config(
  { ignores: ["**/dist/**", "**/dist-electron/**", "**/release/**", "**/node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["apps/**/*.{js,cjs,mjs}"],
    languageOptions: { globals: sharedGlobals }
  },
  {
    files: ["apps/**/*.{ts,tsx}"],
    languageOptions: { globals: sharedGlobals },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }
      ]
    }
  },
  // better-sqlite3 hands back untyped rows at the DB boundary, so `any` is inherent here.
  {
    files: ["apps/pi-server/src/db/**/*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" }
  },
  // Test code leans on `as any` bridges and empty `async function*` stubs.
  {
    files: ["**/*.test.{ts,tsx}", "**/test/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "require-yield": "off"
    }
  }
);
