import { expect, test, type Page } from '@playwright/test';
import {
  apostarQualquerCoisa, controlarRede, criarSala, entrarPorConvite,
  fecharAbasExtras, outraPessoa,
} from './apoio';

/**
 * A pausa vista do navegador — CA-059 e CA-315.
 *
 * É o fluxo social mais delicado do jogo: alguém some, a mesa para, e três
 * pessoas ficam olhando para uma tela decidindo se esperam ou seguem sem ele.
 * O motor e a sala já são testados à exaustão; o que nunca tinha sido
 * verificado é o que as OUTRAS pessoas veem enquanto isso — que é a parte que
 * decide se a mesa espera com paciência ou desiste por não entender.
 *
 * Aqui não há como encurtar o relógio: RJ-151 dá 60 s antes de o host poder
 * decidir, e esse minuto É o requisito — ele existe para que ninguém seja
 * abandonado por impaciência. Um teste que o pulasse testaria outra coisa.
 */

test.afterEach(fecharAbasExtras);

/** Duas pessoas numa partida, com a rodada de testa já apostada por ambas. */
async function mesaDeDois(page: Page, browser: Parameters<typeof outraPessoa>[0]): Promise<{
  beto: Page;
  codigo: string;
}> {
  const codigo = await criarSala(page, 'Ana');
  const beto = await outraPessoa(browser);
  await entrarPorConvite(beto, codigo, 'Beto');

  await beto.getByRole('button', { name: 'Estou pronto' }).click();
  await page.getByRole('button', { name: 'Estou pronto' }).click();
  await page.getByRole('button', { name: 'Começar a partida' }).click();

  await expect(page.getByText(/rodada 1/i)).toBeVisible({ timeout: 15_000 });
  await expect(beto.getByText(/rodada 1/i)).toBeVisible({ timeout: 15_000 });
  return { beto, codigo };
}

test.describe('a mesa esperando por quem sumiu', () => {
  test('CA-315: quem fica vê o overlay NOMEANDO quem caiu', async ({ page, browser }) => {
    const { beto } = await mesaDeDois(page, browser);

    // Fecha o navegador de verdade — não é sair pela porta, é sumir. A
    // diferença importa: sair é uma decisão anunciada, sumir é o caso que a
    // pausa existe para tratar.
    await beto.context().close();

    /**
     * Nomear quem caiu é o requisito, não um detalhe.
     *
     * "Partida pausada" sozinho faz a mesa olhar em volta tentando descobrir
     * quem foi — e, sem saber, ela não consegue nem esperar com propósito nem
     * decidir seguir. É a mesma razão de o pronto do lobby dizer quem falta.
     */
    const aviso = page.getByText(/partida pausada/i);
    await expect(aviso).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Beto caiu/)).toBeVisible();

    // E, antes dos 60 s, a mesa é informada de que não há nada a fazer ainda.
    await expect(page.getByRole('button', { name: /Seguir sem/ })).toBeHidden();
  });

  test('CA-315: passados 60 s, o host vê as duas opções — e as duas dizem a consequência', async ({ page, browser }) => {
    // O minuto de RJ-151 é o requisito. Não dá para encurtá-lo sem testar
    // outra coisa, então o teste tem o tempo que o jogo tem.
    test.setTimeout(180_000);

    const { beto } = await mesaDeDois(page, browser);
    await beto.context().close();
    await expect(page.getByText(/partida pausada/i)).toBeVisible({ timeout: 20_000 });

    // Os botões dizem a CONSEQUÊNCIA, não o verbo: "seguir sem Beto — perde as
    // vidas e sai" é uma decisão informada; "continuar" seria um chute.
    await expect(page.getByRole('button', { name: /Seguir sem Beto/ }))
      .toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole('button', { name: /Encerrar a partida para todos/ }))
      .toBeVisible();
  });

  test('CA-059: reconectar numa partida pausada mostra o overlay, não uma tela de erro', async ({ page, browser }) => {
    const { beto } = await mesaDeDois(page, browser);
    await beto.context().close();
    await expect(page.getByText(/partida pausada/i)).toBeVisible({ timeout: 20_000 });

    /**
     * A Ana recarrega DURANTE a pausa.
     *
     * É o caso que RF-049 nomeia, e é fácil de errar: o cliente pede o estado,
     * recebe uma sala que não está "em partida", e a tela mais óbvia de
     * escrever para isso é um erro. Quem recarregasse no pior momento levaria a
     * impressão de que a partida acabou.
     */
    await page.reload();

    await expect(page.getByText(/partida pausada/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Beto caiu/)).toBeVisible();
    // A mesa continua embaixo do aviso: pausada não é acabada.
    await expect(page.getByText(/rodada 1/i)).toBeVisible();
  });

  test('quem volta antes da decisão desfaz a pausa para todo mundo', async ({ page, browser }) => {
    const { beto } = await mesaDeDois(page, browser);

    /**
     * O Beto perde a rede — não fecha o navegador.
     *
     * É a diferença entre este teste e o CA-315, e é a diferença que o produto
     * inteiro trata: sumir de vez e cair na rede parecem a mesma coisa para o
     * servidor no primeiro instante, e param de parecer quando a pessoa volta.
     *
     * Fechar só a ABA não serve para simular a queda, aliás — foi preciso medir
     * para descobrir: o socket dela sobreviveu 20 s ao `page.close()`, e a mesa
     * não pausou. Fechar o contexto inteiro derruba; a queda controlada também,
     * e ainda deixa voltar.
     */
    const rede = await controlarRede(beto);
    rede.derrubar();

    await expect(page.getByText(/partida pausada/i)).toBeVisible({ timeout: 25_000 });
    await expect(page.getByText(/Beto caiu/)).toBeVisible();

    rede.voltar();

    // A pausa some sozinha, para os DOIS, sem ninguém clicar em nada. É o
    // oposto do CA-315: aqui a espera deu certo, e a mesa precisa perceber.
    await expect(page.getByText(/partida pausada/i)).toBeHidden({ timeout: 30_000 });
    await expect(beto.getByText(/partida pausada/i)).toBeHidden({ timeout: 10_000 });
    await expect(beto.getByText(/rodada 1/i)).toBeVisible();
  });

  test('jogada durante a pausa não passa (CA-047, pelo lado da tela)', async ({ page, browser }) => {
    // CA-047 já é testado no motor: o comando é recusado com `MATCH_PAUSED`.
    // O que se verifica aqui é a outra metade, a que a pessoa vive: com a mesa
    // parada, os controles de jogada não ficam ali oferecendo uma ação que o
    // servidor vai recusar.
    const { beto } = await mesaDeDois(page, browser);
    await apostarQualquerCoisa(page);
    await beto.context().close();
    await expect(page.getByText(/partida pausada/i)).toBeVisible({ timeout: 20_000 });

    await expect(page.locator('[data-apostas] button')).toHaveCount(0);
    await expect(page.locator('.vez-aviso')).toBeHidden();
  });
});
