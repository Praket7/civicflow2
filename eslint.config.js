import js from "@eslint/js";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "src-tauri/target/**",
      "src-tauri/core/target/**",
      // A service worker runs in its own global scope; the app's browser
      // globals and React rules do not describe it.
      "public/sw.js",
      // Edge Functions run on Deno, which neither tsconfig nor these browser
      // globals describe.
      "supabase/functions/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser },
    },
    plugins: {
      "react-hooks": reactHooks,
      "jsx-a11y": jsxA11y,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["scripts/**/*.mjs", "vite.config.ts"],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ["tests/e2e/**/*.mjs", "wdio.conf.mjs"],
    languageOptions: { globals: { ...globals.node, ...globals.mocha, ...globals.browser } },
  },
);
