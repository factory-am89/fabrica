import js from '@eslint/js';
import globals from 'globals';

export default [
  // .fabrica/: la Fábrica bajada dentro del repo que llama a tests.yml; no es código suyo.
  { ignores: ['node_modules/', '.fabrica/'] },
  js.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      'max-lines-per-function': ['error', { max: 100, skipBlankLines: true, skipComments: true }],
      'no-empty': ['error', { allowEmptyCatch: false }],
      eqeqeq: 'error',
    },
  },
];
