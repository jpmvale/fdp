import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const at = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@fdp/rules': at('./packages/rules/src/index.ts'),
      '@fdp/store/redis': at('./packages/store/src/redis.ts'),
      '@fdp/store': at('./packages/store/src/index.ts'),
      '@fdp/protocol/validate': at('./packages/protocol/src/validate.ts'),
      '@fdp/protocol': at('./packages/protocol/src/index.ts'),
      '@fdp/room': at('./packages/room/src/index.ts'),
      '@fdp/bot': at('./packages/bot/src/index.ts'),
    },
  },
});
