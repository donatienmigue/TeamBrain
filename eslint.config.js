import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    // `out/` is the bundled VSIX payload (packages/vscode), not source.
    ignores: ['**/dist/**', '**/out/**', '**/node_modules/**', '**/*.md'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Plain-JS maintenance and build scripts run under node.
    files: ['**/scripts/**/*.mjs', '**/*.mjs'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly', URL: 'readonly' },
    },
  },
  eslintConfigPrettier,
);
