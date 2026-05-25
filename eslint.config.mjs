import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

const sourceFiles = [
  "apps/*/src/**/*.{js,mjs,cjs,ts,tsx}",
  "apps/*/scripts/**/*.{js,ts}",
  "apps/*/*.{js,ts}",
  "packages/*/src/**/*.{js,mjs,cjs,ts,tsx}",
  "packages/*/scripts/**/*.{js,ts}",
  "packages/*/*.{js,ts}",
  "scripts/**/*.{js,ts}",
];

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/priv/**",
      "**/*.d.ts",
      "**/coverage/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: sourceFiles,
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.es2022,
        Bun: "readonly",
      },
    },
    rules: {
      "no-console": "off",
      "no-unused-vars": "off",
      "no-empty": "off",
      "no-undef": "off",
      "no-cond-assign": "warn",
      "prefer-const": "warn",
      "no-constant-condition": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-empty-function": "off",
      "@typescript-eslint/no-inferrable-types": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-unused-expressions": "off",
      "@typescript-eslint/no-namespace": "off",
      "@typescript-eslint/consistent-type-imports": "off",
      "@typescript-eslint/no-wrapper-object-types": "off",
      "@typescript-eslint/no-this-alias": "off",
      "@typescript-eslint/no-array-constructor": "off",
    },
  },
  {
    files: ["**/*.{test,spec}.{ts,tsx}", "packages/testing/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    files: ["packages/admin-ui/**/*.{ts,tsx}"],
    plugins: {
      react,
      "react-hooks": reactHooks,
    },
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      react: { version: "detect" },
    },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "react/no-unescaped-entities": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  eslintConfigPrettier
);
