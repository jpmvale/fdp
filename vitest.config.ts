import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const at = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@fdp/rules': at('./packages/rules/src/index.ts'),
      '@fdp/store': at('./packages/store/src/index.ts'),
      '@fdp/protocol/validate': at('./packages/protocol/src/validate.ts'),
      '@fdp/protocol': at('./packages/protocol/src/index.ts'),
    },
  },
});
