import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

/**
 * O cliente vive em `app/` e compila para `app/build/`, servido pelo processo
 * Node em produção (`server/src/http.ts`).
 *
 * `build/` e não `dist/` porque `dist/` já é a saída do `tsc -b` do workspace —
 * as duas ferramentas escrevendo no mesmo diretório se sobrescreveriam.
 */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  resolve: {
    // Os mesmos apelidos de `tsconfig.base.json`: o Vite não lê `paths` do
    // TypeScript, e sem isto `@fdp/protocol` só resolveria no typecheck.
    alias: {
      '@fdp/protocol': fileURLToPath(new URL('../packages/protocol/src/index.ts', import.meta.url)),
      '@fdp/rules': fileURLToPath(new URL('../packages/rules/src/index.ts', import.meta.url)),
    },
  },
  build: {
    outDir: 'build',
    emptyOutDir: true,
    // O orçamento de RNF-055 é 180 KB comprimido. O aviso do Vite é por
    // arquivo e não comprimido; 500 KB crus ficam bem acima do teto real e
    // servem como alarme antecipado.
    chunkSizeWarningLimit: 500,
  },
  server: {
    // `npm run dev:client` conversa com o servidor Node em 3000: só o HTML e o
    // JS vêm do Vite, o resto é do processo de verdade.
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true, ws: true },
    },
  },
});
