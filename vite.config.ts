import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';
import type { UserConfigExport } from 'vitest/config';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    globals: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
    },
  },
} satisfies UserConfigExport);
