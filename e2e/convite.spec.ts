import { expect, test } from '@playwright/test';
import { criarSala, entrarPorConvite, naMesa, outraPessoa } from './apoio';

/**
 * O convite e o lobby ao vivo — CA-005, CA-020, CA-026.
 *
 * Estes três só existem num navegador de verdade: um lê a área de
 * transferência, outro precisa de **duas abas independentes** vendo a mesma
 * sala mudar sem recarregar, e o terceiro depende do roteamento do cliente. Um
 * teste de integração pode provar que o servidor emitiu o evento; só o
 * navegador prova que a segunda tela mudou.
 */

test.describe('o convite', () => {
  test('CA-005: abrir o link cai na tela de apelido com o código preenchido', async ({ page, browser }) => {
    const codigo = await criarSala(page, 'Ana');

    const beto = await outraPessoa(browser);
    await beto.goto(`/j/${codigo}`);

    // O código chega preenchido: quem clicou no convite não digita nada.
    const entrar = beto.getByRole('button', { name: 'Entrar na sala' });
    await expect(entrar).toBeEnabled();

    await entrar.click();
    await expect(beto.getByRole('button', { name: 'Entrar na mesa' })).toBeVisible();
  });

  test('CA-005: o formato antigo `?sala=` continua entrando', async ({ page, browser }) => {
    // Links já foram mandados em conversas que ninguém vai voltar para
    // corrigir. Link de convite que morre é a pior coisa que este jogo poderia
    // fazer com quem o divulgou.
    const codigo = await criarSala(page, 'Ana');

    const beto = await outraPessoa(browser);
    await beto.goto(`/?sala=${codigo}`);
    await expect(beto.getByRole('button', { name: 'Entrar na sala' })).toBeEnabled();
  });

  test('CA-026: copiar convite põe a URL completa na área de transferência', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const codigo = await criarSala(page, 'Ana');

    await page.getByRole('button', { name: 'Copiar convite' }).click();

    const copiado = await page.evaluate(() => navigator.clipboard.readText());
    // URL COMPLETA, e não só o código: o que se cola num grupo tem de ser
    // clicável. Um código solto obriga quem recebe a saber para onde ir.
    expect(copiado).toBe(`${new URL(page.url()).origin}/j/${codigo}`);
  });

  test('o link copiado leva de fato a esta sala', async ({ page, context, browser }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const codigo = await criarSala(page, 'Ana');
    await page.getByRole('button', { name: 'Copiar convite' }).click();
    const link = await page.evaluate(() => navigator.clipboard.readText());

    // O teste que fecha o círculo: o que foi copiado é o que funciona. Os dois
    // lados podiam estar certos com o meio errado.
    const beto = await outraPessoa(browser);
    await beto.goto(link);
    await beto.getByRole('button', { name: 'Entrar na sala' }).click();
    await beto.locator('input').first().fill('Beto');
    await beto.getByRole('button', { name: 'Entrar na mesa' }).click();

    await expect(beto.locator('[data-codigo]')).toHaveText(codigo);
  });
});

test.describe('o lobby ao vivo', () => {
  test('CA-020: dois navegadores veem o terceiro entrar em até 1 s, sem recarregar', async ({ page, browser }) => {
    const codigo = await criarSala(page, 'Ana');

    const beto = await outraPessoa(browser);
    await entrarPorConvite(beto, codigo, 'Beto');
    await expect(naMesa(beto, 'Beto')).toBeVisible();

    // As duas abas que já estavam abertas. Nenhuma delas recarrega daqui para
    // frente — é isso que o critério verifica.
    const carla = await outraPessoa(browser);
    await entrarPorConvite(carla, codigo, 'Carla');

    // 1 s é o critério, não uma folga: passar disso é o defeito.
    await expect(naMesa(page, 'Carla')).toBeVisible({ timeout: 1000 });
    await expect(naMesa(beto, 'Carla')).toBeVisible({ timeout: 1000 });
  });

  test('quem sai some das outras telas, e a mesa não fica com fantasma', async ({ page, browser }) => {
    const codigo = await criarSala(page, 'Ana');
    const beto = await outraPessoa(browser);
    await entrarPorConvite(beto, codigo, 'Beto');
    await expect(naMesa(page, 'Beto')).toBeVisible();

    await beto.getByRole('button', { name: 'Sair da mesa' }).click();
    await expect(naMesa(page, 'Beto')).toBeHidden({ timeout: 2000 });
  });
});
