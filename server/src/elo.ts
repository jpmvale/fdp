/**
 * O elo das partidas ranqueadas (plano 03 §4).
 *
 * **Puro, e por isso testável até o fim.** Uma função de `(colocações, elos
 * antes, quem abandonou)` para `deltas` não precisa de banco, de rede nem de
 * relógio — e é onde moram os erros que ninguém percebe até virarem
 * reclamação. É a mesma razão de `packages/bot` e de `desempenho.ts` serem
 * puros.
 *
 * Não mora em `@fdp/rules` porque o motor não aprende o que é elo (plano 03,
 * invariante I-2): uma partida ranqueada e uma partida entre amigos são a
 * MESMA partida. Elo lê o resultado depois, de fora.
 */

// Onde toda conta começa. Vem do protocolo porque o banco também precisa dele:
// é o valor lido para quem ainda não tem linha na tabela `elo`.
export { ELO_INICIAL } from '@fdp/protocol';

/**
 * O que se leva por abandonar, ALÉM do pior resultado da mesa (D-2).
 *
 * Punição fixa e não proporcional: quem abandona uma partida em que estava
 * ganhando abandonou tanto quanto quem estava perdendo, e escalar pela
 * colocação faria a punição depender de um número que a pessoa não produziu —
 * o assento foi terminado por um bot.
 */
export const PUNICAO_ABANDONO = 25;

/**
 * Elo nunca desce abaixo disto.
 *
 * Quebra a soma zero de propósito (§4.2). A alternativa é um buraco sem fundo,
 * em que quem passou por uma sequência ruim carrega um número que só serve
 * para lembrar disso. O erro acumulado só acontece em quem está no fundo, e o
 * benefício é que ninguém é empurrado para fora do jogo por um placar.
 */
export const ELO_MINIMO = 0;

/**
 * O peso de uma partida, por quantas ranqueadas a conta já jogou.
 *
 * Cai com a experiência: no começo o sistema não sabe nada sobre você e
 * precisa te levar rápido para perto do seu lugar; depois, uma partida ruim
 * não pode desfazer um mês.
 *
 * A contagem é a de ANTES desta partida — a primeira partida de uma conta
 * recebe `partidas = 0` e cai na primeira faixa.
 */
export function pesoDe(partidasJogadas: number): number {
  if (partidasJogadas < 10) return 80;
  if (partidasJogadas < 30) return 50;
  return 30;
}

/**
 * A posição na mesa, normalizada em torno do meio: `+1` no primeiro, `−1` no
 * último, `0` em quem terminou exatamente no meio.
 *
 * É esta normalização que faz a regra valer igual numa mesa de 4 e numa de 8 —
 * e é ela que dá o comportamento pedido, em que o 2º ganha mais que o 3º sem
 * que ninguém precise escrever uma tabela por tamanho de mesa.
 *
 * Numa mesa de tamanho ímpar existe uma colocação exatamente no meio, e ela
 * recebe zero. Não é caso especial: é o ponto neutro aparecendo de verdade.
 */
export function relativa(colocacao: number, naMesa: number): number {
  if (naMesa < 2) return 0;
  const neutro = (naMesa + 1) / 2;
  return (neutro - colocacao) / (neutro - 1);
}

export interface JogadorRanqueado {
  contaId: string;
  colocacao: number;
  eloAntes: number;
  /** Já jogadas ANTES desta. Define o peso. */
  partidasAntes: number;
  /**
   * Saiu no meio e o assento foi terminado por um bot (D-9).
   *
   * Quem caiu e voltou antes de o assento virar bot **não** abandonou: o
   * relógio do abandono é o mesmo da ausência (RJ-117), e o plano é explícito
   * em que queda de internet não é abandono enquanto for queda.
   */
  abandonou: boolean;
}

export interface DeltaDeElo {
  contaId: string;
  eloAntes: number;
  /** Já com o piso aplicado: `eloAntes + delta` nunca fica negativo. */
  delta: number;
  eloDepois: number;
}

/**
 * Os deltas de uma mesa inteira.
 *
 * De uma vez, e não um por jogador, porque a conta é da MESA: a soma dos
 * deltas de quem não abandonou é zero, e isso é uma propriedade do conjunto,
 * não de cada linha. Calcular jogador a jogador convidaria a chamar com uma
 * mesa incompleta, e o resultado seria inflação silenciosa.
 *
 * Bots e convidados não entram: não têm conta, e uma mesa com um assento
 * abandonado continua tendo o tamanho que tinha — `naMesa` é quantos JOGARAM,
 * incluindo quem saiu, porque foi contra todos eles que a colocação se formou.
 */
export function deltasDaMesa(jogadores: JogadorRanqueado[], naMesa: number): DeltaDeElo[] {
  return jogadores.map((j) => {
    const k = pesoDe(j.partidasAntes);
    // Abandono não olha a colocação que o assento acabou tirando: a pessoa não
    // jogou aquilo. Recebe o pior resultado da mesa e mais a punição fixa.
    const bruto = j.abandonou
      ? -k - PUNICAO_ABANDONO
      : Math.round(k * relativa(j.colocacao, naMesa));

    // O piso corta o delta, não o resultado: gravar um delta que não bate com
    // a diferença dos dois elos faria a tela do perfil mentir na conta mais
    // simples que ela faz.
    const depois = Math.max(ELO_MINIMO, j.eloAntes + bruto);
    return { contaId: j.contaId, eloAntes: j.eloAntes, delta: depois - j.eloAntes, eloDepois: depois };
  });
}

/** As faixas de D-3. Ordem do topo para a base — a primeira que couber vence. */
export const FAIXAS = [
  { nome: 'Diamante', minimo: 1800 },
  { nome: 'Platina', minimo: 1500 },
  { nome: 'Ouro', minimo: 1200 },
  { nome: 'Prata', minimo: 900 },
  { nome: 'Bronze', minimo: -Infinity },
] as const;

export type Faixa = (typeof FAIXAS)[number]['nome'];

export function faixaDoElo(pontos: number): Faixa {
  return (FAIXAS.find((f) => pontos >= f.minimo) ?? FAIXAS[FAIXAS.length - 1]!).nome;
}
