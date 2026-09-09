import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const resolvePath = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@autojob/core': resolvePath('./packages/core/src/index.ts'),
      '@autojob/candidate-profile': resolvePath('./packages/candidate-profile/src/index.ts'),
      '@autojob/form-schema': resolvePath('./packages/form-schema/src/index.ts'),
      '@autojob/form-mapper': resolvePath('./packages/form-mapper/src/index.ts'),
      '@autojob/browser': resolvePath('./packages/browser/src/index.ts'),
      '@autojob/database': resolvePath('./packages/database/src/index.ts'),
      '@autojob/content-adapter': resolvePath('./packages/content-adapter/src/index.ts'),
      '@autojob/application-diff': resolvePath('./packages/application-diff/src/index.ts'),
      '@autojob/job-discovery': resolvePath('./packages/job-discovery/src/index.ts'),
      '@autojob/job-matcher': resolvePath('./packages/job-matcher/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: [
      'packages/**/tests/**/*.test.ts',
      'apps/**/tests/**/*.test.ts',
      'tests/unit/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/e2e/**'],
  },
});
