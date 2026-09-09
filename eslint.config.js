import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      'materials/**',
      'docs/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      // PRD §74：禁止跳过类型检查，any 是逃逸口，直接封死
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-restricted-syntax': [
        'error',
        {
          // PRD §44：禁止把原始对象直接丢进 console，必须走 logger 的脱敏通道
          selector:
            'MemberExpression[object.name="console"][property.name=/^(debug|info|warn|error)$/]',
          message: '禁止直接使用 console.*，请使用 @autojob/core 的 logger（自带 PII 脱敏）',
        },
      ],
    },
  },
  {
    // logger 自身与 CLI 输出层需要真正写 stdout
    files: ['packages/core/src/logger.ts', 'apps/cli/src/**/*.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    // 独立的 Node 脚本（非 TS，不走 tsconfig），需要显式声明 Node 全局
    files: ['scripts/**/*.mjs', '*.mjs'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', URL: 'readonly' },
    },
  },
  {
    // 浏览器全局只允许出现在会被送进页面执行的脚本里，以及 Playwright 测试中
    files: ['packages/**/src/**/*.ts', 'apps/**/src/**/*.ts'],
    ignores: [
      'packages/form-schema/src/raw-field.ts',
      'packages/browser/src/page-scripts.ts',
      'packages/job-discovery/src/extract-script.ts',
      'packages/adapters/moka/src/moka-adapter.ts',
      'packages/adapters/generic/src/index.ts',
    ],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'document', message: '浏览器全局只能用于会送进页面执行的提取脚本' },
        { name: 'window', message: '浏览器全局只能用于会送进页面执行的提取脚本' },
      ],
    },
  },
  prettier,
);
