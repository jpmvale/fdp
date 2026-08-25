/**
 * Projeção do estado para um jogador específico (`04` §5, `02` §3.7).
 *
 * A visão é montada **do zero, por allowlist** — nunca clonando o estado e
 * apagando campos. Um campo novo em `MatchState` fica invisível ao cliente até
 * alguém decidir expô-lo aqui, e não o contrário. É a diferença entre esquecer
 * de esconder e esquecer de mostrar.
 */
import type { Card, EliminationRecord, MatchOptions, MatchState, PlayerId, RoundPhase, RoundSummary, WithdrawalRecord } from './types.js';
export interface PublicTrick {
    leaderId: PlayerId;
    playOrder: PlayerId[];
    plays: {
        playerId: PlayerId;
        card: Card;
    }[];
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
export declare function project(state: MatchState, viewerId: PlayerId): PlayerView;
/** Classificação final (RJ-012, RJ-129). Vencedores primeiro. */
export declare function ranking(state: MatchState): PlayerId[];
