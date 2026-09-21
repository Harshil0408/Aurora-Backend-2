import js from '@eslint/js';

// NOTE (TypeScript 7 compatibility): typescript-eslint 8.x still declares
// `peer typescript >=4.8 <6.1` and depends on the pre-7 programmatic API
// (stable API lands in TS 7.1). To keep `npm install` clean on TS 7.0.2,
// type-aware linting is deferred — `tsc --noEmit` (strict) is the type gate.
// Reintroduce typescript-eslint strictTypeChecked once it supports TS 7.1.
export default [
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  {
    files: ['**/*.mjs', '**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { console: 'readonly', process: 'readonly' },
    },
  },
];
