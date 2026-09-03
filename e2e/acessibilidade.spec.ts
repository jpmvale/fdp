import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { apostarQualquerCoisa, criarSala, fecharAbasExtras } from './apoio';

/**
 * Acessibilidade — CA-140, CA-143 e CA-144.
 *
 * `08` é explícito sobre o que isto é e o que não é: ferramenta automatizada
 * pega cerca de um terço dos problemas reais, e os dois testes manuais
 * (CA-141 e CA-142) continuam obrigatórios para a v1 ser considerada entregue.
 * Verde aqui não quer dizer acessível; vermelho aqui quer dizer inacessível.
 *
 * O que o automático faz bem é o que ninguém consegue reconferir a cada PR:
 * contraste calculado em toda a árvore, rótulo faltando, papel errado, ordem de
 * cabeçalho. É esse terço que se compra barato.
 */

test.afterEach(fecharAbasExtras);

/**
 * As violações que importam: `critical` e `serious`.
 *
 * O critério é essa fronteira, e não "zero violações", porque `minor` e
 * `moderate` incluem recomendações que dependem de contexto — e um portão que
 * reprova por recomendação é um portão que alguém desliga.
 */
async function violacoesSerias(page: Page, contexto: string) {
  const { violations } = await new AxeBuilder({ page })
    // WCAG 2.2 AA é a meta declarada em `08`. Sem as etiquetas, o axe roda
    // regras de "best practice" que não são o compromisso assumido.
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();

  return violations
    .filter((v) => v.impact === 'critical' || v.impact === 'serious')
    .map((v) => `${contexto}: ${v.id} (${String(v.impact)}) — ${v.help} [${String(v.nodes.length)}x] ${v.nodes[0]?.target.join(' ') ?? ''}`);
}

/** Uma mesa em partida, com um bot, para as telas de dentro do jogo. */
async function emPartida(page: Page): Promise<void> {
  await criarSala(page, 'Ana');
  await page.getByRole('button', { name: /Sentar um bot/ }).click();
  await page.getByRole('button', { name: 'Estou pronto' }).click();
  await page.getByRole('button', { name: 'Começar a partida' }).click();
  await expect(page.getByText(/rodada 1/i)).toBeVisible({ timeout: 15_000 });
}

test.describe('CA-140: axe-core nas telas principais', () => {
  test('Home', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Criar sala' })).toBeVisible();
    expect(await violacoesSerias(page, 'Home')).toEqual([]);
  });

  test('Perfil — quem você é na mesa', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Criar sala' }).click();
    await expect(page.getByRole('button', { name: 'Entrar na mesa' })).toBeVisible();
    expect(await violacoesSerias(page, 'Perfil')).toEqual([]);
  });

  test('Lobby', async ({ page }) => {
    await criarSala(page, 'Ana');
    expect(await violacoesSerias(page, 'Lobby')).toEqual([]);
  });

  test('Lobby com bot sentado e chat aberto', async ({ page }) => {
    // O lobby vazio esconde metade dos controles. O que se verifica aqui é a
    // versão que as pessoas realmente veem.
    await criarSala(page, 'Ana');
    await page.getByRole('button', { name: /Sentar um bot/ }).click();
    await page.getByRole('button', { name: /chat da mesa/ }).click();
    await expect(page.getByPlaceholder(/escreva para a mesa/i)).toBeVisible();
    expect(await violacoesSerias(page, 'Lobby com bot')).toEqual([]);
  });

  test('Mesa em partida', async ({ page }) => {
    // `08` pede AA "no que for aplicável" na Mesa — é a tela mais densa do
    // produto, e a que mais depende de cor, posição e movimento.
    await emPartida(page);
    expect(await violacoesSerias(page, 'Mesa')).toEqual([]);
  });

  test('Regras e log — a gaveta do ☰', async ({ page }) => {
    await emPartida(page);
    await page.getByRole('button', { name: 'Abrir as regras' }).click();
    await expect(page.getByRole('tablist')).toBeVisible();
    expect(await violacoesSerias(page, 'Menu')).toEqual([]);
  });

  test('Fim de partida', async ({ page }) => {
    /**
     * Chegar ao fim sem jogar a partida inteira.
     *
     * Com bots e nenhuma outra pessoa na mesa, o host pode encerrar pelo menu —
     * e é justamente o caso em que esse botão existe. A tela de Fim é a mesma,
     * venha ela de uma partida jogada ou encerrada.
     */
    await emPartida(page);
    await page.getByRole('button', { name: 'Abrir as regras' }).click();
    // Um toque só: a confirmação de dois passos do menu é do "sair da mesa",
    // que custa a partida de quem toca. Encerrar contra bots não tira nada de
    // ninguém, e por isso não pede segunda confirmação.
    await page.getByRole('button', { name: /Encerrar a partida/ }).click();

    await expect(page.getByText('fim de partida')).toBeVisible({ timeout: 15_000 });
    expect(await violacoesSerias(page, 'Fim')).toEqual([]);
  });
});

test.describe('CA-143: sem movimento para quem pediu sem movimento', () => {
  /**
   * A emulação é ligada na PÁGINA, e conferida antes de qualquer asserção.
   *
   * `test.use({ reducedMotion: 'reduce' })` não pegou aqui: `matchMedia` dentro
   * da página respondia `false`, e o primeiro teste deste bloco passava por não
   * haver carta em voo — verde por engano, para sempre. É a mesma armadilha do
   * `setOffline`, que também "funcionava" sem fazer nada.
   *
   * A regra que sai daí vale para toda emulação: **afirme que ela está ligada
   * antes de afirmar o que ela causa.** Um teste que assume a condição está
   * testando o outro caso, e não avisa.
   */
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const ligado = await page.evaluate(
      () => matchMedia('(prefers-reduced-motion: reduce)').matches);
    expect(ligado, 'a emulação de movimento reduzido não está ativa').toBe(true);
  });

  test('a carta jogada não viaja pela tela', async ({ page }) => {
    await emPartida(page);
    await apostarQualquerCoisa(page);

    /**
     * O que o critério proíbe é DESLOCAMENTO, não toda mudança.
     *
     * A carta some por opacidade em vez de viajar até o assento do vencedor —
     * a informação ("esta carta foi para lá") continua chegando, pelo anel de
     * vencedor e pelo texto, e o que se elimina é o movimento que causa
     * enjoo em quem pediu para não tê-lo (RNF-034).
     */
    const viaja = await page.evaluate(() => {
      const cartas = [...document.querySelectorAll('[role="img"][aria-label]')];
      return cartas.some((c) => {
        const estilo = getComputedStyle(c.parentElement ?? c);
        const t = estilo.transform;
        // `matrix(1,0,0,1,0,0)` e `none` são a identidade: nada se moveu.
        const deslocou = t !== 'none' && !/matrix\(1, ?0, ?0, ?1, ?0, ?0\)/.test(t);
        return deslocou && estilo.transitionProperty.includes('transform');
      });
    });
    expect(viaja, 'uma carta está com transição de deslocamento').toBe(false);
  });

  test('nenhuma animação infinita fica rodando', async ({ page }) => {
    /**
     * O caso que já mordeu este projeto duas vezes.
     *
     * A regra global de `estilos.css` marca `animation-duration: 0.01ms
     * !important`, e isso NÃO desliga animação: ela termina no primeiro
     * instante e congela no quadro final. Foi assim que a borda "É A SUA VEZ!"
     * ficou pálida e os pontinhos da fila ficaram quase invisíveis — os dois
     * precisaram de `animation-name: none` explícito.
     *
     * Este teste é o guarda contra a terceira vez: qualquer animação `infinite`
     * viva com movimento reduzido é um `animation-name` que alguém esqueceu.
     */
    await emPartida(page);

    const infinitas = await page.evaluate(() => {
      const vivas: string[] = [];
      for (const el of document.querySelectorAll('*')) {
        const e = getComputedStyle(el);
        if (e.animationName !== 'none' && e.animationIterationCount.includes('infinite')) {
          vivas.push(`${el.className || el.tagName}: ${e.animationName}`);
        }
      }
      return vivas;
    });
    expect(infinitas).toEqual([]);
  });
});

test.describe('CA-144: zoom de 200%', () => {
  /**
   * 320 px, que é o número que a WCAG define — e não 188.
   *
   * "Zoom de 200%" mistura dois critérios. O 1.4.4 (Resize text) é sobre
   * ampliar o TEXTO; o 1.4.10 (Reflow) é o que proíbe rolagem nas duas
   * direções, e ele é medido de um jeito só: o conteúdo tem de caber em **320
   * CSS px** de largura. É o alvo testável, é o equivalente a 400% de zoom num
   * monitor de 1280, e é a largura do celular mais estreito em uso.
   *
   * A primeira versão deste teste mediu a 188 px — 375 dividido por dois — e
   * cobrava mais que o requisito. Achou dois transbordamentos reais no caminho
   * (os botões de fila e o "copiar convite"), então o exagero rendeu; mas o
   * portão fica no número da norma, senão ele reprova por rigor inventado.
   *
   * Abaixo de 320 a mesa continua encolhendo em degraus, até 264 px. Esse é o
   * piso declarado: mais estreito que isso a carta fica menor que a unha, e um
   * jogo que "cabe" e não se enxerga não é acessível — é só uma métrica verde.
   */
  test.use({ viewport: { width: 320, height: 512 } });

  test('nenhuma tela rola de lado, e as ações continuam alcançáveis', async ({ page }) => {
    const semRolagemLateral = async (onde: string) => {
      const transborda = await page.evaluate(() =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      expect(transborda, `${onde} rola de lado a 200%`).toBe(false);
    };

    /**
     * Alcançável, e não "visível sem rolar".
     *
     * A WCAG 1.4.10 permite rolagem em UMA direção e proíbe as duas ao mesmo
     * tempo — vertical pode, horizontal não. A primeira versão deste teste
     * exigia `toBeInViewport` e reprovou o "Entrar na mesa" do Perfil, que fica
     * abaixo da grade de 24 emojis: a tela estava certa e o teste é que estava
     * cobrando um critério mais duro que o requisito.
     *
     * O que o critério pede é que a ação exista, chegue à tela e responda.
     */
    const alcancavel = async (nome: string | RegExp) => {
      const botao = page.getByRole('button', { name: nome });
      await botao.scrollIntoViewIfNeeded();
      await expect(botao).toBeInViewport();
      await expect(botao).toBeEnabled();
      return botao;
    };

    await page.goto('/');
    await semRolagemLateral('Home');
    await alcancavel('Criar sala');

    await page.getByRole('button', { name: 'Criar sala' }).click();
    await semRolagemLateral('Perfil');
    await page.locator('input').first().fill('Ana');
    await (await alcancavel('Entrar na mesa')).click();

    await expect(page.locator('[data-codigo]')).toBeVisible();
    await semRolagemLateral('Lobby');
    await alcancavel(/Sentar um bot/);

    await page.getByRole('button', { name: /Sentar um bot/ }).click();
    await page.getByRole('button', { name: 'Estou pronto' }).click();
    await page.getByRole('button', { name: 'Começar a partida' }).click();
    await expect(page.getByText(/rodada 1/i)).toBeVisible({ timeout: 15_000 });

    /**
     * A Mesa é a exceção conhecida, e é preciso ser explícito sobre ela.
     *
     * O feltro tem geometria MEDIDA em pixels e é desenhado para 360 px de
     * largura (`07`, RF-092/RF-093): a 188 px ele não encolhe, ele fica maior
     * que a tela. O que o critério exige é que nenhuma AÇÃO fique inacessível —
     * e as ações da Mesa (apostar, jogar, o menu) vivem fora do feltro, na
     * coluna que acompanha a largura.
     */
    await semRolagemLateral('Mesa');
    await alcancavel('Abrir as regras');

    const aposta = page.locator('[data-apostas] button').first();
    await aposta.scrollIntoViewIfNeeded();
    await expect(aposta).toBeInViewport();
  });
});
