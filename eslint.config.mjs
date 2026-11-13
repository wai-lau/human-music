// ESLint for Human Music (dev only: `npm run lint`). The extension ships as plain
// scripts (no modules, no build), each an IIFE that sets globalThis.HM.<name>.
import js from '@eslint/js';
import globals from 'globals';

const shared = {
  ...js.configs.recommended.rules,
  // Empty catch blocks are the house style: any error leaves the song playing.
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
  eqeqeq: ['error', 'smart'],
  'no-implicit-globals': 'error',
  'no-shadow-restricted-names': 'error',
  'no-new-func': 'error',
  'no-eval': 'error',
  'no-implied-eval': 'error',
  'no-script-url': 'error',
  'prefer-const': ['error', { destructuring: 'all' }],
  'no-var': 'error',
};

// The only sinks that could turn list or page text into markup or code.
const noHtmlSinks = {
  'no-restricted-properties': ['error',
    { property: 'innerHTML', message: 'Build nodes and set textContent: list and page text is untrusted.' },
    { property: 'outerHTML', message: 'Build nodes and set textContent: list and page text is untrusted.' },
    { property: 'insertAdjacentHTML', message: 'Build nodes and set textContent: list and page text is untrusted.' },
    { object: 'document', property: 'write', message: 'Never document.write.' },
  ],
};

export default [
  { ignores: ['node_modules/**', 'dist/**', '.claude/**', '.mates/**', 'graphify-out/**', '.archaeology/**', 'e2e/.results/**'] },
  {
    files: ['extension/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, ...globals.webextensions, ...globals.serviceworker, HM: 'readonly' },
    },
    rules: { ...shared, ...noHtmlSinks },
  },
  {
    files: ['tests/**/*.mjs', 'e2e/**/*.mjs', 'eslint.config.mjs'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    // Tests feed hostile strings (javascript: URLs) to the code on purpose.
    rules: { ...shared, 'no-var': 'off', 'prefer-const': 'off', 'no-script-url': 'off' },
  },
];
