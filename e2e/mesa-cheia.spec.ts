import { expect, test, type Page } from '@playwright/test';
import { criarSala, entrarPorConvite, fecharAbasExtras, outraPessoa } from './apoio';

/**
 * Quatro navegadores de verdade — CA-312 e CA-313.
 *
 * São os dois testes que mais se aproximam do roteiro manual de `10` §8, e os
 * únicos que verificam, no navegador, que quatro telas independentes contam a
 * MESMA partida. Tudo o mais na suíte olha uma tela de cada vez.
 *
 * O CA-313 é o mais importante dos dois, e não é o mais vistoso: vazamento de
 * informação oculta é severidade 1 em `12`, no mesmo nível de corrupção de
 * estado. Num jogo entre amigos, a confiança no jogo é o produto — e a rodada
 * de testa é o único momento em que a projeção esconde de você algo que ela
 * mostra a todos os outros. É a regra mais fácil de quebrar sem perceber.
 */

test.afterEach(fecharAbasExtras);

const NOMES = ['Ana', 'Beto', 'Carla', 'Dario'] as const;

/** Quatro pessoas sentadas, prontas, com a partida começando. */
async function quatroNaMesa(
  page: Page,
  browser: Parameters<typeof outraPessoa>[0],
): Promise<Page[]> {
  const codigo = await criarSala(page, NOMES[0]);
  const telas: Page[] = [page];

  for (const nome of NOMES.slice(1)) {
    const outra = await outraPessoa(browser);
    await entrarPorConvite(outra, codigo, nome);
    telas.push(outra);
  }

  for (const tela of telas) {
    await tela.getByRole('button', { name: 'Estou pronto' }).click();
  }
  await page.getByRole('button', { name: 'Começar a partida' }).click();

  for (const tela of telas) {
    await expect(tela.getByText(/rodada 1/i)).toBeVisible({ timeout: 20_000 });
  }
  return telas;
}

/**
 * O que ESTA tela mostra da carta de testa de cada assento.
 *
 * A chave é o apelido, e o valor é o rótulo acessível da carta — que traz o
 * nome e a carta juntos para quem vê, e a frase "a sua carta, que você não vê"
 * para o dono. Ler pelo rótulo, e não pelo texto desenhado, é o que permite
 * comparar as quatro telas sem depender de layout.
 */
async function cartasDeTesta(tela: Page): Promise<string[]> {
  return tela.locator('[role="img"][aria-label]').evaluateAll(
    (nos) => nos
      .map((n) => n.getAttribute('aria-label') ?? '')
      .filter((r) => r.includes(' · ') || r.includes('que você não vê')),
  );
}

test.describe('quatro navegadores', () => {
  test('CA-313: na testa cada um vê as três cartas dos outros e um verso — nunca a sua', async ({ page, browser }) => {
    test.setTimeout(120_000);
    const telas = await quatroNaMesa(page, browser);

    // O que cada tela mostra. As quatro são lidas ANTES de qualquer aposta:
    // a rodada de testa é revelada no fim, e depois disso todo mundo vê tudo.
    const vistas = await Promise.all(telas.map(cartasDeTesta));

    for (const [i, visto] of vistas.entries()) {
      const meuVerso = visto.filter((r) => r.includes('que você não vê'));
      const dosOutros = visto.filter((r) => r.includes(' · '));

      // Um verso — o meu — e três cartas abertas. É a rodada de testa inteira
      // numa frase.
      expect(meuVerso, `${NOMES[i]!}: o próprio verso`).toHaveLength(1);
      expect(dosOutros, `${NOMES[i]!}: as cartas dos outros`).toHaveLength(3);

      // E nenhuma das três abertas é a minha: se o meu nome aparece numa carta
      // aberta na minha tela, a projeção vazou.
      for (const carta of dosOutros) {
        expect(carta.startsWith(`${NOMES[i]!} ·`), `${NOMES[i]!} viu a própria carta`).toBe(false);
      }
    }

    /**
     * A carta de cada um é a MESMA nas três telas que a veem.
     *
     * Sem isto, quatro telas poderiam cada uma inventar uma carta diferente e
     * os testes acima passariam: cada uma teria três abertas e um verso, e a
     * partida seria uma alucinação coletiva.
     */
    for (const [i, nome] of NOMES.entries()) {
      const comoOsOutrosVeem = vistas
        .filter((_, j) => j !== i)
        .map((visto) => visto.find((r) => r.startsWith(`${nome} ·`)));

      expect(new Set(comoOsOutrosVeem).size, `a carta de ${nome} discorda entre telas`).toBe(1);
      expect(comoOsOutrosVeem[0]).toBeTruthy();
    }

    /**
     * A prova mais forte, e a razão de este teste existir: o valor da minha
     * carta não está em lugar nenhum da MINHA página.
     *
     * `checkNoLeak` já garante isso na projeção, e RF-035 diz que nem em
     * atributo nem escondido por CSS. Aqui a garantia é do outro lado: o HTML
     * que chegou ao navegador é varrido inteiro. Se um dia alguém mandar a mão
     * completa "só para facilitar a animação", é aqui que aparece.
     */
    for (const [i, nome] of NOMES.entries()) {
      const minhaCarta = vistas
        .find((_, j) => j !== i)!
        .find((r) => r.startsWith(`${nome} ·`))!;
      const valor = minhaCarta.split(' · ')[1]!;

      const html = await telas[i]!.content();
      // O rank sozinho é curto demais para procurar no HTML inteiro ("2"
      // aparece em qualquer lugar). O que se procura é o rótulo COMPLETO que a
      // carta teria se estivesse aberta — que é exatamente o que vazaria.
      expect(html, `a carta de ${nome} vazou para a tela de ${nome}`)
        .not.toContain(`${nome} · ${valor}`);
    }
  });

  test('CA-312 @lento: as quatro telas contam a mesma partida, do começo ao vencedor', async ({ page, browser }) => {
    /**
     * Uma partida inteira leva o tempo que leva: cerca de três minutos.
     *
     * Não há como encurtá-la — as opções de mesa não têm tela (o cliente nunca
     * manda `host:setOptions`), então são 5 vidas e o jogo vai até sobrar um, com
     * a pausa de leitura de cada vaza. É o teste mais caro da suíte e o mais
     * próximo do roteiro manual de `10` §8: o único lugar onde "as quatro telas
     * concordam" deixa de ser afirmação sobre o servidor e passa a ser sobre o
     * produto.
     *
     * O prazo é generoso porque a máquina pode estar ocupada, e não porque a
     * partida precise dele.
     */
    test.setTimeout(1_200_000);
    const telas = await quatroNaMesa(page, browser);

    /**
     * O estado das quatro telas, numa ida só por tela.
     *
     * A primeira versão perguntava com localizadores — "está visível?",
     * "quantos botões?" — e cada pergunta é uma viagem até o navegador. Com
     * quatro telas e centenas de jogadas, a conversa custava mais que a partida
     * inteira: onze dos quinze minutos eram o laço perguntando, não o jogo
     * jogando.
     *
     * Um `evaluate` por tela devolve tudo de uma vez, lido do DOM que já está
     * lá. A partida continua levando o tempo que leva; o teste parou de
     * cobrar o dobro por assistir a ela.
     */
    const olhar = async (): Promise<{ vez: number; apostas: number; cartas: number; fim: boolean }> => {
      const estados = await Promise.all(telas.map((t) => t.evaluate(() => ({
        vez: document.querySelector('.vez-aviso') !== null,
        apostas: document.querySelectorAll('[data-apostas] button:not([disabled])').length,
        cartas: document.querySelectorAll('[data-mao] button').length,
        fim: document.querySelector('[data-vencedor]') !== null,
      })).catch(() => ({ vez: false, apostas: 0, cartas: 0, fim: false }))));

      const vez = estados.findIndex((e) => e.vez);
      return {
        vez,
        apostas: vez < 0 ? 0 : estados[vez]!.apostas,
        cartas: vez < 0 ? 0 : estados[vez]!.cartas,
        fim: estados.some((e) => e.fim),
      };
    };

    const vidasDe = (tela: Page) =>
      tela.locator('[aria-label$="vidas"], [aria-label$="vida"]').evaluateAll(
        (nos) => nos.map((n) => n.getAttribute('aria-label') ?? '').join('|'));

    let jogadas = 0;
    const limite = 2000;
    /**
     * Voltas sem nada acontecer.
     *
     * Existe porque um laço que espera sem limite não falha: ele pendura, e
     * quinze minutos depois o relatório diz "tempo esgotado" sem dizer onde.
     * Aconteceu na primeira execução deste teste. Com o guarda, uma partida que
     * empaca falha em vinte segundos dizendo de quem era a vez e o que havia na
     * mão — que é a diferença entre um teste que ensina e um que só reprova.
     */
    let paradas = 0;
    const PARADAS_ATE_DESISTIR = 60;

    while (jogadas < limite) {
      const agora = await olhar();
      if (agora.fim) break;

      const quem = agora.vez;
      if (quem < 0) {
        // Fase automática — recolhimento, revelação, acerto de contas. Quem
        // move é o relógio do servidor, e a tela sozinha se atualiza.
        await telas[0]!.waitForTimeout(300);
        paradas++;
        expect(paradas, 'a mesa parou sem ninguém na vez').toBeLessThan(PARADAS_ATE_DESISTIR);
        continue;
      }

      const tela = telas[quem]!;
      if (agora.apostas > 0) {
        await tela.locator('[data-apostas] button:not([disabled])').first()
          .click({ timeout: 3000 })
          .catch(() => { /* a vez passou entre a contagem e o clique */ });
        jogadas++;
        paradas = 0;
        continue;
      }

      const cartas = tela.locator('[data-mao] button');
      const naMao = agora.cartas;

      // A rodada de testa não tem mão: a carta está na cabeça da pessoa e a
      // rodada vai da aposta direto para a revelação. Aqui não há o que jogar.
      if (naMao === 0) {
        await tela.waitForTimeout(300);
        paradas++;
        expect(paradas, `a vez é de ${NOMES[quem]!} e a mão está vazia`)
          .toBeLessThan(PARADAS_ATE_DESISTIR);
        continue;
      }

      /**
       * Uma carta só não tem botão de confirmar — ela sai sozinha (`jogada.ts`).
       *
       * Foi o que travou este teste na primeira execução: o laço clicava na
       * carta e ficava esperando por um "Jogar esta carta" que nunca ia
       * aparecer, porque escolher entre uma opção não é escolha. Quinze minutos
       * de espera para descobrir uma decisão de produto que está certa.
       */
      if (naMao === 1) { await tela.waitForTimeout(1800); jogadas++; paradas = 0; continue; }

      // Aposta perdida na corrida também: o botão pode ter sumido entre a
      // contagem e o clique.

      /**
       * Daqui para baixo, nada pode bloquear.
       *
       * Entre ler de quem é a vez e clicar, a vez pode ter passado — e aí o
       * mesmo toque deixa de selecionar e passa a ENGATILHAR a carta para
       * depois (`podePreJogar`), sem botão de confirmar nenhum. O laço ficava
       * esperando por um "Jogar esta carta" que não ia aparecer, e o teste
       * morria quinze minutos depois dizendo só "tempo esgotado".
       *
       * A corrida é do teste, não do produto: quatro telas independentes mudam
       * sozinhas, e ler as quatro leva tempo. A resposta certa é o laço aceitar
       * ter perdido a corrida e tentar de novo, e não tentar ser mais rápido.
       */
      await cartas.first().click({ timeout: 3000 }).catch(() => { /* a vez passou */ });

      const confirmar = tela.getByRole('button', { name: /^Jogar/ });
      const podeConfirmar = await confirmar
        .waitFor({ state: 'visible', timeout: 3000 })
        .then(() => true)
        .catch(() => false);

      if (!podeConfirmar) {
        paradas++;
        expect(paradas, `${NOMES[quem]!} não conseguiu jogar`).toBeLessThan(PARADAS_ATE_DESISTIR);
        continue;
      }

      await confirmar.click({ timeout: 3000 }).catch(() => { /* idem */ });
      jogadas++;
      paradas = 0;
    }

    expect(jogadas, 'a partida não terminou dentro do limite de jogadas').toBeLessThan(limite);

    // --- o critério ---------------------------------------------------------

    for (const tela of telas) {
      await expect(tela.getByText('fim de partida')).toBeVisible({ timeout: 30_000 });
    }

    // O MESMO vencedor nas quatro. É a pergunta que a mesa faz em voz alta
    // quando a partida acaba, e quatro respostas diferentes seriam o pior
    // defeito possível neste produto.
    const vencedores = await Promise.all(
      telas.map((t) => t.locator('[data-vencedor]').textContent()));
    expect(new Set(vencedores.map((v) => v?.trim())).size, 'o vencedor discorda entre telas').toBe(1);

    // E as mesmas vidas finais, lidas do mesmo jeito nas quatro.
    const vidas = await Promise.all(telas.map(vidasDe));
    expect(new Set(vidas).size, 'as vidas discordam entre telas').toBe(1);
  });
});
