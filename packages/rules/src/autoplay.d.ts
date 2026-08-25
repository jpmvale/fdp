/**
 * Auto-play para jogador **conectado** que estourou o prazo (`02` §3.8.1).
 *
 * Jogador desconectado NÃO sofre auto-play: a partida pausa (RJ-117). Essa
 * distinção mora na camada de sala; aqui só fica a jogada em si.
 */
import type { MatchState, Move, PlayerId } from './types.js';
/** RJ-114: aposta 0; se 0 for proibido pela soma, aposta 1. */
export declare function autoBet(state: MatchState): number;
/**
 * RJ-115: a carta de menor valor da mão; empate de valor resolve pelo menor
 * `CardId`, para que o auto-play seja determinístico e reproduzível.
 */
export declare function autoCard(state: MatchState, playerId: PlayerId): string;
/** Monta a jogada automática para quem está na vez. */
export declare function autoMove(state: MatchState): Move;
