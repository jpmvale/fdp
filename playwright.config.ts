import { defineConfig, devices } from '@playwright/test';

/**
 * A suíte E2E (`11` §, nível "E" de `10`).
 *
 * Existe para os critérios que **só** se verificam num navegador de verdade:
 * duas abas vendo a mesma sala, a área de transferência, o link de convite, a
 * página recarregando no meio de uma partida. Tudo que não precisa de navegador
 * continua em Vitest, e de propósito — a pirâmide de `11` é pesada na base
 * porque regra de jogo é combinatória e navegador é lento demais para dar a
 * cobertura que CA-310 exige.
 *
 * **O servidor é o de verdade**, subido por `webServer`: `npm start` serve o
 * cliente construído e o WebSocket no mesmo processo, que é exatamente a
 * topologia de produção (`11` §3.1). Um servidor de mentira aqui testaria a
 * mentira.
 *
 * Sem banco: a fila normal, a sala por link e a partida inteira funcionam sem
 * Postgres (plano 01, I-1), e é isso que a maior parte dos `E` cobre. Os que
 * precisam de conta pedem `DATABASE_URL` e se pulam sozinhos sem ela — mesma
 * regra da suíte de contrato.
 */

const PORTA = 3100;

export default defineConfig({
  testDir: './e2e',
  // Uma partida com quatro abas leva tempo real: o padrão de 30 s expira no
  // meio de uma rodada e o relatório culpa o teste em vez do jogo.
  timeout: 90_000,
  expect: { timeout: 10_000 },

  // Em CI, `retries` esconde instabilidade em vez de mostrá-la — e um E2E
  // instável é pior que nenhum, porque ensina a ignorar a luz vermelha.
  // Zero aqui é uma escolha: se piscar, conserta-se a causa.
  retries: 0,

  // Sequencial. Estes testes compartilham UM servidor, e servidor compartilhado
  // com paralelismo transforma "a sala do outro teste" em defeito fantasma.
  workers: 1,
  fullyParallel: false,

  reporter: process.env.CI ? [['github'], ['list']] : [['list']],

  use: {
    baseURL: `http://127.0.0.1:${String(PORTA)}`,
    // Só do que falhou: vídeo de tudo enche o artefato de CI com partidas que
    // deram certo.
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      // O FDP é desenhado para 360 px (`07`), então é nessa largura que ele é
      // verificado. O desktop tem seu próprio projeto porque o zoom da mesa
      // (RF-092/RF-093) muda a geometria e só aparece em tela alta.
      name: 'celular',
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
      testMatch: /desktop\.spec\.ts$/,
    },
  ],

  webServer: {
    // O cliente precisa estar construído: `npm start` serve `app/build`, não o
    // Vite de desenvolvimento. Construir aqui é o que impede a suíte de passar
    // contra um pacote velho — foi assim que "o botão não faz nada" apareceu
    // uma vez, e não era o botão.
    /**
     * `LIMITE_SALAS_POR_HORA` alto de propósito.
     *
     * O teto de produção é 10 salas por hora por IP, e a suíte inteira sai do
     * mesmo `127.0.0.1`: ela cria mais de vinte salas em dois minutos e, ao
     * estourar, cinco testes falhavam com a tela parada no Perfil — por um
     * motivo que não era o deles. Levou duas execuções completas para ficar
     * claro que não era instabilidade.
     *
     * O limite continua sendo regra de produto e continua testado com o teto
     * real em `server/test/http.test.ts`.
     */
    command: `npm run build:client && PORT=${String(PORTA)} LIMITE_SALAS_POR_HORA=500 BILHETES_POR_ENDERECO=50 npm start`,
    url: `http://127.0.0.1:${String(PORTA)}/api/health`,
    /**
     * **Nunca** reaproveita servidor de pé, nem no desenvolvimento.
     *
     * Foi o que custou uma execução inteira com dezesseis reprovações
     * inexplicáveis: um servidor esquecido de antes de `LIMITE_SALAS_POR_HORA`
     * existir foi reaproveitado, rodou com o teto de produção, e a suíte
     * estourou nas primeiras salas. Nada na saída do Playwright liga uma coisa
     * à outra — ele diz que um botão não apareceu.
     *
     * Reaproveitar economiza uns segundos e paga com a possibilidade de a suíte
     * rodar contra um servidor configurado de outro jeito. Não vale.
     */
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
