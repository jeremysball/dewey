import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["node_modules/**", ".claude/**", ".worktrees/**", "dist/**"] },
  js.configs.recommended,
  {
    rules: {
      "no-unused-vars": ["warn", { caughtErrors: "none", argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node },
    },
  },
];
