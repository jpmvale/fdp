/**
 * Motor de regras do FDP — função pura e determinística (`02` §4).
 *
 * Sem rede, sem I/O, sem framework (RJ-143). Sem `Date.now()` nem
 * `Math.random()` (RJ-140): tempo e aleatoriedade entram por parâmetro.
 */
import { type EngineCtx, type MatchOptions, type MatchState, type Move, type MoveResult, type PlayerId } from './types.js';
/** Jogador ainda na partida: nem eliminado, nem retirado. */
export declare function isActive(state: MatchState, playerId: PlayerId): boolean;
export declare function activePlayers(state: MatchState): PlayerId[];
export interface CreateMatchParams {
    matchId: string;
    seed: string;
    /** Jogadores da sala; a ordem da mesa é sorteada a partir daqui (RJ-030). */
    playerIds: readonly PlayerId[];
    options?: Partial<MatchOptions>;
}
export declare function createMatch(params: CreateMatchParams): MatchState;
/**
 * Avança as fases que não dependem de comando: DISTRIBUICAO, REVELACAO e
 * RESOLUCAO. Devolve o estado inalterado se a fase corrente exige jogada.
 *
 * O servidor chama isto ao cumprir as pausas de legibilidade; os testes chamam
 * em laço. Modelar assim mantém as pausas fora do motor, mas as fases visíveis.
 */
export declare function advance(state: MatchState, ctx: EngineCtx): MoveResult;
export declare function applyMove(state: MatchState, move: Move, ctx: EngineCtx): MoveResult;
/**
 * RJ-154/RJ-155: o host escolheu continuar sem os ausentes.
 *
 * Os retirados perdem cartas e vidas, e a rodada corrente é **abortada e
 * redistribuída** mantendo `roundNumber` — ninguém perde vida por ela, e o
 * retirado não ganha `mortoEmVaza`. Retirada não é eliminação (INV-17).
 */
export declare function withdrawPlayers(state: MatchState, playerIds: readonly PlayerId[], ctx: EngineCtx): MoveResult;
/** Encerramento externo: host desistiu, ausência não resolvida, etc. */
export declare function endMatch(state: MatchState, endReason: NonNullable<MatchState['endReason']>): MatchState;
