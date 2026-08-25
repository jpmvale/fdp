/**
 * O que dá para saber olhando a mesa — e só isso.
 *
 * Este módulo é a fronteira da honestidade dos bots difíceis. Tudo aqui sai da
 * `PlayerView`, a MESMA projeção que um humano recebe: cartas já jogadas nesta
 * rodada, apostas declaradas, quantas cartas cada um ainda tem. Nada é
 * espiado, porque não há o que espiar — a informação que o bot não deve ter
 * não chega até este pacote (CA-325).
 *
 * A diferença entre um bot fácil e um difícil não é acesso a informação. É
 * quanto do que está à vista ele de fato usa.
 */

import type { Card, PlayerId, PlayerView } from '@fdp/rules';

/** Quantos valores distintos existem: de 2 a A. */
export const VALORES = 13;
/** O maior valor possível (`A`), de RJ-021. */
export const MAIOR = 14;

/**
 * Toda carta que este jogador já viu nesta rodada, com repetição.
 *
 * Repetição importa: com mais de um baralho existem cartas idênticas (RJ-026),
 * e tratar "já vi um Ás" como "o Ás acabou" erraria feio numa mesa de 8, onde
 * o sabot tem dois baralhos.
 */
export function cartasVistas(visao: PlayerView): number[] {
  const vistas: number[] = [];

  for (const vaza of visao.resolvedTricks) {
    for (const jogada of vaza.plays) vistas.push(jogada.card.value);
  }
  for (const jogada of visao.currentTrick?.plays ?? []) vistas.push(jogada.card.value);
  for (const carta of visao.hand) vistas.push(carta.value);
  // Rodada de testa: as cartas alheias estão à vista o tempo todo.
  for (const carta of Object.values(visao.foreheadCards)) vistas.push(carta.value);

  return vistas;
}

/**
 * Chance de uma carta de valor `valor` bater UMA carta desconhecida.
 *
 * Conta o sabot de verdade — `deckCount` baralhos de 52 (RJ-024) — e desconta
 * o que já apareceu. É a diferença entre "um Rei costuma ganhar" e "os quatro
 * Ases já saíram, então o meu Rei ganha".
 *
 * Empate conta como derrota de propósito: com `EMPATE_ANULA_CARTAS` a vaza
 * some, e com a outra regra o desempate não favorece ninguém em particular.
 * Um bot que tratasse empate como vitória apostaria alto demais.
 */
export function chanceContraUma(valor: number, visao: PlayerView): number {
  const porValor = 4 * visao.deckCount;
  const vistas = cartasVistas(visao);

  let acimaOuIgual = 0;
  let restantes = 0;

  for (let v = 2; v <= MAIOR; v++) {
    const jaVistas = vistas.filter((x) => x === v).length;
    const sobrando = Math.max(0, porValor - jaVistas);
    restantes += sobrando;
    if (v >= valor) acimaOuIgual += sobrando;
  }

  // A própria carta está entre as vistas e não pode disputar consigo mesma.
  const oponentes = Math.max(0, restantes - 1);
  if (oponentes <= 0) return 1;

  const perde = Math.max(0, acimaOuIgual - 1) / oponentes;
  return Math.max(0, Math.min(1, 1 - perde));
}

/** Chance de a carta sobreviver a `quantos` adversários desconhecidos. */
export const chanceDeGanhar = (valor: number, quantos: number, visao: PlayerView): number =>
  chanceContraUma(valor, visao) ** Math.max(1, quantos);

/**
 * Quantas mãos ainda serão disputadas nesta rodada, contando a que está aberta.
 */
export const maosRestantes = (visao: PlayerView): number =>
  Math.max(0, visao.cardsThisRound - visao.resolvedTricks.length);

/** Quantas mãos este jogador ainda precisa para bater a própria aposta. */
export function faltaGanhar(visao: PlayerView): number {
  const aposta = visao.bets[visao.viewerId] ?? 0;
  const feitas = visao.tricksWon[visao.viewerId] ?? 0;
  return aposta - feitas;
}

/**
 * Quantas mãos a mesa inteira ainda promete, contra quantas existem.
 *
 * Positivo: prometeram mais do que há — alguém vai errar por excesso, e as
 * cartas altas estão disputadas. Negativo: prometeram menos, e ganhar mão
 * virou risco para vários. É a leitura que separa quem só olha a própria mão
 * de quem olha a mesa, e a regra da soma (RJ-050) garante que nunca dá zero.
 */
export function pressaoDaMesa(visao: PlayerView): number {
  let prometidas = 0;
  let feitas = 0;
  for (const id of visao.playerOrder) {
    const aposta = visao.bets[id];
    if (aposta === undefined) continue;
    prometidas += aposta;
    feitas += visao.tricksWon[id] ?? 0;
  }
  return (prometidas - feitas) - maosRestantes(visao);
}

/**
 * A mesma leitura, mas na hora de APOSTAR — e a conta é outra.
 *
 * `pressaoDaMesa` compara o que a mesa prometeu com o que resta, e só vale com
 * todas as apostas na mesa. Durante a rodada de apostas a soma está pela
 * metade: comparar duas apostas declaradas contra as sete mãos da rodada faz
 * todo mundo que aposta cedo enxergar uma mesa vazia e apostar demais. Foi
 * exatamente esse o erro — medido, não suposto: o bot com esse ajuste perdia
 * de um que não tinha ajuste nenhum.
 *
 * Aqui a comparação é proporcional: quem já apostou responde pela sua fatia
 * das mãos. Positivo = a mesa está prometendo acima da fatia dela, e as mãos
 * que sobram valem menos do que a minha mão sugere.
 */
export function pressaoNasApostas(visao: PlayerView): number {
  const total = visao.playerOrder.length;
  if (total === 0) return 0;

  const jaApostaram = visao.playerOrder.filter((id) => visao.bets[id] !== undefined);
  if (jaApostaram.length === 0) return 0;

  const prometido = jaApostaram.reduce((n, id) => n + (visao.bets[id] ?? 0), 0);
  const fatia = (jaApostaram.length / total) * visao.cardsThisRound;
  return prometido - fatia;
}

/** A maior carta na mesa agora; 0 se a mão está vazia. */
export function maiorNaMesa(visao: PlayerView): number {
  const valores = (visao.currentTrick?.plays ?? []).map((j) => j.card.value);
  return valores.length > 0 ? Math.max(...valores) : 0;
}

/**
 * Quantos ainda jogam DEPOIS de mim nesta mão.
 *
 * Jogar por último é a única posição com certeza: sei exatamente o que preciso
 * bater. Jogar primeiro é a pior. Um bot que ignora isso trata as duas como
 * iguais e desperdiça carta alta contra ninguém.
 */
export function depoisDeMim(visao: PlayerView): number {
  const vaza = visao.currentTrick;
  if (!vaza) return Math.max(0, visao.playerOrder.length - 1);
  const minha = vaza.playOrder.indexOf(visao.viewerId);
  if (minha < 0) return Math.max(0, vaza.playOrder.length - vaza.plays.length - 1);
  return Math.max(0, vaza.playOrder.length - 1 - minha);
}

/** As cartas da mão, da menor para a maior. */
export const ordenadas = (mao: readonly Card[]): Card[] =>
  [...mao].sort((a, b) => a.value - b.value);

export type { PlayerId };
