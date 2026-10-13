import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier/flat';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores([
    '**/dist/',
    '**/.wrangler/',
    '**/node_modules/',
    'packages/server/worker-configuration.d.ts',
  ]),

  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  svelte.configs.recommended,

  {
    languageOptions: {
      parserOptions: {
        // Listed explicitly: one tsconfig per package, each with its own lib and types.
        project: [
          './packages/shared/tsconfig.json',
          './packages/server/tsconfig.json',
          './packages/e2e/tsconfig.json',
          './packages/web/tsconfig.json',
        ],
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.svelte'],
      },
    },
    plugins: { 'simple-import-sort': simpleImportSort },
    rules: {
      'no-console': 'error',
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },

  // Svelte files: let the TypeScript parser handle <script lang="ts">, and browser globals apply.
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: { globals: globals.browser, parserOptions: { parser: tseslint.parser } },
  },
  { files: ['packages/web/**'], languageOptions: { globals: globals.browser } },

  // Tool configuration files are not part of any tsconfig, so they cannot be type-checked.
  {
    files: ['**/*.config.{js,ts}'],
    languageOptions: { globals: globals.node },
    extends: [tseslint.configs.disableTypeChecked],
  },

  // Must come last: turns off rules that conflict with Prettier.
  svelte.configs.prettier,
  prettier,
);
