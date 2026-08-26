import type { PlayerId, RoundSummary, WithdrawalRecord } from './types.js';

/**
 * Nota de desempenho — **do motor**, e não da tela.
 *
 * Morava em `app/src/desempenho.ts`, e sair de lá é pré-requisito do histórico
 * (plano 01 §9.1). O motivo é um defeito que já aconteceu: a classificação
 * final vivia no motor E na tela, as duas divergiram em silêncio, e quem caiu
 * primeiro aparecia em segundo lugar (CA-360). Com o histórico gravado no
 * servidor e a tela de fim calculando por conta própria, o mesmo aconteceria —
 * e pior, porque o desacordo ficaria gravado no banco.
 *
 * O que NÃO veio junto foi a paleta: cor de faixa é token de CSS e continua no
 * cliente. Aqui só existe a `Faixa`, que é a classificação, não a tinta.
 *
 * Não é o placar — o placar é quem venceu. Isto responde outra pergunta:
 * **quem jogou melhor**. As duas se separam com frequência, e é justamente
 * essa diferença que dá assunto na mesa: dá para vencer por atrito, com
 * apostas ruins, enquanto alguém acertou tudo e caiu de uma vez na última
 * rodada.
 *
 * Três coisas, com pesos:
 *
 * - **Pontaria** (45%) — o quanto a aposta chegou perto, rodada a rodada, e
 *   não só se acertou em cheio. Errar por 1 numa rodada de 7 não é a mesma
 *   coisa que errar por 5, e uma taxa de acertos sozinha trata as duas igual.
 * - **Acertos em cheio** (30%) — a taxa de rodadas em que a aposta bateu
 *   exatamente. É o que a mesa comemora.
 * - **Sobrevivência** (25%) — quanto da partida a pessoa jogou. Vale, mas vale
 *   menos que a pontaria: chegar longe jogando mal é sorte, e o exemplo que
 *   motivou esta nota é exatamente o de alguém que jogou melhor e morreu antes.
 *
 * Vencer **garante o piso da faixa excelente**. Não é bônus somado: é piso.
 * Um vencedor que jogou bem passa disso pela própria pontaria.
 *
 * O piso é 8, e não 9, por uma razão medida e não escolhida: com 9, o segundo
 * colocado do cenário que motivou a nota — acerta tudo e desaba na última
 * rodada — chega a 8,1 e NUNCA passaria do vencedor mais sofrível. O piso
 * precisa ficar dentro do alcance de quem jogou bem e perdeu, senão "vencer
 * não garante a maior nota" vira letra morta. A fronteira da faixa excelente
 * acompanha o piso pelo mesmo motivo.
 */

export interface Desempenho {
  playerId: string;
  /** 0 a 10, uma casa decimal. */
  nota: number;
  faixa: Faixa;
  rodadasJogadas: number;
  acertos: number;
  /** Média de quão perto a aposta ficou, 0 a 1. */
  pontaria: number;
  venceu: boolean;
  abandonou: boolean;
}

export type Faixa = 'baixa' | 'media' | 'alta' | 'excelente';

const PESOS = { pontaria: 0.45, acertos: 0.30, sobrevivencia: 0.25 } as const;

/** Piso de quem venceu: vencer sempre rende uma nota excelente. */
const PISO_DO_VENCEDOR = 8;

export function faixaDe(nota: number): Faixa {
  if (nota >= 8) return 'excelente';
  if (nota >= 6.5) return 'alta';
  if (nota >= 4) return 'media';
  return 'baixa';
}

/**
 * O mínimo que a nota precisa saber.
 *
 * `MatchState` (servidor) e `PlayerView` (cliente) satisfazem os dois — mesma
 * ideia de `ParaRanking`, e pelo mesmo motivo: uma implementação, usada dos
 * dois lados, não tem como divergir.
 */
export interface ParaDesempenho {
  winnerIds: PlayerId[] | null;
  withdrawn: readonly WithdrawalRecord[];
  playerOrder: readonly PlayerId[];
  history: readonly RoundSummary[];
}

export function desempenhoDaPartida(partida: ParaDesempenho): Desempenho[] {
  const vencedores = new Set(partida.winnerIds ?? []);
  const abandonaram = new Set(partida.withdrawn.map((w) => w.playerId));
  // Abortadas fora da conta: elas não contam para ninguém, então incluí-las no
  // denominador faria a sobrevivência de quem jogou tudo cair sem motivo.
  const totalDeRodadas = partida.history.filter((r) => !r.aborted).length;

  return [...partida.playerOrder]
    .map((playerId) => {
      let rodadasJogadas = 0;
      let acertos = 0;
      let somaDePontaria = 0;

      for (const rodada of partida.history) {
        const aposta = rodada.bets[playerId];
        if (aposta === undefined) continue;
        // Rodada abortada não é desempenho de ninguém: ela é refeita e não
        // debita vida (RJ-155). Contá-la puniria quem estava na mesa quando
        // outra pessoa caiu.
        if (rodada.aborted) continue;

        rodadasJogadas++;
        const feitas = rodada.tricksWon[playerId] ?? 0;
        if (aposta === feitas) acertos++;

        // Erro normalizado pelo tamanho da rodada: o desvio máximo possível é
        // `cartasNaRodada` — apostar 0 e fazer todas, ou o contrário.
        const desvio = Math.abs(aposta - feitas);
        somaDePontaria += 1 - Math.min(1, desvio / Math.max(1, rodada.cardsThisRound));
      }

      const venceu = vencedores.has(playerId);
      const abandonou = abandonaram.has(playerId);

      if (rodadasJogadas === 0) {
        return {
          playerId, nota: 0, faixa: 'baixa' as const,
          rodadasJogadas: 0, acertos: 0, pontaria: 0, venceu, abandonou,
        };
      }

      const pontaria = somaDePontaria / rodadasJogadas;
      const taxaDeAcertos = acertos / rodadasJogadas;
      const sobrevivencia = totalDeRodadas === 0 ? 0 : rodadasJogadas / totalDeRodadas;

      const bruta =
        pontaria * PESOS.pontaria +
        taxaDeAcertos * PESOS.acertos +
        sobrevivencia * PESOS.sobrevivencia;

      const comPiso = venceu ? Math.max(bruta * 10, PISO_DO_VENCEDOR) : bruta * 10;
      const nota = Math.round(Math.min(10, Math.max(0, comPiso)) * 10) / 10;

      return { playerId, nota, faixa: faixaDe(nota), rodadasJogadas, acertos, pontaria, venceu, abandonou };
    })
    .sort((a, b) => b.nota - a.nota);
}

/**
 * O quanto cada um errou, rodada a rodada.
 *
 * Mora no motor, e não na tela, pelo mesmo motivo de `desempenhoDaPartida`
 * (plano 01 §9.1): o histórico grava estes números, e duas contas em dois
 * lugares divergem em silêncio — só que aqui o desacordo ficaria GRAVADO.
 *
 * A primeira versão desta tabela mostrava os TOTAIS de aposta e de mãos
 * feitas, e eles enganam: apostar 10 e fazer 10 na partida inteira parece
 * pontaria perfeita e pode ser o contrário — erra-se por 3 numa rodada, por 3
 * para o outro lado na seguinte, os totais fecham e o jogador perdeu 6 vidas
 * no caminho. Soma de aposta contra soma de mãos deixa os erros se cancelarem,
 * que é exatamente o que a vida perdida NÃO faz.
 *
 * O que substitui é o desvio: `|aposta − mãos feitas|` em cada rodada, que é a
 * conta que o jogo cobra (RJ-090). Mostrado como MÉDIA por rodada, e não como
 * total, porque quem caiu na rodada 3 jogou menos que quem chegou na 7 — um
 * total premiaria ser eliminado cedo.
 *
 * Rodada abortada (RJ-155) fica fora dos dois lados da conta: ela é refeita e
 * não debita ninguém, e contá-la puniria quem estava na mesa quando outra
 * pessoa caiu.
 */
export interface NumerosDoJogador {
  /** Média de `|aposta − vazas|` por rodada. Zero é pontaria perfeita. */
  erroMedio: number;
  /** O tombo isolado que a média esconde. */
  pior: number;
  acertos: number;
  jogadas: number;
}

export function numerosDaPartida(
  partida: ParaDesempenho,
): Map<PlayerId, NumerosDoJogador> {
  const linhas = new Map<PlayerId, NumerosDoJogador>();

  for (const id of partida.playerOrder) {
    let desvio = 0, pior = 0, acertos = 0, jogadas = 0;

    for (const r of partida.history) {
      const aposta = r.bets[id];
      if (aposta === undefined || r.aborted) continue;
      jogadas++;
      const feitas = r.tricksWon[id] ?? 0;
      const erro = Math.abs(aposta - feitas);
      desvio += erro;
      if (erro > pior) pior = erro;
      if (erro === 0) acertos++;
    }

    if (jogadas > 0) linhas.set(id, { erroMedio: desvio / jogadas, pior, acertos, jogadas });
  }

  return linhas;
}
