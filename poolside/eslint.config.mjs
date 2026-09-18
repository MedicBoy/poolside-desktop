// ESLint flat config.
//
// The main process is CommonJS and runs under Electron's Node; the renderer is a sandboxed browser
// script with no Node globals at all, so it gets its own block. Unused arguments prefixed with `_`
// are allowed because Electron's event signatures frequently require them positionally.

import globals from 'globals';

const shared = {
  'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  'no-undef': 'error',
  'no-var': 'error',
  'prefer-const': 'error',
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-dupe-keys': 'error',
  'no-unreachable': 'error',
  'no-constant-condition': ['error', { checkLoops: false }],
  eqeqeq: ['error', 'smart']
};

export default [
  { ignores: ['node_modules/**', 'release*/**', '**/*.min.js'] },
  {
    files: ['**/*.cjs'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: { ...globals.node } },
    rules: shared
  },
  {
    files: ['src/ui/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'script', globals: { ...globals.browser, poolside: 'readonly' } },
    rules: shared
  }
];
