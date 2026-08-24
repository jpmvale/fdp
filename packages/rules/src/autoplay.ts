/**
 * Auto-play para jogador **conectado** que estourou o prazo (`02` §3.8.1).
 *
 * Jogador desconectado NÃO sofre auto-play: a partida pausa (RJ-117). Essa
 * distinção mora na camada de sala; aqui só fica a jogada em si.
 */

import { isActive } from './engine.js';
import { forbiddenBetFor } from './round.js';
import type { MatchState, Move, PlayerId } from './types.js';

/** RJ-114: aposta 0; se 0 for proibido pela soma, aposta 1. */
export function autoBet(state: MatchState): number {
  const { round, cardsThisRound } = state;
  const placed = round.bidOrder.filter((id) => round.bets[id] !== undefined);
  const isLastBidder = placed.length === round.bidOrder.length - 1;
  if (!isLastBidder) return 0;

  const forbidden = forbiddenBetFor(
    cardsThisRound,
    placed.map((id) => round.bets[id]!),
  );
  return forbidden === 0 ? 1 : 0;
}

/**
 * RJ-115: a carta de menor valor da mão; empate de valor resolve pelo menor
 * `CardId`, para que o auto-play seja determinístico e reproduzível.
 */
export function autoCard(state: MatchState, playerId: PlayerId): string {
  const hand = state.hidden.hands[playerId] ?? [];
  if (hand.length === 0) throw new Error(`mão vazia para ${playerId}`);

  return hand.slice().sort((a, b) => {
    const cardA = state.hidden.cards[a]!;
    const cardB = state.hidden.cards[b]!;
    return cardA.value !== cardB.value ? cardA.value - cardB.value : a.localeCompare(b);
  })[0]!;
}

/** Monta a jogada automática para quem está na vez. */
export function autoMove(state: MatchState): Move {
  const playerId = state.round.activePlayerId;
  if (playerId === null) throw new Error('não há jogador na vez para auto-play');
  if (!isActive(state, playerId)) throw new Error(`${playerId} não está ativo`);

  const base = {
    playerId,
    roundNumber: state.roundNumber,
    trickNumber: state.round.trickNumber,
  };

  if (state.round.phase === 'APOSTAS') {
    return { ...base, type: 'bet', bet: autoBet(state) };
  }
  if (state.round.phase === 'VAZAS') {
    return { ...base, type: 'playCard', cardId: autoCard(state, playerId) };
  }
  throw new Error(`auto-play não se aplica à fase ${state.round.phase}`);
}
