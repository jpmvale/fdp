/**
 * Projeção do estado para um jogador específico (`04` §5, `02` §3.7).
 *
 * A visão é montada **do zero, por allowlist** — nunca clonando o estado e
 * apagando campos. Um campo novo em `MatchState` fica invisível ao cliente até
 * alguém decidir expô-lo aqui, e não o contrário. É a diferença entre esquecer
 * de esconder e esquecer de mostrar.
 */

import { isActive } from './engine.js';
import type {
  Card,
  CardId,
  EliminationRecord,
  MatchOptions,
  MatchState,
  PlayerId,
  RoundPhase,
  RoundSummary,
  WithdrawalRecord,
} from './types.js';

export interface PublicTrick {
  leaderId: PlayerId;
  playOrder: PlayerId[];
  plays: { playerId: PlayerId; card: Card }[];
  winnerId: PlayerId | null;
  annulledValue: number | null;
  nextLeaderId: PlayerId | null;
}

export interface PlayerView {
  matchId: string;
  options: MatchOptions;
  playerOrder: PlayerId[];
  lives: Record<PlayerId, number>;
  eliminated: EliminationRecord[];
  withdrawn: WithdrawalRecord[];

  roundNumber: number;
  cardsThisRound: number;
  deckCount: number;
  firstBidderId: PlayerId;

  phase: RoundPhase;
  activePlayerId: PlayerId | null;
  isForeheadRound: boolean;
  bets: Record<PlayerId, number>;
  bidOrder: PlayerId[];
  tricksWon: Record<PlayerId, number>;
  mortoEmVaza: Record<PlayerId, number | null>;
  trickNumber: number;

  /** Contagem de cartas por jogador. Nunca o conteúdo alheio (RJ-102). */
  handCounts: Record<PlayerId, number>;
  /** Só em rodada de N>1: a própria mão. Vazia na rodada de testa (RJ-100). */
  hand: Card[];
  /** Só em rodada de testa: cartas dos **outros**, nunca a própria (RJ-101). */
  foreheadCards: Record<PlayerId, Card>;

  stockCount: number;
  currentTrick: PublicTrick | null;
  resolvedTricks: PublicTrick[];
  history: RoundSummary[];
  winnerIds: PlayerId[] | null;
  endReason: MatchState['endReason'];

  /** Só para quem está na vez e é o último apostador (RJ-054). */
  forbiddenBet: number | null;
  viewerId: PlayerId;
  isSpectator: boolean;
}

export function project(state: MatchState, viewerId: PlayerId): PlayerView {
  const { round, hidden } = state;
  const isSpectator = !state.playerOrder.includes(viewerId);

  const handCounts: Record<PlayerId, number> = {};
  for (const [playerId, cards] of Object.entries(hidden.hands)) {
    handCounts[playerId] = cards.length;
  }

  // A rodada de testa inverte a visibilidade: o servidor manda a carta de todo
  // mundo, menos a de quem está olhando.
  const foreheadCards: Record<PlayerId, Card> = {};
  let hand: Card[] = [];

  if (round.isForeheadRound && round.phase !== 'RESOLUCAO') {
    // Em REVELACAO o segredo acabou: as apostas estão fechadas, não há mais
    // decisão a tomar, e todo o resto da mesa já viu esta carta a rodada
    // inteira. RJ-100 protege quem ainda precisa apostar às cegas — depois
    // disso, esconder do dono é esconder de uma pessoa só.
    const aindaSecreta = round.phase !== 'REVELACAO';
    for (const [playerId, cardIds] of Object.entries(hidden.hands)) {
      if (playerId === viewerId && aindaSecreta) continue; // RJ-100
      const cardId = cardIds[0];
      if (cardId) foreheadCards[playerId] = hidden.cards[cardId]!;
    }
  } else if (!round.isForeheadRound && !isSpectator) {
    hand = (hidden.hands[viewerId] ?? []).map((id) => hidden.cards[id]!);
  }
  // Depois da revelação as cartas já estão na mesa e chegam a todos — inclusive
  // ao dono — através de `resolvedTricks`, que é público (RJ-066).

  const toPublicTrick = (trick: MatchState['round']['currentTrick']): PublicTrick | null =>
    trick === null
      ? null
      : {
          leaderId: trick.leaderId,
          playOrder: [...trick.playOrder],
          // Carta jogada é pública (RJ-066).
          plays: trick.plays.map((p) => ({
            playerId: p.playerId,
            card: hidden.cards[p.cardId]!,
          })),
          winnerId: trick.winnerId,
          annulledValue: trick.annulledValue,
          nextLeaderId: trick.nextLeaderId,
        };

  const isViewersTurn = round.activePlayerId === viewerId;

  return {
    matchId: state.id,
    options: state.options,
    playerOrder: [...state.playerOrder],
    lives: { ...state.lives },
    eliminated: state.eliminated.map((e) => ({ ...e })),
    withdrawn: state.withdrawn.map((w) => ({ ...w })),

    roundNumber: state.roundNumber,
    cardsThisRound: state.cardsThisRound,
    deckCount: state.deckCount,
    firstBidderId: state.firstBidderId,

    phase: round.phase,
    activePlayerId: round.activePlayerId,
    isForeheadRound: round.isForeheadRound,
    bets: { ...round.bets },
    bidOrder: [...round.bidOrder],
    tricksWon: { ...round.tricksWon },
    mortoEmVaza: { ...round.mortoEmVaza },
    trickNumber: round.trickNumber,

    handCounts,
    hand,
    foreheadCards,

    stockCount: hidden.stock.length,
    currentTrick: toPublicTrick(round.currentTrick),
    resolvedTricks: round.resolvedTricks
      .map(toPublicTrick)
      .filter((t): t is PublicTrick => t !== null),
    history: state.history.map((h) => ({ ...h })),
    winnerIds: state.winnerIds ? [...state.winnerIds] : null,
    endReason: state.endReason,

    // Enviar o valor proibido a quem não está na vez entregaria de graça uma
    // conta que cada jogador deveria fazer sozinho.
    forbiddenBet: isViewersTurn ? round.forbiddenBet : null,
    viewerId,
    isSpectator,
  };
}

/** Classificação final (RJ-012, RJ-129). Vencedores primeiro. */
export function ranking(state: MatchState): PlayerId[] {
  const winners = state.winnerIds ?? [];

  const eliminated = state.eliminated
    .filter((e) => !winners.includes(e.playerId))
    .slice()
    .sort((a, b) =>
      b.roundNumber !== a.roundNumber
        ? b.roundNumber - a.roundNumber // caiu mais tarde, melhor colocado
        : b.mortoEmVaza - a.mortoEmVaza, // morreu mais tarde na rodada, melhor
    )
    .map((e) => e.playerId);

  // Retirados por ausência ficam abaixo de todos os eliminados (RJ-129).
  const withdrawn = state.withdrawn
    .filter((w) => !winners.includes(w.playerId))
    .slice()
    .sort((a, b) => b.roundNumber - a.roundNumber)
    .map((w) => w.playerId);

  const survivors = state.playerOrder.filter(
    (id) =>
      !winners.includes(id) &&
      !eliminated.includes(id) &&
      !withdrawn.includes(id),
  );

  return [...winners, ...survivors, ...eliminated, ...withdrawn];
}
