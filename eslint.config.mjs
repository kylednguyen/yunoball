// Flat ESLint config for the whole monorepo. One config, file-scoped overrides:
// Node rules everywhere, Next/React rules layered on for apps/web. Kept
// deliberately lean — enough to catch real mistakes (unused code, unsafe
// patterns, React-hook misuse) without a wall of stylistic noise that would
// make `pnpm lint` a gate people route around.

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  {
    ignores: [
      "**/.next/**",
      "**/dist/**",
      "**/node_modules/**",
      "**/*.d.ts",
      "apps/web/playwright-report/**",
      "apps/web/test-results/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Baseline for all TypeScript across the repo.
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // Allow intentionally-unused args/vars when prefixed with _.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // The engine's discriminated-AST reader intentionally uses a typed escape
      // hatch (spec.ts `fields()`); a handful of boundary casts are deliberate.
      // Flag new ones as warnings rather than hard-failing the gate.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },

  // Next.js / React frontend.
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: {
      "@next/next": nextPlugin,
      "react-hooks": reactHooks,
    },
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      ...reactHooks.configs.recommended.rules,
    },
  },

  // Config files and CLIs run in a plain Node context.
  {
    files: ["**/*.config.{ts,mts,js,mjs}", "**/cli/**/*.ts", "**/ingest/cli.ts"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);
