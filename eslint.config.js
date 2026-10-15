import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/'] },
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
