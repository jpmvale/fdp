/**
 * Resolução de vaza, empates e o registro de morte.
 * Normativo: `02` §3.6.
 */

import type { Card, CardId, PlayerId, TieRule, TrickPlay } from './types.js';

export interface TrickResolution {
  winnerId: PlayerId | null;
  /** Valor empatado mais alto, se houve empate. Base de RJ-086/RJ-087. */
  annulledValue: number | null;
}

/**
 * O que a mesa mostra sobre a disputa.
 *
 * Vale para a vaza pela metade e para a fechada — a diferença é do chamador,
 * que sabe quantos ainda têm carta; daqui `winnerId` é sempre "quem ganha
 * entre ESTAS cartas". Tentei devolver um `leadingId` separado para a parcial
 * e era a mesma coisa com dois nomes: a função não tem como saber se a vaza
 * acabou, e um segundo campo só criaria a chance de os dois discordarem.
 */
export interface TrickStanding extends TrickResolution {
  /**
   * Cartas que saíram da disputa por empate anulado, em `EMPATE_ANULA_CARTAS`.
   * É o que permite mostrar POR QUE o destaque pulou para uma carta menor.
   */
  annulledIds: PlayerId[];
}

/**
 * `02` §3.6.1, sobre cartas já resolvidas.
 *
 * `EMPATE_ANULA_VAZA`: empate no topo → ninguém leva.
 * `EMPATE_ANULA_CARTAS`: as empatadas se anulam e a disputa desce para a maior
 * carta restante, em cascata, até sobrar uma única — ou nada.
 *
 * Serve ao motor e à interface. O cliente precisa da MESMA escada de empate
 * para saber que carta destacar, e reimplementá-la lá seria pedir para as duas
 * divergirem — no caso mais difícil de perceber, que é o empate em cascata.
 */
export function trickStanding(
  plays: readonly { playerId: PlayerId; card: Card }[],
  rule: TieRule,
): TrickStanding {
  if (plays.length === 0) {
    return { winnerId: null, annulledValue: null, annulledIds: [] };
  }

  let remaining = plays.slice();
  let annulledValue: number | null = null;
  const annulledIds: PlayerId[] = [];

  while (remaining.length > 0) {
    const top = Math.max(...remaining.map((p) => p.card.value));
    const tied = remaining.filter((p) => p.card.value === top);

    if (tied.length === 1) {
      return { winnerId: tied[0]!.playerId, annulledValue, annulledIds };
    }

    // Só o primeiro grupo anulado — o de maior valor — interessa a RJ-087.
    if (annulledValue === null) annulledValue = top;
    for (const p of tied) annulledIds.push(p.playerId);

    if (rule === 'EMPATE_ANULA_VAZA') {
      return { winnerId: null, annulledValue, annulledIds };
    }

    remaining = remaining.filter((p) => p.card.value !== top);
  }

  return { winnerId: null, annulledValue, annulledIds };
}

/** A mesma resolução, a partir dos ids do motor. */
export function resolveTrick(
  plays: readonly TrickPlay[],
  cards: Readonly<Record<CardId, Card>>,
  rule: TieRule,
): TrickResolution {
  const comCartas = plays.map((play) => {
    const card = cards[play.cardId];
    if (!card) throw new Error(`carta ${play.cardId} fora do catálogo da rodada`);
    return { playerId: play.playerId, card };
  });

  const { winnerId, annulledValue } = trickStanding(comCartas, rule);
  return { winnerId, annulledValue };
}

/**
 * RJ-085/RJ-086/RJ-087: quem puxa a vaza seguinte.
 *
 * Com vencedor, é ele. Sem vencedor, é **o responsável pelo empate**: o último
 * jogador, na ordem de jogada daquela vaza, a ter jogado carta do valor empatado
 * mais alto.
 */
export function nextLeaderOf(
  plays: readonly TrickPlay[],
  cards: Readonly<Record<CardId, Card>>,
  resolution: TrickResolution,
): PlayerId {
  if (resolution.winnerId !== null) return resolution.winnerId;

  const { annulledValue } = resolution;
  if (annulledValue === null) {
    throw new Error('vaza sem vencedor e sem valor empatado é estado impossível');
  }

  for (let i = plays.length - 1; i >= 0; i--) {
    const play = plays[i]!;
    if (cards[play.cardId]!.value === annulledValue) return play.playerId;
  }

  throw new Error('nenhuma carta com o valor empatado registrado');
}

/**
 * RJ-007: desvio mínimo garantido.
 *
 * É o piso de `|aposta − vazasGanhas|` no fim da rodada, dado o que já se sabe.
 * Ultrapassou a aposta, o excesso só cresce. Não dá mais para alcançá-la, a
 * falta só cresce. Nos demais casos ainda dá para zerar.
 */
export function minGuaranteedDeviation(
  bet: number,
  tricksWon: number,
  tricksRemaining: number,
): number {
  if (tricksWon > bet) return tricksWon - bet;
  const maxReachable = tricksWon + tricksRemaining;
  if (maxReachable < bet) return bet - maxReachable;
  return 0;
}

/** RJ-008: morreu quando o desvio mínimo garantido alcança as vidas. */
export function isDoomed(
  bet: number,
  tricksWon: number,
  tricksRemaining: number,
  lives: number,
): boolean {
  return minGuaranteedDeviation(bet, tricksWon, tricksRemaining) >= lives;
}
