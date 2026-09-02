import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const at = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  test: {
    /**
     * A suíte E2E é do Playwright, não do Vitest.
     *
     * Sem esta exclusão o Vitest encontra `e2e/*.spec.ts`, tenta rodá-los sem
     * navegador nenhum e falha — dois vermelhos no terminal por um motivo que
     * não é defeito de nada. Os dois runners convivem: `npm test` é a base da
     * pirâmide, `npm run e2e` é o topo dela.
     */
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
  },
  resolve: {
    alias: {
      '@fdp/rules': at('./packages/rules/src/index.ts'),
      '@fdp/store/redis': at('./packages/store/src/redis.ts'),
      '@fdp/store': at('./packages/store/src/index.ts'),
      '@fdp/protocol/validate': at('./packages/protocol/src/validate.ts'),
      '@fdp/protocol': at('./packages/protocol/src/index.ts'),
      '@fdp/room': at('./packages/room/src/index.ts'),
      '@fdp/bot': at('./packages/bot/src/index.ts'),
      '@fdp/avatares/assinatura': at('./packages/avatares/src/assinatura.ts'),
      '@fdp/avatares/r2': at('./packages/avatares/src/r2.ts'),
      '@fdp/avatares': at('./packages/avatares/src/index.ts'),
    },
  },
});
