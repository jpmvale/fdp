import { expect, test, type Page } from '@playwright/test';
import { apostarQualquerCoisa, criarSala, quedaDeRede } from './apoio';

/**
 * A mesa sobrevivendo ao mundo real — CA-040 e CA-041.
 *
 * São os dois critérios que sustentam a promessa mais frágil do produto: que
 * fechar a aba sem querer, ou o metrô entrar num túnel, não custa a partida. Um
 * teste de integração prova que o servidor guarda o estado; só o navegador
 * prova que a pessoa o recebe de volta — com a mão certa, na fase certa, sem
 * ter tocado em nada.
 *
 * O estado é capturado num momento em que a mesa **espera por mim**: na minha
 * vez, nada avança até eu agir. Fora dessa janela os bots jogam a cada 900 ms, e
 * "idêntico" viraria uma corrida contra o relógio do jogo — o teste piscaria
 * sozinho e ensinaria a ignorar a luz vermelha.
 */

/** A mão, a fase, as vidas e a vez: o que precisa atravessar a queda intacto. */
async function retratoDaTela(page: Page): Promise<{
  cartas: string[];
  vidas: string;
  fase: string;
  minhaVez: boolean;
}> {
  const cartas = await page.locator('[data-mao] [aria-label]').evaluateAll(
    (nos) => nos.map((n) => n.getAttribute('aria-label') ?? ''));
  return {
    cartas,
    /**
     * O rótulo acessível, e NÃO o texto.
     *
     * Os corações debitados caem de dentro do mesmo `<span>` — a animação vive
     * ali. Lendo o texto, uma captura feita durante a queda vê "♥♥♥♥♥" onde já
     * são quatro vidas, e o teste falha por causa de meio segundo de animação
     * em vez de por defeito. O `aria-label` sai do número, e só dele.
     */
    vidas: (await page.locator('[data-minhas-vidas]').first().getAttribute('aria-label')) ?? '',
    fase: (await page.locator('[data-fase]').first().textContent())?.trim() ?? '',
    minhaVez: await page.locator('.vez-aviso').isVisible(),
  };
}

/**
 * Começa uma partida e joga até a minha vez numa rodada com cartas na mão.
 *
 * A rodada 1 é de testa: a pessoa NÃO vê a própria carta (RJ-033), então não há
 * mão para comparar. A rodada 2 já tem carta na mão, e é a primeira em que o
 * critério significa alguma coisa.
 */
async function ateMinhaVezComCartas(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Sentar um bot/ }).click();
  await page.getByRole('button', { name: 'Estou pronto' }).click();
  await page.getByRole('button', { name: 'Começar a partida' }).click();

  // A partida começa na rodada de testa. Atravessá-la é apostar e deixar o
  // relógio correr — o bot joga sozinho, e a rodada se resolve.
  await expect(page.locator('.vez-aviso')).toBeVisible({ timeout: 15_000 });
  await apostarQualquerCoisa(page);

  // A rodada 2 chega quando aparece carta na minha mão. Esperar pela CARTA, e
  // não por um tempo, é o que faz este apoio funcionar em máquina lenta.
  await expect(page.locator('[data-mao] [aria-label]').first())
    .toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.vez-aviso')).toBeVisible({ timeout: 30_000 });
}

test.describe('a mesa sobrevive', () => {
  test('CA-040: recarregar a página devolve mão, vidas e fase idênticas', async ({ page }) => {
    await criarSala(page, 'Ana');
    await ateMinhaVezComCartas(page);

    const antes = await retratoDaTela(page);
    expect(antes.cartas.length).toBeGreaterThan(0);
    expect(antes.minhaVez).toBe(true);

    const relogio = Date.now();
    await page.reload();

    // 1,5 s é o critério, não uma folga: passar disso é o defeito.
    await expect(page.locator('[data-mao] [aria-label]').first())
      .toBeVisible({ timeout: 1500 });
    const levou = Date.now() - relogio;

    const depois = await retratoDaTela(page);
    expect(depois).toEqual(antes);
    expect(levou, `voltou em ${String(levou)} ms`).toBeLessThan(1500);
  });

  test('CA-040: a sessão volta sozinha, sem passar pela tela de apelido', async ({ page }) => {
    // A outra metade do critério, e a que mais dói na prática: se recarregar
    // pedisse o apelido de novo, a pessoa voltaria como OUTRO jogador e a
    // cadeira dela ficaria vazia na mesa dos amigos.
    await criarSala(page, 'Ana');
    await ateMinhaVezComCartas(page);

    await page.reload();
    await expect(page.getByRole('button', { name: 'Entrar na mesa' })).toBeHidden();
    await expect(page.locator('.vez-aviso')).toBeVisible();
  });

  test('CA-041: 20 s sem rede e a mesa volta sozinha, sem tocar em nada', async ({ page }) => {
    await criarSala(page, 'Ana');
    await ateMinhaVezComCartas(page);
    const antes = await retratoDaTela(page);

    /**
     * 20 s é mais que a carência de transporte (10 s), de propósito.
     *
     * Abaixo dela a reconexão é invisível e o teste não provaria nada: provaria
     * que uma piscada é uma piscada. Acima, o servidor já considerou a pessoa
     * ausente e a mesa pausou — e é aí que "nada do meu estado se perde" passa
     * a ser uma afirmação com risco.
     */
    await quedaDeRede(page, 20_000);

    // SEM INTERAÇÃO: nenhum clique daqui até o fim. É a palavra do critério, e
    // é o que separa "reconecta" de "oferece um botão de reconectar".
    await expect(page.locator('.vez-aviso')).toBeVisible({ timeout: 30_000 });
    expect(await retratoDaTela(page)).toEqual(antes);
  });

  test('CA-041: cair e voltar dentro da carência não pausa a mesa', async ({ page }) => {
    await criarSala(page, 'Ana');
    await ateMinhaVezComCartas(page);
    const antes = await retratoDaTela(page);

    // Menos que a carência de 10 s: RNF-066 diz que isto é invisível. Uma
    // piscada de rede não pode virar acontecimento na mesa dos outros.
    await quedaDeRede(page, 3000);

    await expect(page.locator('.vez-aviso')).toBeVisible({ timeout: 20_000 });
    expect(await retratoDaTela(page)).toEqual(antes);
    await expect(page.getByText(/partida pausada/i)).toBeHidden();
  });
});
