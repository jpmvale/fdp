/**
 * Invariantes de partida (`03` §5).
 *
 * Retorna a lista de violações — vazia quando o estado está são. As invariantes
 * de sala (INV-01, INV-02, INV-05, INV-14, INV-15) vivem na camada de sala e
 * não são verificáveis aqui.
 */
import type { MatchState, PlayerId } from './types.js';
export declare function checkInvariants(state: MatchState): string[];
/**
 * INV-07 e INV-13, verificados sobre o objeto **serializado** — e não sobre os
 * campos que a projeção conhece. É o que mantém o teste válido quando alguém
 * adicionar um campo novo depois.
 */
export declare function checkNoLeak(state: MatchState, viewerId: PlayerId): string[];
