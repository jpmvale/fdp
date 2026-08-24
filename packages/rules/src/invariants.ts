/**
 * Invariantes de partida (`03` §5).
 *
 * Retorna a lista de violações — vazia quando o estado está são. As invariantes
 * de sala (INV-01, INV-02, INV-05, INV-14, INV-15) vivem na camada de sala e
 * não são verificáveis aqui.
 */

import { isActive } from './engine.js';
import { deckCountFor } from './deck.js';
import { project } from './projection.js';
import type { MatchState, PlayerId } from './types.js';

export function checkInvariants(state: MatchState): string[] {
  const violations: string[] = [];
  const { round, hidden } = state;
  const dealt = Object.keys(hidden.cards).length > 0;

  if (dealt) {
    // INV-03: mãos + monte + cartas jogadas = 52 × deckCount.
    const inHands = Object.values(hidden.hands).reduce((n, h) => n + h.length, 0);
    const played =
      round.resolvedTricks.reduce((n, t) => n + t.plays.length, 0) +
      (round.currentTrick?.plays.length ?? 0);
    const total = inHands + hidden.stock.length + played;
    const expected = 52 * state.deckCount;
    if (total !== expected) {
      violations.push(`INV-03: ${total} cartas contabilizadas, esperado ${expected}`);
    }

    // INV-04: nenhuma carta em dois lugares.
    const seen = new Set<string>();
    const dup: string[] = [];
    const visit = (id: string): void => {
      if (seen.has(id)) dup.push(id);
      seen.add(id);
    };
    for (const h of Object.values(hidden.hands)) h.forEach(visit);
    hidden.stock.forEach(visit);
    for (const t of round.resolvedTricks) t.plays.forEach((p) => visit(p.cardId));
    round.currentTrick?.plays.forEach((p) => visit(p.cardId));
    if (dup.length > 0) violations.push(`INV-04: cartas duplicadas ${dup.join(', ')}`);

    // INV-18
    const expectedDecks = deckCountFor(round.bidOrder.length, state.cardsThisRound);
    if (state.deckCount !== expectedDecks) {
      violations.push(`INV-18: deckCount ${state.deckCount}, esperado ${expectedDecks}`);
    }
  }

  // INV-06: todo jogador tem entrada no placar.
  for (const id of state.playerOrder) {
    if (state.lives[id] === undefined) violations.push(`INV-06: ${id} sem vidas`);
  }

  // INV-08: quem está na vez está ativo e não eliminado.
  if (round.activePlayerId !== null) {
    if (!isActive(state, round.activePlayerId)) {
      violations.push(`INV-08: ${round.activePlayerId} na vez sem estar ativo`);
    }
    if (!['APOSTAS', 'VAZAS'].includes(round.phase)) {
      violations.push(`INV-08: activePlayerId definido na fase ${round.phase}`);
    }
  } else if (['APOSTAS', 'VAZAS'].includes(round.phase) && state.endReason === null) {
    violations.push(`INV-08: fase ${round.phase} sem activePlayerId`);
  }

  // INV-09: a soma das apostas nunca fecha com o número de vazas.
  const allBetsIn =
    round.bidOrder.length > 0 &&
    round.bidOrder.every((id) => round.bets[id] !== undefined);
  if (allBetsIn) {
    const sum = round.bidOrder.reduce((n, id) => n + round.bets[id]!, 0);
    if (sum === state.cardsThisRound) {
      violations.push(`INV-09: soma das apostas ${sum} = cartas ${state.cardsThisRound}`);
    }
  }

  // INV-10
  for (const [id, lives] of Object.entries(state.lives)) {
    if (lives < 0 || lives > state.options.vidasIniciais) {
      violations.push(`INV-10: ${id} com ${lives} vidas`);
    }
  }

  // INV-11
  const wonTotal = Object.values(round.tricksWon).reduce((a, b) => a + b, 0);
  if (wonTotal > state.cardsThisRound) {
    violations.push(`INV-11: ${wonTotal} vazas ganhas para ${state.cardsThisRound} cartas`);
  }

  // INV-12: zerou ⇔ eliminado.
  for (const id of state.playerOrder) {
    const zeroed = state.lives[id] === 0;
    const isEliminated = state.eliminated.some((e) => e.playerId === id);
    const isWithdrawn = state.withdrawn.some((w) => w.playerId === id);
    if (zeroed && !isEliminated && !isWithdrawn) {
      violations.push(`INV-12: ${id} zerou sem ser eliminado`);
    }
    if (isEliminated && state.lives[id] !== 0) {
      violations.push(`INV-12: ${id} eliminado com ${state.lives[id]} vidas`);
    }
  }

  // INV-16
  for (const record of state.eliminated) {
    if (record.mortoEmVaza == null) {
      violations.push(`INV-16: ${record.playerId} eliminado sem mortoEmVaza`);
    }
  }

  // INV-17: eliminado XOR retirado.
  for (const id of state.playerOrder) {
    const isEliminated = state.eliminated.some((e) => e.playerId === id);
    const isWithdrawn = state.withdrawn.some((w) => w.playerId === id);
    if (isEliminated && isWithdrawn) {
      violations.push(`INV-17: ${id} eliminado e retirado ao mesmo tempo`);
    }
  }

  return violations;
}

/**
 * INV-07 e INV-13, verificados sobre o objeto **serializado** — e não sobre os
 * campos que a projeção conhece. É o que mantém o teste válido quando alguém
 * adicionar um campo novo depois.
 */
export function checkNoLeak(state: MatchState, viewerId: PlayerId): string[] {
  if (Object.keys(state.hidden.cards).length === 0) return [];

  const serialized = JSON.stringify(project(state, viewerId));
  const violations: string[] = [];

  const foreheadRevealed =
    state.round.isForeheadRound && state.round.phase === 'RESOLUCAO';

  for (const [playerId, cardIds] of Object.entries(state.hidden.hands)) {
    const isOwn = playerId === viewerId;

    // INV-13: na rodada de testa, a própria carta é o segredo — até a revelação.
    if (isOwn && state.round.isForeheadRound && !foreheadRevealed) {
      for (const cardId of cardIds) {
        if (serialized.includes(cardId)) {
          violations.push(`INV-13: própria carta ${cardId} vazou para ${viewerId}`);
        }
      }
      continue;
    }

    if (isOwn) continue;

    // INV-07: mão alheia nunca aparece fora da rodada de testa.
    if (!state.round.isForeheadRound) {
      for (const cardId of cardIds) {
        if (serialized.includes(cardId)) {
          violations.push(`INV-07: mão de ${playerId} vazou para ${viewerId}`);
        }
      }
    }
  }

  return violations;
}
