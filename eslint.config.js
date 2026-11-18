import tseslint from 'typescript-eslint';

export default [
  { ignores: ['.cache/**', 'dist/**'] },
  ...tseslint.configs.recommended,
];
