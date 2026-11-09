import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // `dist-analyst` is the explicit Analyst Mode build output; like `dist`, it
    // contains generated bundles that must not be linted.
    ignores: [
      "**/dist/**",
      "**/dist-analyst/**",
      "**/node_modules/**",
      ".git/**",
      ".kiro/**",
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
);
