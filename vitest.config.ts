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
