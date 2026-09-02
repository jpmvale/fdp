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
