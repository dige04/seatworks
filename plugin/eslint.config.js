import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    ignores: ["node_modules", "mcp", "bin", "content", "harness", "catalog", "test/fixtures"],
  },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      "@typescript-eslint/no-floating-promises": [
        "error",
        {
          allowForKnownSafeCalls: [
            { from: "package", package: "node:test", name: ["test", "suite", "describe", "it"] },
          ],
        },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { ignoreRestSiblings: true, argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: ["client/**/*.{ts,tsx}", "index.client.tsx"],
    languageOptions: {
      parserOptions: { projectService: false, project: "./tsconfig.client.json", tsconfigRootDir: import.meta.dirname },
    },
  },
  { files: ["eslint.config.js"], extends: [tseslint.configs.disableTypeChecked] },
);
