import n from 'eslint-plugin-n';

export default [
  {
    ignores: ['node_modules/', 'coverage/'],
  },
  n.configs['flat/recommended-module'],
  {
    files: ['**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
      },
    },
    rules: {
      'n/no-unsupported-features/node-builtins': ['error', { version: '>=22.0.0' }],
      'n/no-missing-import': 'warn',
      'n/no-extraneous-import': 'error',
      'n/no-process-exit': 'off',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
];
