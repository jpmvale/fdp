import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

/**
 * O que todo teste E2E precisa fazer antes de testar qualquer coisa.
 *
 * Mora aqui, e não repetido em cada arquivo, porque estas funções descrevem o
 * **caminho do jogador** — abrir, dizer o apelido, criar a mesa, entrar por
 * link. Quando esse caminho mudar, ele muda num lugar só; e se ele quebrar, os
 * testes falham no lugar certo em vez de falharem todos por dentro.
 */

/** O apelido é o único passo obrigatório antes de qualquer mesa. */
export async function dizerQuemSou(page: Page, apelido: string): Promise<void> {
  const campo = page.getByLabel(/apelido/i).or(page.locator('input').first());
  await campo.fill(apelido);
  await page.getByRole('button', { name: 'Entrar na mesa' }).click();
}

/** Cria uma sala e devolve o código dela, lido da própria tela. */
export async function criarSala(page: Page, apelido: string): Promise<string> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Criar sala' }).click();
  await dizerQuemSou(page, apelido);

  // O código aparece no lobby. Esperar por ELE, e não por um tempo fixo, é o
  // que separa um teste E2E de um teste que pisca em máquina lenta.
  const codigo = page.locator('[data-codigo]').first();
  await expect(codigo).toBeVisible();
  return (await codigo.textContent())?.trim() ?? '';
}

/** Entra numa sala existente pelo link de convite (RF-107). */
export async function entrarPorConvite(page: Page, codigo: string, apelido: string): Promise<void> {
  await page.goto(`/j/${codigo}`);
  await page.getByRole('button', { name: 'Entrar na sala' }).click();
  await dizerQuemSou(page, apelido);
}

/**
 * O assento de alguém na mesa — e não o nome dele em qualquer lugar da tela.
 *
 * Existe porque o primeiro jeito, `getByText('Beto')`, casava também com o
 * aviso "Falta Ana, Beto dar pronto." O teste falhava por ambiguidade, num
 * lugar onde o produto estava certo — e teste que falha por motivo errado é o
 * que ensina a ignorar a luz vermelha.
 */
export const naMesa = (page: Page, apelido: string) =>
  page.getByText(apelido, { exact: true });

/**
 * Uma aba nova, isolada.
 *
 * Contexto novo e não só página nova: o `localStorage` guarda a sessão da sala
 * (CA-007), e duas abas no mesmo contexto seriam a MESMA pessoa reabrindo a
 * aba — que é outro teste, e um que já existe. Aqui a intenção é sempre duas
 * pessoas diferentes.
 */
export async function outraPessoa(browser: Browser): Promise<Page> {
  const contexto = await browser.newContext();
  extras.push(contexto);
  return contexto.newPage();
}

const extras: BrowserContext[] = [];

/**
 * Fecha as abas extras entre um teste e outro.
 *
 * Não é higiene: é correção. O Playwright fecha a aba do fixture sozinho, mas
 * não as que o teste abriu — e uma aba aberta é um socket aberto, que na fila
 * significa uma pessoa a mais esperando (plano 03, I-3). Sem isto, o teste
 * seguinte encontra a fila do anterior e falha por um motivo que não é dele.
 */
export async function fecharAbasExtras(): Promise<void> {
  await Promise.all(extras.splice(0).map((c) => c.close()));
}

/**
 * Aposta o que a mesa deixar.
 *
 * Não escolhe valor: o rótulo muda entre a rodada de testa ("Ganho"/"Perco") e
 * as demais (números), e a última pessoa a apostar tem uma opção **proibida**
 * (RJ-051) — que fica desabilitada. Um teste que clicasse no primeiro botão
 * esperaria para sempre por um botão que nunca vai habilitar.
 */
export async function apostarQualquerCoisa(page: Page): Promise<void> {
  await page.locator('[data-apostas] button:not([disabled])').first().click();
}

/**
 * Derruba a conexão de verdade, por `ms`, e devolve o controle depois.
 *
 * `context.setOffline(true)` NÃO serve aqui, e foi preciso medir para
 * descobrir: com ele, o WebSocket já aberto continua vivo — a mesa ficou
 * "estável" por 22 s de "offline", e o teste teria passado sem testar nada.
 * Ele bloqueia requisições novas, não conexões existentes.
 *
 * Interceptar o WebSocket é o que reproduz uma queda de verdade: o socket em
 * uso é fechado, e cada tentativa de reconexão durante a janela é fechada
 * também. É o que o metrô entrando num túnel faz.
 */
export async function quedaDeRede(page: Page, ms: number): Promise<void> {
  const rede = await controlarRede(page);
  rede.derrubar();
  await page.waitForTimeout(ms);
  rede.voltar();
}

/**
 * O mesmo, com o controle na mão de quem chama.
 *
 * Existe porque há testes que precisam olhar OUTRA tela enquanto esta está
 * fora do ar — a mesa esperando por quem sumiu só se verifica assim. Com a
 * queda embrulhada num `await`, não há momento em que o teste esteja acordado
 * durante ela.
 */
export async function controlarRede(page: Page): Promise<{
  derrubar: () => void;
  voltar: () => void;
}> {
  let caiu = false;
  let derrubarAtual: (() => void) | null = null;

  await page.routeWebSocket(/\/api\/rooms\/.*\/ws/, (ws) => {
    if (caiu) {
      // Tentativa de reconexão durante a queda: morre antes de chegar ao
      // servidor, como morreria sem rede.
      ws.close();
      return;
    }
    ws.connectToServer();
    derrubarAtual = () => ws.close();
  });

  // O socket em uso foi aberto ANTES da interceptação, e não passa pelo
  // roteador. Uma recarga o refaz sob controle — e o CA-040 já provou que
  // recarregar não custa nada.
  await page.reload();
  await page.waitForTimeout(500);

  return {
    derrubar: () => { caiu = true; derrubarAtual?.(); },
    voltar: () => { caiu = false; },
  };
}
